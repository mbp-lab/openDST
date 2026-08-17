// worker-loader 2 is used because this project is built with CRA 3 / Webpack 4.
export class RawPatchPipelineWorker {
    constructor() {
        // eslint-disable-next-line import/no-webpack-loader-syntax
        const WorkerConstructor = require('worker-loader!./RawPatchPipeline.worker').default;
        this.worker = new WorkerConstructor();
        this.nextRequestId = 1;
        this.pending = new Map();
        this.closed = false;
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => this.handleFatalError(new Error(event.message || 'Raw patch worker crashed'));
        this.worker.onmessageerror = () => this.handleFatalError(new Error('Raw patch worker message could not be decoded'));
    }

    handleMessage(message) {
        const pending = message && this.pending.get(message.id);
        if (!pending) {
            return;
        }
        this.pending.delete(message.id);
        if (message.error) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
    }

    failAll(error) {
        this.pending.forEach(pending => pending.reject(error));
        this.pending.clear();
    }

    handleFatalError(error) {
        this.closed = true;
        this.worker.terminate();
        this.failAll(error);
    }

    request(type, payload = {}, transfer = []) {
        if (this.closed) {
            return Promise.reject(new Error('Raw patch worker is closed'));
        }
        const id = this.nextRequestId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
            try {
                this.worker.postMessage({id, type, payload}, transfer);
            } catch (error) {
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    initialize(payload) {
        return this.request('initialize', payload);
    }

    processFrame(payload) {
        return this.request('processFrame', payload, [payload.frame]);
    }

    finish() {
        return this.request('finish');
    }

    async close() {
        if (this.closed) {
            return;
        }
        try {
            await this.request('close');
        } finally {
            this.closed = true;
            this.worker.terminate();
            this.failAll(new Error('Raw patch worker was terminated'));
        }
    }
}

export function createRawPatchPipelineWorker() {
    return new RawPatchPipelineWorker();
}
