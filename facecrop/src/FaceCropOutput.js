/* global Blob, CompressionStream, Response */
import {UPLOAD_STATUS} from './uploadState';
import {buildFaceEvents} from './Metadata';

// This module provides worker-safe artifact encoding and the main-thread
// transport boundary for JATOS upload tracking and retries.
export const PATCH_VIDEO_FORMAT_VERSION = 'patch-video-avi-gzip-bgr24-v1';
export const PATCH_VIDEO_FRAME_RATE = 30;
export const FACE_EVENTS_FORMAT_VERSION = 'face-crop-events-v3';
export const MAX_PENDING_PATCH_PARTS = 2;
export const MAX_UPLOAD_ATTEMPTS = 3;
const FRAME_BYTES = 72 * 72 * 3;
const MIN_PATCH_VIDEO_FRAME_RATE = 1;
const MAX_PATCH_VIDEO_FRAME_RATE = 120;

function token(value, name) {
    const resolved = String(value);
    if (!/^[A-Za-z0-9_-]+$/.test(resolved)) throw new Error(name + ' contains unsupported filename characters');
    return resolved;
}

export function createPatchVideoFilename(identity) {
    // Stable names let AVI parts and their JSON sidecars be matched after upload
    // without requiring a separate manifest or archive.
    const {filenamePrefix, captureId, segmentIndex, partIndex} = identity;
    const suffix = (captureId ? token(captureId, 'Capture ID') + '_' : '') +
        'patch_s' + String(segmentIndex).padStart(3, '0') + '_p' + String(partIndex).padStart(3, '0') + '.avi.gz';
    if (filenamePrefix !== undefined && filenamePrefix !== null && filenamePrefix !== '') {
        return token(filenamePrefix, 'Filename prefix') + '_' + suffix;
    }
    // Compatibility for internal legacy tests; public sessions use filenamePrefix.
    if (identity.studyResultId !== undefined) return token(identity.studyResultId, 'Study result ID') + '_' +
        token(identity.studyPage, 'Study page') + '_' + token(identity.videoCounter, 'Video counter') + '_' + suffix;
    if (captureId) return suffix;
    throw new Error('Filename prefix or capture ID is required');
}

export function createCaptureManifestFilename(identity) {
    if (!identity || !identity.captureId) throw new Error('Capture ID is required');
    const prefix = identity.filenamePrefix !== undefined ? identity.filenamePrefix :
        (identity.studyResultId !== undefined ? [identity.studyResultId, identity.studyPage, identity.videoCounter].join('_') : '');
    return (prefix ? token(prefix, 'Filename prefix') + '_' : '') + token(identity.captureId, 'Capture ID') + '_manifest.json';
}

export function createFaceEventsFilename(identity) {
    return createPatchVideoFilename(identity).replace(/\.avi\.gz$/, '.face-events.json');
}

function fourCC(value) {
    const bytes = new Uint8Array(4);
    for (let index = 0; index < 4; index += 1) bytes[index] = value.charCodeAt(index);
    return bytes;
}

function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

function concat(chunks) {
    const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
    let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return bytes;
}

function chunk(type, payload) {
    return concat([fourCC(type), uint32(payload.byteLength), payload,
        ...(payload.byteLength % 2 ? [new Uint8Array([0])] : [])]);
}

function list(type, chunks) { return chunk('LIST', concat([fourCC(type), ...chunks])); }

export function resolveAviFrameRate(part) {
    const faceEvents = part && part.faceEvents;
    const frames = faceEvents && Array.isArray(faceEvents.frames) ? faceEvents.frames
        : faceEvents && faceEvents.analysis && Array.isArray(faceEvents.analysis.frames) ? faceEvents.analysis.frames : null;
    if (!frames || !frames.length) throw new Error('AVI frame rate requires presentation timestamps');
    const preceding = faceEvents.precedingFramePresentationTimeUs;
    const hasPreceding = preceding !== null && preceding !== undefined;
    if (hasPreceding && !Number.isSafeInteger(preceding)) {
        throw new Error('AVI preceding-frame presentation timestamp is invalid');
    }
    const timestamps = [...(hasPreceding ? [preceding] : []), ...frames.map(frame => frame && frame.presentationTimeUs)];
    if (timestamps.length < 2) throw new Error('AVI frame rate requires at least two presentation timestamps');
    let totalDeltaUs = 0;
    for (let index = 1; index < timestamps.length; index += 1) {
        const previous = timestamps[index - 1];
        const current = timestamps[index];
        if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(current) || current <= previous) {
            throw new Error('AVI frame rate requires strictly increasing presentation timestamps');
        }
        totalDeltaUs += current - previous;
    }
    const frameRate = Math.round(((timestamps.length - 1) * 1000000) / totalDeltaUs);
    if (!Number.isSafeInteger(frameRate)) throw new Error('AVI frame rate could not be derived');
    return Math.max(MIN_PATCH_VIDEO_FRAME_RATE, Math.min(MAX_PATCH_VIDEO_FRAME_RATE, frameRate));
}

