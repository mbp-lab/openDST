import facecropAssets from './generated/facecropAssets.json';

const Facecrop = require('./generated/facecrop');
const {createCaptureSession, createJatosTransport, validateConfiguration} = Facecrop;

export const FACE_CROP_CAPTURE_MODES = ['off', 'calibration', 'all'];

export function resolveStudyResultId(props = {}, jatosApi = typeof window !== 'undefined' ? window.jatos : null) {
    return props.studyResultId || (jatosApi && jatosApi.studyResultId) || null;
}

/** Translate the study's existing environment controls into the standalone library's strict API. */
export function resolveFaceCropStudyConfiguration(environment = process.env, studyPage) {
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

/** A stable study handle keeps capture cleanup independent from MediaRecorder and camera-track ownership. */
export function createFaceCropStudySession({video, props = {}}) {
    const options = resolveFaceCropStudyConfiguration(undefined, props.studyPage);
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
    const trackedArtifacts = new Set();
    let captureId = null;
    let settled = false;
    const settleSentinel = status => {
        if (settled) return;
        settled = true;
        if (track) (status === 'complete' ? track.succeeded : track.failed)(`face-crop-session-${captureId}`);
    };
    const emit = event => {
        if (event && event.type === 'status') notify(props, {...event, capture: event.capture || {captureId, context}});
        if (event && event.type === 'artifact') {
            const artifact = event.artifact;
            if (track && artifact && artifact.uploadId) {
                if (!trackedArtifacts.has(artifact.uploadId)) {
                    trackedArtifacts.add(artifact.uploadId);
                    track.register(artifact.uploadId);
                }
                if (artifact.status === 'succeeded') track.succeeded(artifact.uploadId);
                else if (artifact.status !== 'pending') track.failed(artifact.uploadId);
            }
            if (typeof props.onFaceCropArtifact === 'function') props.onFaceCropArtifact(event);
        }
    };
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const assetBaseUrl = new URL(`${publicUrl}${facecropAssets.publicSubpath}`, window.location.href).href;
    const session = createCaptureSession({video, filenamePrefix, context, config: options.config,
        assetBaseUrl, transport: createJatosTransport(jatosApi), onEvent: emit});
    captureId = session.captureId;
    if (track) track.register(`face-crop-session-${captureId}`);
    const finish = (operation, reportResult = false) => Promise.resolve().then(operation).then(result => {
        if (reportResult && !settled) notify(props, result);
        settleSentinel(result && result.status);
        return result;
    }, error => { settleSentinel('failed'); throw error; });
    return {
        captureId,
        prepare: () => session.prepare(),
        start: () => session.start(),
        // Core disposal chooses finalization for started captures and abort for unstarted ones.
        stop: () => finish(() => session.dispose()),
        abort: () => finish(() => session.abort(), true)
    };
}

function notify(props, metadata) {
    if (typeof props.onFaceCropStatus === 'function') props.onFaceCropStatus(metadata);
}

export function prepareFaceCropCaptureSession({webcam, props}) {
    let studySession;
    try { studySession = createFaceCropStudySession({video: webcam && webcam.video, props}); }
    catch (error) { notify(props, {status: 'incomplete', reason: error.message}); return null; }
    if (studySession) studySession.prepare().catch(error => notify(props, {status: 'incomplete', reason: error.message}));
    return studySession;
}

export function startFaceCropCaptureSession({webcam, props}) {
    let studySession;
    try { studySession = createFaceCropStudySession({video: webcam && webcam.video, props}); }
    catch (error) { notify(props, {status: 'incomplete', reason: error.message}); return null; }
    if (studySession) studySession.start().catch(error => notify(props, {status: 'incomplete', reason: error.message}));
    return studySession;
}

export async function stopFaceCropCaptureSession(session) {
    if (session) return session.stop();
}
