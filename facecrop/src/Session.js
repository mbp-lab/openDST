import {FaceCropCaptureController} from './FaceCropCapture';
import {validateConfiguration, controllerConfiguration} from './Configuration';

let nextCapture = 0;
function identifier(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new TypeError(label + ' must contain only letters, digits, underscores, or hyphens');
    }
    return value;
}
function captureIdentifier() {
    const cryptoApi = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return 'capture-' + cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        const bytes = cryptoApi.getRandomValues(new Uint32Array(4));
        return 'capture-' + Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
    }
    // Fallback supports older secure-context browsers; an application can supply its own globally unique ID.
    return 'capture-' + Date.now().toString(36) + '-' + (++nextCapture).toString(36) + '-' + Math.random().toString(36).slice(2);
}
function cloneContext(context) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('context must be a JSON object');
    const seen = new Set();
    function visit(value) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (typeof value !== 'object' || seen.has(value)) throw new TypeError('context must contain finite JSON values without cycles');
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
            throw new TypeError('context must contain plain JSON objects');
        }
        seen.add(value); Object.keys(value).forEach(key => visit(value[key])); seen.delete(value);
    }
    visit(context);
    return JSON.parse(JSON.stringify(context));
}
function reasonCode(status) {
    return {unsupported: 'CAPABILITY_UNSUPPORTED', incomplete: 'CAPTURE_INCOMPLETE', aborted: 'CAPTURE_ABORTED'}[status] || null;
}

/** No worker creation, permission prompt, persistence, or global mutation occurs here. */
export function createCaptureSession(options) {
    if (!options || typeof options !== 'object') throw new TypeError('Capture options are required');
    const {video, transport, onEvent} = options;
    if (!video || typeof video !== 'object') throw new TypeError('video must be an application-owned video element');
    if (!transport || typeof transport.write !== 'function') throw new TypeError('transport.write is required');
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    const config = validateConfiguration(options.config);
    const captureId = options.captureId === undefined ? captureIdentifier() : identifier(options.captureId, 'captureId');
    const filenamePrefix = options.filenamePrefix === undefined ? '' :
        (options.filenamePrefix === '' ? '' : identifier(options.filenamePrefix, 'filenamePrefix'));
    const context = cloneContext(options.context === undefined ? {} : options.context);
    if (typeof options.assetBaseUrl !== 'string' || !options.assetBaseUrl) throw new TypeError('assetBaseUrl is required');
    let assetBaseUrl;
    try { assetBaseUrl = new URL(options.assetBaseUrl); } catch (_) { throw new TypeError('assetBaseUrl must be an absolute URL'); }
    if (!['http:', 'https:'].includes(assetBaseUrl.protocol) || assetBaseUrl.search || assetBaseUrl.hash) {
        throw new TypeError('assetBaseUrl must be an HTTP(S) directory URL without query or fragment');
    }
    if (!assetBaseUrl.pathname.endsWith('/')) assetBaseUrl.pathname += '/';
    const observerErrors = [];
    const emit = event => {
        if (!onEvent) return;
        try { onEvent(event); } catch (error) {
            observerErrors.push({name: error.name || 'Error', message: error.message || String(error)});
        }
    };
    const controller = new FaceCropCaptureController({video, captureId, filenamePrefix, context,
        configuration: controllerConfiguration(config), assetBaseUrl: assetBaseUrl.href,
        uploadResultFile: (payload, filename) => transport.write({filename, payload}),
        onArtifact: event => emit(event),
        onStatus: metadata => emit({type: 'status', ...metadata, reasonCode: reasonCode(metadata.status)})});
    let terminalPromise = null;
    function result() {
        const metadata = controller.metadata(controller.status);
        const status = controller.aborted ? 'aborted' : controller.state === 'prepared' ? 'ready' : controller.status;
        return {status, reasonCode: reasonCode(status), reason: controller.incompleteReason ||
            (status === 'aborted' ? 'Capture aborted by the study' : controller.terminalReason || null),
            capture: {captureId, context: cloneContext(context)}, statistics: metadata.statistics,
            capability: metadata.capability, artifacts: controller.sink.inventory(), manifest: controller.manifest,
            observerErrors: [...observerErrors]};
    }
    async function execute(operation) {
        try { await operation(); } catch (error) {
            if (!controller.aborted) {
                controller.incompleteReason = error.message || String(error);
                controller.cancelFrameWait();
                await controller.closeWorker();
                controller.terminate(controller.started ? 'incomplete' : 'unsupported', controller.incompleteReason);
            }
        }
        return result();
    }
    const session = {
        captureId, config,
        prepare: () => terminalPromise || execute(() => controller.prepare()),
        start: () => terminalPromise || execute(() => controller.start()),
        stop: () => {
            if (!terminalPromise) terminalPromise = execute(() => controller.stop());
            return terminalPromise;
        },
        abort: () => {
            // Abort supersedes stop until terminal persistence has finished.
            if (!controller.aborted && controller.state !== 'terminal') terminalPromise = execute(() => controller.abort());
            return terminalPromise || Promise.resolve(result());
        },
        dispose: () => controller.started ? session.stop() : session.abort(),
        getResult: result
    };
    return Object.freeze(session);
}
