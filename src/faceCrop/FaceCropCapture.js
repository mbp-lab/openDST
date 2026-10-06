import facecropAssets from './generated/facecropAssets.json';

const Facecrop = require('./generated/facecrop');
const {createCaptureSession, createJatosTransport, validateConfiguration} = Facecrop;

export const FACE_CROP_CAPTURE_MODES = ['off', 'calibration', 'all'];

export function resolveStudyResultId(props = {}, jatosApi = typeof window !== 'undefined' ? window.jatos : null) {
    return props.studyResultId || (jatosApi && jatosApi.studyResultId) || null;
}

/** Translate the study's existing environment controls into the standalone library's strict API. */
export function resolveFaceCropHostConfiguration(environment = process.env, studyPage) {
    const requestedMode = environment.REACT_APP_FACE_CROP_RECORDING_MODE || 'off';
    if (!FACE_CROP_CAPTURE_MODES.includes(requestedMode)) {
        throw new TypeError('REACT_APP_FACE_CROP_RECORDING_MODE must be off, calibration, or all');
    }
    const mode = requestedMode;
    if (environment.REACT_APP_FACE_DETECTION_DELEGATE !== undefined ||
        environment.REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD !== undefined) {
        throw new TypeError('Face-crop delegate and suppression environment settings are no longer supported');
    }
    const enabled = mode === 'all' || (mode === 'calibration' && studyPage === 'introduction');
    if (!enabled) return {requestedMode, mode, enabled: false, config: null};

    const number = (name, value, minimum, maximum, fallback, integer = false) => {
        if (value === undefined || value === '') return fallback;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isSafeInteger(parsed))) {
            throw new TypeError(`${name} must be a number between ${minimum} and ${maximum}`);
        }
        return parsed;
    };
    const defaults = validateConfiguration();
    const config = validateConfiguration({
        roi: {
            smoothingTauMs: number('REACT_APP_FACE_CROP_SMOOTHING_TAU_MS', environment.REACT_APP_FACE_CROP_SMOOTHING_TAU_MS, 0, 10000, defaults.roi.smoothingTauMs, true),
            scale: number('REACT_APP_FACE_CROP_SCALE', environment.REACT_APP_FACE_CROP_SCALE, 1, 3, defaults.roi.scale),
            verticalShiftRatio: number('REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO', environment.REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO, -1, 1, defaults.roi.verticalShiftRatio)
        },
        detector: {
            minConfidence: number('REACT_APP_FACE_DETECTION_MIN_CONFIDENCE', environment.REACT_APP_FACE_DETECTION_MIN_CONFIDENCE, 0, 1, defaults.detector.minConfidence)
        },
        pipeline: {
            analysisWorkerCount: number('REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT', environment.REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT, 1, 2, defaults.pipeline.analysisWorkerCount, true)
        },
        persistence: defaults.persistence,
        diagnostics: false
    });
    return {requestedMode, mode, enabled: true, config};
}

