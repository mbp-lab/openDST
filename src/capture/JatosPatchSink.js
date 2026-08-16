import {UPLOAD_STATUS} from '../uploadState';
import {encodeGzipAvi} from './AviPatchVideoEncoder';

export const MAX_PENDING_PATCH_PARTS = 2;
export const MAX_UPLOAD_ATTEMPTS = 3;

export class PatchSinkOverflowError extends Error {
    constructor() {
        super('Raw patch sink already owns ' + MAX_PENDING_PATCH_PARTS + ' pending parts');
        this.name = 'PatchSinkOverflowError';
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function validateSealedPart(part) {
    if (!part || typeof part !== 'object' || !(part.bytes instanceof Uint8Array)) {
        throw new Error('Sink accepts sealed parts with owned Uint8Array bytes');
    }
    if (part.bytes.byteLength !== part.byteLength || !Number.isSafeInteger(part.frameCount) || part.frameCount < 1) {
        throw new Error('Sealed part bytes do not match its metadata');
    }
    if (typeof part.filename !== 'string' || !part.filename.endsWith('.avi.gz')) {
        throw new Error('Sealed part must have a deterministic gzip-compressed AVI filename');
    }
    if (typeof part.faceEventsFilename !== 'string' || !part.faceEventsFilename.endsWith('.face-events.json') ||
        !part.faceEvents || part.faceEvents.aviFilename !== part.filename || part.faceEvents.frameCount !== part.frameCount) {
        throw new Error('Sealed part must have matching face-event sidecar metadata');
    }
}

function defaultUploadTracker() {
    return {
        registerUpload() {},
        settleUpload() {}
    };
}

/**
 * Bounded, best-effort transport for each gzip-compressed AVI part and its
 * required plain-JSON face-selection provenance sidecar.
 */
export class JatosPatchSink {
    constructor({
        uploadResultFile,
        uploadTracker = defaultUploadTracker(),
        encode = encodeGzipAvi,
        sleep = delay,
        maxPendingParts = MAX_PENDING_PATCH_PARTS,
        maxAttempts = MAX_UPLOAD_ATTEMPTS,
        retryDelayMs = 100
    }) {
        if (typeof uploadResultFile !== 'function') {
            throw new Error('JATOS uploadResultFile must be a function');
        }
        if (!uploadTracker || typeof uploadTracker.registerUpload !== 'function' || typeof uploadTracker.settleUpload !== 'function') {
            throw new Error('Upload tracker must provide registerUpload and settleUpload');
        }
        if (typeof encode !== 'function' || typeof sleep !== 'function') {
            throw new Error('Sink encoder and sleep dependencies must be functions');
        }
        if (!Number.isSafeInteger(maxPendingParts) || maxPendingParts < 1 || maxPendingParts > MAX_PENDING_PATCH_PARTS) {
            throw new Error('Max pending parts must be between 1 and ' + MAX_PENDING_PATCH_PARTS);
        }
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
            throw new Error('Retry configuration is invalid');
        }

        this.uploadResultFile = uploadResultFile;
        this.uploadTracker = uploadTracker;
        this.encode = encode;
        this.sleep = sleep;
        this.maxPendingParts = maxPendingParts;
        this.maxAttempts = maxAttempts;
        this.retryDelayMs = retryDelayMs;
        this.tail = Promise.resolve();
        this.pendingPartCount = 0;
        this.partResults = [];
        this.acceptingParts = true;
    }

    enqueuePart(part) {
        if (!this.acceptingParts) {
            throw new Error('Cannot enqueue a part after sink finalization begins');
        }
        validateSealedPart(part);
        if (this.pendingPartCount >= this.maxPendingParts) {
            throw new PatchSinkOverflowError();
        }

        this.pendingPartCount += 1;
        const completion = this.tail.then(() => this.uploadPart(part));
        this.tail = completion.then(result => {
            this.partResults.push(result);
            this.pendingPartCount -= 1;
        });
        return completion;
    }

    async finalize() {
        this.acceptingParts = false;
        await this.tail;
        return {parts: [...this.partResults]};
    }

    async uploadPart(part) {
        const aviUploadId = 'patch-part-' + part.filename;
        const eventsUploadId = 'patch-events-' + part.faceEventsFilename;
        this.uploadTracker.registerUpload(aviUploadId);
        this.uploadTracker.registerUpload(eventsUploadId);

        let aviResult;
        try {
            const encoded = await this.encode(part);
            part.bytes = null;
            aviResult = await this.uploadWithRetry({payload: encoded, filename: part.filename, uploadId: aviUploadId});
        } catch (error) {
            part.bytes = null;
            this.uploadTracker.settleUpload(aviUploadId, UPLOAD_STATUS.FAILED);
            aviResult = {uploadId: aviUploadId, filename: part.filename, status: UPLOAD_STATUS.FAILED, attempts: 0, error};
        }

        if (aviResult.status !== UPLOAD_STATUS.SUCCEEDED) {
            this.uploadTracker.settleUpload(eventsUploadId, UPLOAD_STATUS.FAILED);
            return {filename: part.filename, faceEventsFilename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, avi: aviResult,
                faceEvents: {uploadId: eventsUploadId, filename: part.faceEventsFilename, status: UPLOAD_STATUS.FAILED, attempts: 0}};
        }

        const faceEventsResult = await this.uploadWithRetry({
            payload: JSON.stringify(part.faceEvents),
            filename: part.faceEventsFilename,
            uploadId: eventsUploadId
        });
        const status = faceEventsResult.status === UPLOAD_STATUS.SUCCEEDED ? UPLOAD_STATUS.SUCCEEDED : UPLOAD_STATUS.FAILED;
        return {filename: part.filename, faceEventsFilename: part.faceEventsFilename, status, avi: aviResult, faceEvents: faceEventsResult};
    }

    async uploadWithRetry({payload, filename, uploadId}) {
        let error;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
                await this.uploadResultFile(payload, filename);
                this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.SUCCEEDED);
                return {uploadId, filename, status: UPLOAD_STATUS.SUCCEEDED, attempts: attempt};
            } catch (currentError) {
                error = currentError;
                if (attempt < this.maxAttempts) {
                    await this.sleep(this.retryDelayMs * attempt);
                }
            }
        }

        this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.FAILED);
        return {uploadId, filename, status: UPLOAD_STATUS.FAILED, attempts: this.maxAttempts, error};
    }
}