function mainHeader(frameCount, frameRate) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.round(1000000 / frameRate), true);
    view.setUint32(4, FRAME_BYTES * frameRate, true);
    view.setUint32(12, 0x10, true);
    view.setUint32(16, frameCount, true);
    view.setUint32(24, 1, true);
    view.setUint32(28, FRAME_BYTES, true);
    view.setUint32(32, 72, true);
    view.setUint32(36, 72, true);
    return bytes;
}

function streamHeader(frameCount, frameRate) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    bytes.set(fourCC('vids'), 0); bytes.set(fourCC('DIB '), 4);
    view.setUint32(20, 1, true); view.setUint32(24, frameRate, true);
    view.setUint32(32, frameCount, true); view.setUint32(36, FRAME_BYTES, true);
    view.setUint32(40, 0xffffffff, true); view.setUint16(52, 72, true); view.setUint16(54, 72, true);
    return bytes;
}

function bitmapHeader() {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 40, true); view.setInt32(4, 72, true); view.setInt32(8, -72, true);
    view.setUint16(12, 1, true); view.setUint16(14, 24, true); view.setUint32(20, FRAME_BYTES, true);
    return bytes;
}

export function buildUncompressedAvi({bytes, frameCount, frameRate = PATCH_VIDEO_FRAME_RATE}) {
    if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(frameCount) || frameCount < 1 || bytes.byteLength !== frameCount * FRAME_BYTES) {
        throw new Error('AVI encoder requires complete 72x72 BGR24 frames');
    }
    if (!Number.isSafeInteger(frameRate) || frameRate < MIN_PATCH_VIDEO_FRAME_RATE || frameRate > MAX_PATCH_VIDEO_FRAME_RATE) {
        throw new Error('AVI frame rate is outside supported bounds');
    }
    const header = list('hdrl', [chunk('avih', mainHeader(frameCount, frameRate)),
        list('strl', [chunk('strh', streamHeader(frameCount, frameRate)), chunk('strf', bitmapHeader())])]);
    const frameChunkLength = 8 + FRAME_BYTES;
    const moviPayloadLength = 4 + frameCount * frameChunkLength;
    const indexPayloadLength = frameCount * 16;
    const avi = new Uint8Array(8 + 4 + header.byteLength + 8 + moviPayloadLength + 8 + indexPayloadLength);
    const view = new DataView(avi.buffer);
    let offset = 0;
    avi.set(fourCC('RIFF'), offset); view.setUint32(offset + 4, avi.byteLength - 8, true); offset += 8;
    avi.set(fourCC('AVI '), offset); offset += 4;
    avi.set(header, offset); offset += header.byteLength;
    avi.set(fourCC('LIST'), offset); view.setUint32(offset + 4, moviPayloadLength, true); offset += 8;
    avi.set(fourCC('movi'), offset); offset += 4;
    for (let index = 0; index < frameCount; index += 1) {
        avi.set(fourCC('00db'), offset); view.setUint32(offset + 4, FRAME_BYTES, true); offset += 8;
        avi.set(bytes.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES), offset); offset += FRAME_BYTES;
    }
    avi.set(fourCC('idx1'), offset); view.setUint32(offset + 4, indexPayloadLength, true); offset += 8;
    for (let index = 0; index < frameCount; index += 1) {
        avi.set(fourCC('00db'), offset); view.setUint32(offset + 4, 0x10, true);
        view.setUint32(offset + 8, 4 + index * frameChunkLength, true); view.setUint32(offset + 12, FRAME_BYTES, true);
        offset += 16;
    }
    return avi;
}