/** A stable host handle keeps capture cleanup independent from MediaRecorder and camera-track ownership. */
export function createFaceCropHostSession({video, props = {}}) {
    const options = resolveFaceCropHostConfiguration(undefined, props.studyPage);
    if (!options.enabled) return null;
    const jatosApi = typeof window !== 'undefined' ? window.jatos : null;
    if (!video || !jatosApi || typeof jatosApi.uploadResultFile !== 'function') {
        const error = new Error('Face-crop capture requires a video element and JATOS upload API');
        notify(props, {status: 'incomplete', reason: error.message, capture: {context: {studyPage: props.studyPage}}});
        return null;
    }

    const context = {studyPage: props.studyPage || null, videoCounter: props.videoCounter || null,
        studyResultId: props.studyResultId || jatosApi.studyResultId || null};
    const prefixStudyId = String(context.studyResultId || 'study').replace(/[^A-Za-z0-9_-]/g, '_');
    const filenamePrefix = `${prefixStudyId}_${props.studyPage || 'study'}_${props.videoCounter || 0}`;
    const track = typeof props.markVideoAsUploading === 'function' ? {
        register: props.markVideoAsUploading,
        succeeded: props.markVideoAsUploaded || (() => {}),
        failed: props.markVideoAsFailed || (() => {})
    } : null;
    const baseTransport = createJatosTransport(jatosApi);
    let captureId = null;
    let writeNumber = 0;
    const transport = {
        async write({filename, payload}) {
            const uploadId = `face-crop-write-${captureId}-${++writeNumber}`;
            if (track) track.register(uploadId);
            try {
                const result = await baseTransport.write({filename, payload});
                if (track) track.succeeded(uploadId);
                return result;
            } catch (error) {
                if (track) track.failed(uploadId);
                throw error;
            }
        }
    };

    let settled = false;
    let sentinelId = null;
    const settleSentinel = status => {
        if (settled) return;
        settled = true;
        if (track) (status === 'complete' ? track.succeeded : track.failed)(sentinelId);
    };
    const emit = event => {
        if (event && event.type === 'status') notify(props, {...event, capture: event.capture || {captureId, context}});
        if (event && event.type === 'artifact' && typeof props.onFaceCropArtifact === 'function') props.onFaceCropArtifact(event);
    };
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const assetBaseUrl = new URL(`${publicUrl}${facecropAssets.publicSubpath}`, window.location.href).href;
    const session = createCaptureSession({video, filenamePrefix, context, config: options.config,
        assetBaseUrl, transport, onEvent: emit});
    captureId = session.captureId;
    sentinelId = `face-crop-session-${captureId}`;
    if (track) track.register(sentinelId);
    let preparePromise = null;
    let stopPromise = null;
    let abortPromise = null;
    let started = false;
    return {
        captureId,
        prepare() {
            if (!preparePromise) preparePromise = Promise.resolve().then(() => session.prepare());
            return preparePromise;
        },
        async start() {
            if (abortPromise) return abortPromise;
            await this.prepare();
            started = true;
            return session.start();
        },
        stop() {
            if (abortPromise) return abortPromise;
            if (!stopPromise) stopPromise = Promise.resolve().then(() => started ? session.stop() : session.dispose()).then(result => {
                settleSentinel(result && result.status === 'complete' ? 'complete' : 'failed');
                return result;
            }, error => { settleSentinel('failed'); throw error; });
            return stopPromise;
        },
        abort() {
            if (!abortPromise) abortPromise = Promise.resolve().then(() => session.abort()).then(result => {
                // Started writes remain observable; participant withdrawal must not await an uninterruptible network request.
                notify(props, {...result, artifacts: (result.artifacts || []).map(({completion, ...artifact}) => artifact)});
                settleSentinel('failed');
                return result;
            }, error => { settleSentinel('failed'); throw error; });
            return abortPromise;
        }
    };
}

function notify(props, metadata) {
    if (typeof props.onFaceCropStatus === 'function') props.onFaceCropStatus(metadata);
}

export function prepareFaceCropCaptureSession({webcam, props}) {
    let hostSession;
    try { hostSession = createFaceCropHostSession({video: webcam && webcam.video, props}); }
    catch (error) { notify(props, {status: 'incomplete', reason: error.message}); return null; }
    if (hostSession) hostSession.prepare().catch(error => notify(props, {status: 'incomplete', reason: error.message}));
    return hostSession;
}

export function startFaceCropCaptureSession({webcam, props}) {
    let hostSession;
    try { hostSession = createFaceCropHostSession({video: webcam && webcam.video, props}); }
    catch (error) { notify(props, {status: 'incomplete', reason: error.message}); return null; }
    if (hostSession) hostSession.start().catch(error => notify(props, {status: 'incomplete', reason: error.message}));
    return hostSession;
}

export async function stopFaceCropCaptureSession(session) {
    if (session) return session.stop();
}
