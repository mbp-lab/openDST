import {UPLOAD_STATUS} from '../uploadState';

export const PATCH_VIDEO_FORMAT_VERSION = 'patch-video-avi-gzip-bgr24-v1';
export const PATCH_VIDEO_FRAME_RATE = 30;
export const FACE_EVENTS_FORMAT_VERSION = 'face-events-json-v1';
export const MAX_PENDING_PATCH_PARTS = 2;
export const MAX_UPLOAD_ATTEMPTS = 3;
const FRAME_BYTES = 72 * 72 * 3;

function token(value, name) {
    const resolved = String(value);
    if (!/^[A-Za-z0-9_-]+$/.test(resolved)) throw new Error(name + ' contains unsupported filename characters');
    return resolved;
}

export function createPatchVideoFilename({studyResultId, studyPage, videoCounter, segmentIndex, partIndex}) {
    return token(studyResultId, 'Study result ID') + '_' + token(studyPage, 'Study page') + '_' +
        token(videoCounter, 'Video counter') + '_patch_s' + String(segmentIndex).padStart(3, '0') +
        '_p' + String(partIndex).padStart(3, '0') + '.avi.gz';
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

function mainHeader(frameCount) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.round(1000000 / PATCH_VIDEO_FRAME_RATE), true);
    view.setUint32(4, FRAME_BYTES * PATCH_VIDEO_FRAME_RATE, true);
    view.setUint32(12, 0x10, true);
    view.setUint32(16, frameCount, true);
    view.setUint32(24, 1, true);
    view.setUint32(28, FRAME_BYTES, true);
    view.setUint32(32, 72, true);
    view.setUint32(36, 72, true);
    return bytes;
}

function streamHeader(frameCount) {
    const bytes = new Uint8Array(56);
    const view = new DataView(bytes.buffer);
    bytes.set(fourCC('vids'), 0); bytes.set(fourCC('DIB '), 4);
    view.setUint32(20, 1, true); view.setUint32(24, PATCH_VIDEO_FRAME_RATE, true);
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

function indexChunk(frames) {
    const entries = new Uint8Array(frames.length * 16);
    const view = new DataView(entries.buffer);
    let offset = 4;
    frames.forEach((frame, index) => {
        const entry = index * 16;
        entries.set(fourCC('00db'), entry); view.setUint32(entry + 4, 0x10, true);
        view.setUint32(entry + 8, offset, true); view.setUint32(entry + 12, FRAME_BYTES, true);
        offset += frame.byteLength;
    });
    return chunk('idx1', entries);
}

export function buildUncompressedAvi({bytes, frameCount}) {
    if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(frameCount) || frameCount < 1 || bytes.byteLength !== frameCount * FRAME_BYTES) {
        throw new Error('AVI encoder requires complete 72x72 BGR24 frames');
    }
    const frames = Array.from({length: frameCount}, (_, index) =>
        chunk('00db', bytes.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES)));
    const header = list('hdrl', [chunk('avih', mainHeader(frameCount)),
        list('strl', [chunk('strh', streamHeader(frameCount)), chunk('strf', bitmapHeader())])]);
    return chunk('RIFF', concat([fourCC('AVI '), header, list('movi', frames), indexChunk(frames)]));
}

export async function encodeGzipAvi(part) {
    if (typeof window.CompressionStream !== 'function' || typeof window.Blob !== 'function' || typeof window.Response !== 'function') {
        throw new Error('Native Blob, Response, and CompressionStream APIs are required for gzip AVI encoding');
    }
    const avi = new window.Blob([buildUncompressedAvi(part)], {type: 'video/avi'});
    return new window.Response(avi.stream().pipeThrough(new window.CompressionStream('gzip'))).blob();
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function defaultTracker() { return {registerUpload() {}, settleUpload() {}}; }

function validatePart(part) {
    if (!part || !(part.bytes instanceof Uint8Array) || part.bytes.byteLength !== part.byteLength ||
        !Number.isSafeInteger(part.frameCount) || part.frameCount < 1 || !part.filename.endsWith('.avi.gz') ||
        !part.faceEventsFilename.endsWith('.face-events.json') || !part.faceEvents ||
        part.faceEvents.aviFilename !== part.filename || part.faceEvents.frameCount !== part.frameCount) {
        throw new Error('Sealed patch part is invalid');
    }
}

export class RawPatchSink {
    constructor({uploadResultFile, uploadTracker = defaultTracker(), encode = encodeGzipAvi, sleep = delay,
        maxPendingParts = MAX_PENDING_PATCH_PARTS, maxAttempts = MAX_UPLOAD_ATTEMPTS, retryDelayMs = 100}) {
        if (typeof uploadResultFile !== 'function' || !uploadTracker || typeof uploadTracker.registerUpload !== 'function' ||
            typeof uploadTracker.settleUpload !== 'function' || typeof encode !== 'function' || typeof sleep !== 'function' ||
            !Number.isSafeInteger(maxPendingParts) || maxPendingParts < 1 || maxPendingParts > MAX_PENDING_PATCH_PARTS ||
            !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
            throw new Error('Patch sink configuration is invalid');
        }
        Object.assign(this, {uploadResultFile, uploadTracker, encode, sleep, maxPendingParts, maxAttempts, retryDelayMs});
        this.pending = [];
        this.tail = Promise.resolve();
        this.results = [];
        this.accepting = true;
    }

    async enqueuePart(part) {
        if (!this.accepting) throw new Error('Cannot enqueue a part after sink finalization begins');
        validatePart(part);
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
        const aviId = 'patch-part-' + part.filename;
        const eventsId = 'patch-events-' + part.faceEventsFilename;
        this.uploadTracker.registerUpload(aviId); this.uploadTracker.registerUpload(eventsId);
        let avi;
        try {
            const encoded = await this.encode(part);
            avi = await this.uploadWithRetry(encoded, part.filename, aviId);
        } catch (error) {
            console.error('[raw-patch] AVI encoding failed', error);
            this.uploadTracker.settleUpload(aviId, UPLOAD_STATUS.FAILED);
            avi = {uploadId: aviId, filename: part.filename, status: UPLOAD_STATUS.FAILED, attempts: 0, error};
        } finally {
            part.bytes = null;
        }
        if (avi.status !== UPLOAD_STATUS.SUCCEEDED) {
            this.uploadTracker.settleUpload(eventsId, UPLOAD_STATUS.FAILED);
            return {filename: part.filename, faceEventsFilename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, avi,
                faceEvents: {uploadId: eventsId, filename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, attempts: 0}};
        }
        const faceEvents = await this.uploadWithRetry(JSON.stringify(part.faceEvents), part.faceEventsFilename, eventsId);
        return {filename: part.filename, faceEventsFilename: part.faceEventsFilename,
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
        console.error('[raw-patch] Upload failed after ' + this.maxAttempts + ' attempts', error);
        return {uploadId, filename, status: UPLOAD_STATUS.FAILED, attempts: this.maxAttempts, error};
    }
}

export const JatosPatchSink = RawPatchSink;