export async function encodeGzipAvi(part, frameRate = resolveAviFrameRate(part)) {
    // This is deliberately worker-safe: the encoding worker owns AVI muxing and
    // compression, while the main thread keeps only JATOS upload authority.
    if (typeof Blob !== 'function' || typeof CompressionStream !== 'function' || typeof Response !== 'function') {
        throw new Error('Native Blob, Response, and CompressionStream APIs are required for gzip AVI encoding');
    }
    const avi = new Blob([buildUncompressedAvi({...part, frameRate})], {type: 'video/avi'});
    return new Response(avi.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function encodePatchArtifact(part) {
    validateFrameEvidence(part.faceEvents, part.frameCount);
    const frameRate = resolveAviFrameRate(part);
    const gzip = await encodeGzipAvi(part, frameRate);
    return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex,
        filename: part.filename, faceEventsFilename: part.faceEventsFilename, frameCount: part.frameCount, frameRate,
        gzipBytes: await gzip.arrayBuffer(), faceEvents: buildFaceEvents(part.faceEvents)};
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function defaultTracker() { return {registerUpload() {}, settleUpload() {}}; }
let nextUploadSessionId = 0;

function validateFrameEvidence(events, frameCount) {
    const frames = events && (events.analysis ? events.analysis.frames : events.frames);
    if (!Array.isArray(frames) || frames.length !== frameCount) {
        throw new Error('Sidecar frame records must match the AVI frame count');
    }
    let previous = events.precedingFramePresentationTimeUs;
    frames.forEach((frame, index) => {
        if (!frame || frame.frameIndex !== index || !Number.isSafeInteger(frame.presentationTimeUs) ||
            (previous !== undefined && previous !== null && frame.presentationTimeUs <= previous)) {
            throw new Error('Sidecar frame indexes and timestamps must be contiguous and strictly increasing');
        }
        previous = frame.presentationTimeUs;
    });
}

function validateArtifact(artifact) {
    if (!artifact || !(artifact.gzipBytes instanceof ArrayBuffer) || artifact.gzipBytes.byteLength < 1 ||
        !Number.isSafeInteger(artifact.frameCount) || artifact.frameCount < 1 ||
        !Number.isSafeInteger(artifact.frameRate) || artifact.frameRate < MIN_PATCH_VIDEO_FRAME_RATE || artifact.frameRate > MAX_PATCH_VIDEO_FRAME_RATE ||
        !artifact.filename.endsWith('.avi.gz') ||
        !artifact.faceEventsFilename.endsWith('.face-events.json') || !artifact.faceEvents ||
        artifact.faceEvents.aviFilename !== artifact.filename || artifact.faceEvents.frameCount !== artifact.frameCount) {
        throw new Error('Encoded patch artifact is invalid');
    }
    validateFrameEvidence(artifact.faceEvents, artifact.frameCount);
}

export class FaceCropSink {
    constructor({write, uploadResultFile, uploadTracker = defaultTracker(), onArtifact = () => {}, sleep = delay,
        maxPendingParts = MAX_PENDING_PATCH_PARTS, maxAttempts = MAX_UPLOAD_ATTEMPTS, retryDelayMs = 100}) {
        const transportWrite = write || (typeof uploadResultFile === 'function'
            ? ({filename, payload}) => uploadResultFile(payload, filename) : null);
        if (typeof transportWrite !== 'function' || typeof onArtifact !== 'function' || !uploadTracker || !uploadTracker.registerUpload ||
            typeof uploadTracker.settleUpload !== 'function' || typeof sleep !== 'function' ||
            !Number.isSafeInteger(maxPendingParts) || maxPendingParts < 1 || maxPendingParts > MAX_PENDING_PATCH_PARTS ||
            !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
            throw new Error('Patch sink configuration is invalid');
        }
        Object.assign(this, {write: transportWrite, uploadTracker, onArtifact, sleep, maxPendingParts, maxAttempts, retryDelayMs});
        this.uploadSessionId = nextUploadSessionId++;
        this.pending = [];
        this.tail = Promise.resolve();
        this.results = [];
        this.accepting = true;
        this.aborted = false;
        this.entries = [];
        this.fileEntries = [];
        this.abortWait = new Promise(resolve => { this.resolveAbortWait = resolve; });
    }

    async enqueuePart(part) {
        // At most maxPendingParts are retained. Waiting here applies backpressure
        // to frame processing instead of allowing upload latency to grow memory.
        if (!this.accepting) throw new Error('Cannot enqueue a part after sink finalization begins');
        validateArtifact(part);
        while (this.pending.length >= this.maxPendingParts && !this.aborted) {
            await Promise.race([this.pending[0], this.abortWait]);
        }
        const identity = {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex,
            frameCount: part.frameCount, frameRate: part.frameRate, byteLength: part.gzipBytes.byteLength,
            filename: part.filename, faceEventsFilename: part.faceEventsFilename};
        if (this.aborted) {
            part.gzipBytes = null;
            const result = this.pendingResult(identity);
            const entry = {identity, part: null, started: false, result, completion: Promise.resolve(result)};
            this.entries.push(entry);
            this.results.push(result);
            this.notify(identity, 'patch-part-' + this.uploadSessionId + '-' + identity.filename, identity.filename, 'discarded');
            this.notify(identity, 'patch-events-' + this.uploadSessionId + '-' + identity.faceEventsFilename,
                identity.faceEventsFilename, 'discarded');
            return;
        }
        const entry = {identity, part, started: false, result: null, completion: null};
        this.entries.push(entry);
        this.notify(identity, 'patch-part-' + this.uploadSessionId + '-' + part.filename, part.filename, 'pending');
        this.notify(identity, 'patch-events-' + this.uploadSessionId + '-' + part.faceEventsFilename, part.faceEventsFilename, 'pending');
        // Queue only the compact entry. A closure over `part` here keeps the
        // full sidecar frame array alive even after abort discards queued work.
        const completion = this.tail.then(() => this.uploadEntry(entry)).then(result => {
            entry.result = result;
            entry.part = null;
            this.results.push(result);
            return result;
        });
        entry.completion = completion;
        this.tail = completion;
        this.pending.push(completion);
        completion.then(() => { this.pending = this.pending.filter(candidate => candidate !== completion); });
    }

    async finalize() {
        this.accepting = false;
        await Promise.all(this.pending);
        return {parts: [...this.results]};
    }

    abort() {
        this.accepting = false;
        if (!this.aborted) { this.aborted = true; this.resolveAbortWait(); }
        // Started transport promises remain observable; abort never waits for them.
        this.entries.filter(entry => !entry.started).forEach(entry => {
            if (entry.part) entry.part.gzipBytes = null;
            entry.result = this.pendingResult(entry.identity);
            this.notify(entry.identity, 'patch-part-' + this.uploadSessionId + '-' + entry.identity.filename, entry.identity.filename, 'discarded');
            this.notify(entry.identity, 'patch-events-' + this.uploadSessionId + '-' + entry.identity.faceEventsFilename, entry.identity.faceEventsFilename, 'discarded');
            entry.part = null;
        });
        this.fileEntries.filter(entry => entry.started && !entry.result).forEach(entry => {
            try { this.uploadTracker.settleUpload(entry.uploadId, UPLOAD_STATUS.FAILED); } catch (_) {}
        });
        return {status: 'aborted', artifacts: this.inventory(),
            pendingCompletions: this.entries.filter(entry => entry.started && !entry.result).map(entry => entry.completion)};
    }

    inventory() {
        const files = new Map(this.fileEntries.map(entry => [entry.filename, entry]));
        const inventory = [];
        this.entries.forEach(entry => {
            const identity = entry.identity;
            const result = entry.result;
            [identity.filename, identity.faceEventsFilename].forEach((filename, index) => {
                const ledger = files.get(filename);
                const artifactResult = result && (index === 0 ? result.avi : result.faceEvents);
                inventory.push({filename,
                    status: ledger ? ledger.status : artifactResult ? artifactResult.status : this.aborted ? 'discarded' : 'pending',
                    attempts: artifactResult ? artifactResult.attempts || 0 : ledger ? ledger.attempts : 0,
                    completion: ledger && ledger.started && !ledger.result ? ledger.completion : undefined});
            });
        });
        this.fileEntries.filter(entry => !inventory.some(item => item.filename === entry.filename)).forEach(entry => inventory.push({
            filename: entry.filename, status: entry.status, attempts: entry.attempts,
            completion: entry.started && !entry.result ? entry.completion : undefined
        }));
        return inventory;
    }

    pendingResult(identity) {
        return {captureId: identity.captureId, segmentIndex: identity.segmentIndex, partIndex: identity.partIndex,
            frameCount: identity.frameCount, frameRate: identity.frameRate, byteLength: identity.byteLength,
            filename: identity.filename, faceEventsFilename: identity.faceEventsFilename,
            status: 'discarded', avi: {filename: identity.filename, status: 'discarded', attempts: 0},
            faceEvents: {filename: identity.faceEventsFilename, status: 'discarded', attempts: 0}};
    }

    async uploadEntry(entry) {
        if (!entry.part || this.aborted) return this.pendingResult(entry.identity);
        return this.uploadPart(entry.part, entry);
    }

    async writeArtifact(payload, filename, uploadId = filename) {
        this.uploadTracker.registerUpload(uploadId);
        return this.uploadWithRetry(payload, filename, uploadId);
    }

    notify(identity, uploadId, filename, status, attempts = 0) {
        try { this.onArtifact({type: 'artifact', artifact: {captureId: identity && identity.captureId, uploadId, filename, status, attempts}}); } catch (_) {}
    }

    async uploadPart(part, entry) {
        if (this.aborted) { part.gzipBytes = null; return this.pendingResult(part); }
        entry.started = true;
        const byteLength = part.gzipBytes.byteLength;
        // AVI and face-event uploads are one logical result: the sidecar is not
        // attempted when the corresponding video artifact cannot be uploaded.
        const aviId = 'patch-part-' + this.uploadSessionId + '-' + part.filename;
        const eventsId = 'patch-events-' + this.uploadSessionId + '-' + part.faceEventsFilename;
        this.uploadTracker.registerUpload(aviId); this.uploadTracker.registerUpload(eventsId);
        let avi;
        try {
            avi = await this.uploadWithRetry(new Blob([part.gzipBytes], {type: 'application/gzip'}), part.filename, aviId, entry, 'avi');
        } catch (error) {
            this.uploadTracker.settleUpload(aviId, UPLOAD_STATUS.FAILED);
            avi = {uploadId: aviId, filename: part.filename, status: UPLOAD_STATUS.FAILED, attempts: 0, error};
        } finally {
            part.gzipBytes = null;
        }
        if (avi.status !== UPLOAD_STATUS.SUCCEEDED) {
            const sidecarStatus = this.aborted ? 'discarded' : 'not_attempted';
            this.uploadTracker.settleUpload(eventsId, UPLOAD_STATUS.FAILED);
            this.notify(entry.identity, eventsId, part.faceEventsFilename, sidecarStatus);
            return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount, frameRate: part.frameRate,
                byteLength, filename: part.filename, faceEventsFilename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, avi,
                faceEvents: {uploadId: eventsId, filename: part.faceEventsFilename, status: sidecarStatus, attempts: 0}};
        }
        if (this.aborted) {
            try { this.uploadTracker.registerUpload(eventsId); } catch (_) {}
            try { this.uploadTracker.settleUpload(eventsId, UPLOAD_STATUS.FAILED); } catch (_) {}
            this.notify(entry.identity, eventsId, part.faceEventsFilename, 'discarded');
            return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex,
                frameCount: part.frameCount, frameRate: part.frameRate, byteLength, filename: part.filename,
                faceEventsFilename: part.faceEventsFilename, status: 'uncertain', avi,
                faceEvents: {uploadId: eventsId, filename: part.faceEventsFilename, status: 'discarded', attempts: 0}};
        }
        const faceEvents = await this.uploadWithRetry(JSON.stringify(part.faceEvents), part.faceEventsFilename, eventsId, entry, 'faceEvents');
        return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount, frameRate: part.frameRate, byteLength,
            filename: part.filename, faceEventsFilename: part.faceEventsFilename,
            status: faceEvents.status === UPLOAD_STATUS.SUCCEEDED ? UPLOAD_STATUS.SUCCEEDED : UPLOAD_STATUS.FAILED, avi, faceEvents};
    }

    async uploadWithRetry(payload, filename, uploadId, partEntry = null, kind = 'artifact') {
        let error;
        const ledger = {filename, uploadId, status: 'pending', attempts: 0, started: false, result: null, completion: null};
        this.fileEntries.push(ledger);
        const emit = status => {
            ledger.status = status;
            if (partEntry) partEntry[kind === 'avi' ? 'aviStatus' : kind === 'faceEvents' ? 'eventsStatus' : 'artifactStatus'] = status;
            this.notify(partEntry ? partEntry.identity : null, uploadId, filename, status, ledger.attempts);
        };
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            if (this.aborted) {
                const result = {uploadId, filename, status: ledger.started ? 'uncertain' : 'discarded', attempts: ledger.attempts};
                ledger.result = result; emit(result.status); return result;
            }
            try {
                ledger.started = true; ledger.attempts = attempt; emit('pending');
                ledger.completion = this.write({filename, payload});
                await ledger.completion;
                if (this.aborted) {
                    const result = {uploadId, filename, status: UPLOAD_STATUS.SUCCEEDED, attempts: attempt};
                    ledger.result = result; emit(result.status); return result;
                }
                this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.SUCCEEDED);
                const result = {uploadId, filename, status: UPLOAD_STATUS.SUCCEEDED, attempts: attempt};
                ledger.result = result; emit(result.status); return result;
            } catch (currentError) {
                error = currentError;
                if (this.aborted) {
                    const result = {uploadId, filename, status: 'uncertain', attempts: attempt, error};
                    ledger.result = result; emit(result.status); return result;
                }
                if (attempt < this.maxAttempts) await this.sleep(this.retryDelayMs * attempt);
            }
        }
        this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.FAILED);
        const result = {uploadId, filename, status: 'uncertain', attempts: this.maxAttempts, error};
        ledger.result = result; emit(result.status); return result;
    }
}
