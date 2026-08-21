/* global Blob, CompressionStream, Response */
import {UPLOAD_STATUS} from '../uploadState';

// This module provides worker-safe artifact encoding and the main-thread
// transport boundary for JATOS upload tracking and retries.
export const PATCH_VIDEO_FORMAT_VERSION = 'patch-video-avi-gzip-bgr24-v1';
export const PATCH_VIDEO_FRAME_RATE = 30;
export const FACE_EVENTS_FORMAT_VERSION = 'face-events-json-v1';
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

export function createPatchVideoFilename({studyResultId, studyPage, videoCounter, captureId, segmentIndex, partIndex}) {
    // Stable names let AVI parts and their JSON sidecars be matched after upload
    // without requiring a separate manifest or archive.
    const captureToken = captureId ? token(captureId, 'Capture ID') + '_' : '';
    return token(studyResultId, 'Study result ID') + '_' + token(studyPage, 'Study page') + '_' +
        token(videoCounter, 'Video counter') + '_' + captureToken + 'patch_s' + String(segmentIndex).padStart(3, '0') +
        '_p' + String(partIndex).padStart(3, '0') + '.avi.gz';
}

export function createCaptureManifestFilename({studyResultId, studyPage, videoCounter, captureId}) {
    return token(studyResultId, 'Study result ID') + '_' + token(studyPage, 'Study page') + '_' +
        token(videoCounter, 'Video counter') + '_' + token(captureId, 'Capture ID') + '_manifest.json';
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

function resolveAviFrameRate(part) {
    const frames = part && part.faceEvents && Array.isArray(part.faceEvents.frames) ? part.faceEvents.frames : null;
    if (!frames || frames.length < 2) return PATCH_VIDEO_FRAME_RATE;
    let totalDeltaUs = 0;
    let deltaCount = 0;
    for (let index = 1; index < frames.length; index += 1) {
        const previous = frames[index - 1] && frames[index - 1].mediaTimeUs;
        const current = frames[index] && frames[index].mediaTimeUs;
        if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(current)) continue;
        const delta = current - previous;
        if (delta > 0) {
            totalDeltaUs += delta;
            deltaCount += 1;
        }
    }
    if (!deltaCount || totalDeltaUs <= 0) return PATCH_VIDEO_FRAME_RATE;
    const frameRate = Math.round((deltaCount * 1000000) / totalDeltaUs);
    if (!Number.isSafeInteger(frameRate)) return PATCH_VIDEO_FRAME_RATE;
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

export async function encodeGzipAvi(part) {
    // This is deliberately worker-safe: the assembly worker owns AVI muxing and
    // compression, while the main thread keeps only JATOS upload authority.
    if (typeof Blob !== 'function' || typeof CompressionStream !== 'function' || typeof Response !== 'function') {
        throw new Error('Native Blob, Response, and CompressionStream APIs are required for gzip AVI encoding');
    }
    const avi = new Blob([buildUncompressedAvi({...part, frameRate: resolveAviFrameRate(part)})], {type: 'video/avi'});
    return new Response(avi.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function encodePatchArtifact(part) {
    const gzip = await encodeGzipAvi(part);
    return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex,
        filename: part.filename, faceEventsFilename: part.faceEventsFilename, frameCount: part.frameCount,
        gzipBytes: await gzip.arrayBuffer(), faceEvents: part.faceEvents};
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function defaultTracker() { return {registerUpload() {}, settleUpload() {}}; }
let nextUploadSessionId = 0;

function validateArtifact(artifact) {
    if (!artifact || !(artifact.gzipBytes instanceof ArrayBuffer) || artifact.gzipBytes.byteLength < 1 ||
        !Number.isSafeInteger(artifact.frameCount) || artifact.frameCount < 1 || !artifact.filename.endsWith('.avi.gz') ||
        !artifact.faceEventsFilename.endsWith('.face-events.json') || !artifact.faceEvents ||
        artifact.faceEvents.aviFilename !== artifact.filename || artifact.faceEvents.frameCount !== artifact.frameCount) {
        throw new Error('Encoded patch artifact is invalid');
    }
}

export class FaceCropSink {
    constructor({uploadResultFile, uploadTracker = defaultTracker(), sleep = delay,
        maxPendingParts = MAX_PENDING_PATCH_PARTS, maxAttempts = MAX_UPLOAD_ATTEMPTS, retryDelayMs = 100}) {
        if (typeof uploadResultFile !== 'function' || !uploadTracker || typeof uploadTracker.registerUpload !== 'function' ||
            typeof uploadTracker.settleUpload !== 'function' || typeof sleep !== 'function' ||
            !Number.isSafeInteger(maxPendingParts) || maxPendingParts < 1 || maxPendingParts > MAX_PENDING_PATCH_PARTS ||
            !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
            throw new Error('Patch sink configuration is invalid');
        }
        Object.assign(this, {uploadResultFile, uploadTracker, sleep, maxPendingParts, maxAttempts, retryDelayMs});
        this.uploadSessionId = nextUploadSessionId++;
        this.pending = [];
        this.tail = Promise.resolve();
        this.results = [];
        this.accepting = true;
    }

    async enqueuePart(part) {
        // At most maxPendingParts are retained. Waiting here applies backpressure
        // to frame processing instead of allowing upload latency to grow memory.
        if (!this.accepting) throw new Error('Cannot enqueue a part after sink finalization begins');
        validateArtifact(part);
        while (this.pending.length >= this.maxPendingParts) await this.pending[0];
        const completion = this.tail.then(() => this.uploadPart(part)).then(result => { this.results.push(result); return result; });
        this.tail = completion;
        this.pending.push(completion);
        completion.then(() => { this.pending = this.pending.filter(candidate => candidate !== completion); });
    }

    async finalize() {
        this.accepting = false;
        await Promise.all(this.pending);
        return {parts: [...this.results]};
    }

    async uploadPart(part) {
        // AVI and face-event uploads are one logical result: the sidecar is not
        // attempted when the corresponding video artifact cannot be uploaded.
        const aviId = 'patch-part-' + this.uploadSessionId + '-' + part.filename;
        const eventsId = 'patch-events-' + this.uploadSessionId + '-' + part.faceEventsFilename;
        this.uploadTracker.registerUpload(aviId); this.uploadTracker.registerUpload(eventsId);
        let avi;
        try {
            avi = await this.uploadWithRetry(new Blob([part.gzipBytes], {type: 'application/gzip'}), part.filename, aviId);
        } catch (error) {
            this.uploadTracker.settleUpload(aviId, UPLOAD_STATUS.FAILED);
            avi = {uploadId: aviId, filename: part.filename, status: UPLOAD_STATUS.FAILED, attempts: 0, error};
        } finally {
            part.gzipBytes = null;
        }
        if (avi.status !== UPLOAD_STATUS.SUCCEEDED) {
            this.uploadTracker.settleUpload(eventsId, UPLOAD_STATUS.FAILED);
            return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount,
                filename: part.filename, faceEventsFilename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, avi,
                faceEvents: {uploadId: eventsId, filename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, attempts: 0}};
        }
        const faceEvents = await this.uploadWithRetry(JSON.stringify(part.faceEvents), part.faceEventsFilename, eventsId);
        return {captureId: part.captureId, segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount,
            filename: part.filename, faceEventsFilename: part.faceEventsFilename,
            status: faceEvents.status === UPLOAD_STATUS.SUCCEEDED ? UPLOAD_STATUS.SUCCEEDED : UPLOAD_STATUS.FAILED, avi, faceEvents};
    }

    async uploadWithRetry(payload, filename, uploadId) {
        let error;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
                await this.uploadResultFile(payload, filename);
                this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.SUCCEEDED);
                return {uploadId, filename, status: UPLOAD_STATUS.SUCCEEDED, attempts: attempt};
            } catch (currentError) {
                error = currentError;
                if (attempt < this.maxAttempts) await this.sleep(this.retryDelayMs * attempt);
            }
        }
        this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.FAILED);
        console.error('[face-crop] Upload failed after ' + this.maxAttempts + ' attempts', error);
        return {uploadId, filename, status: UPLOAD_STATUS.FAILED, attempts: this.maxAttempts, error};
    }
}
