import {UPLOAD_STATUS} from '../uploadState';

export const MAX_PENDING_PATCH_PARTS = 2;
export const MAX_UPLOAD_ATTEMPTS = 3;

export class PatchSinkOverflowError extends Error {
    constructor() {
        super(`Raw patch sink already owns ${MAX_PENDING_PATCH_PARTS} pending parts`);
        this.name = 'PatchSinkOverflowError';
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function defaultBlob(chunks, options) {
    return new window.Blob(chunks, options);
}

/**
 * Compresses complete RGB24 bytes with the browser's native gzip stream.
 */
export async function gzipRgb24(bytes) {
    if (typeof window.CompressionStream !== 'function') {
        throw new Error('Native CompressionStream is unavailable');
    }
    if (typeof window.Blob !== 'function' || typeof window.Response !== 'function') {
        throw new Error('Native Blob and Response APIs are required for gzip compression');
    }

    const stream = new window.Blob([bytes]).stream().pipeThrough(new window.CompressionStream('gzip'));
    return new window.Response(stream).blob();
}

function validateSealedPart(part) {
    if (!part || typeof part !== 'object' || !(part.bytes instanceof Uint8Array)) {
        throw new Error('Sink accepts sealed parts with owned Uint8Array bytes');
    }
    if (part.bytes.byteLength !== part.byteLength || !Number.isSafeInteger(part.frameCount) || part.frameCount < 1) {
        throw new Error('Sealed part bytes do not match its metadata');
    }
    if (typeof part.filename !== 'string' || !part.filename.endsWith('.rgb24.gz')) {
        throw new Error('Sealed part must have a deterministic gzip filename');
    }
}

function defaultUploadTracker() {
    return {
        registerUpload() {},
        settleUpload() {}
    };
}

/**
 * Bounded, best-effort transport for sealed raw-patch parts and their manifest.
 */
export class JatosPatchSink {
    constructor({
        uploadResultFile,
        uploadTracker = defaultUploadTracker(),
        compress = gzipRgb24,
        createBlob = defaultBlob,
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
        if (typeof compress !== 'function' || typeof createBlob !== 'function' || typeof sleep !== 'function') {
            throw new Error('Sink dependencies must be functions');
        }
        if (!Number.isSafeInteger(maxPendingParts) || maxPendingParts < 1 || maxPendingParts > MAX_PENDING_PATCH_PARTS) {
            throw new Error(`Max pending parts must be between 1 and ${MAX_PENDING_PATCH_PARTS}`);
        }
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
            throw new Error('Retry configuration is invalid');
        }

        this.uploadResultFile = uploadResultFile;
        this.uploadTracker = uploadTracker;
        this.compress = compress;
        this.createBlob = createBlob;
        this.sleep = sleep;
        this.maxPendingParts = maxPendingParts;
        this.maxAttempts = maxAttempts;
        this.retryDelayMs = retryDelayMs;
        this.queue = [];
        this.pendingPartCount = 0;
        this.partResults = [];
        this.worker = null;
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
        const completion = new Promise(resolve => {
            this.queue.push({part, resolve});
        });
        this.startWorker();
        return completion;
    }

    async finalize(manifestOrBuilder) {
        this.acceptingParts = false;
        await this.whenIdle();
        const manifest = typeof manifestOrBuilder === 'function'
            ? manifestOrBuilder([...this.partResults])
            : manifestOrBuilder;
        if (!manifest || typeof manifest.filename !== 'string' || !manifest.filename.endsWith('_patch_manifest.json')) {
            throw new Error('Manifest must include its deterministic filename');
        }

        const manifestBytes = this.createBlob([JSON.stringify(manifest)], {type: 'application/json'});
        const manifestResult = await this.uploadWithRetry({
            payload: manifestBytes,
            filename: manifest.filename,
            uploadId: `patch-manifest-${manifest.filename}`
        });

        return {
            parts: [...this.partResults],
            manifest: manifestResult
        };
    }

    async whenIdle() {
        while (this.worker) {
            await this.worker;
        }
    }

    startWorker() {
        if (!this.worker) {
            this.worker = this.drainQueue().finally(() => {
                this.worker = null;
                if (this.queue.length > 0) {
                    this.startWorker();
                }
            });
        }
    }

    async drainQueue() {
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            const result = await this.uploadPart(task.part);
            this.partResults.push(result);
            this.pendingPartCount -= 1;
            task.resolve(result);
        }
    }

    async uploadPart(part) {
        const uploadId = `patch-part-${part.filename}`;
        this.uploadTracker.registerUpload(uploadId);

        try {
            const compressed = await this.compress(part.bytes);
            part.bytes = null;
            return await this.uploadWithRetry({payload: compressed, filename: part.filename, uploadId, alreadyRegistered: true});
        } catch (error) {
            part.bytes = null;
            this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.FAILED);
            return {uploadId, filename: part.filename, status: UPLOAD_STATUS.FAILED, attempts: 0, error};
        }
    }

    async uploadWithRetry({payload, filename, uploadId, alreadyRegistered = false}) {
        if (!alreadyRegistered) {
            this.uploadTracker.registerUpload(uploadId);
        }

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
