/*
 * Keep browser-facecrop's session, JATOS transport, runtime URL, and artifact
 * events out of the study components. This adapter translates openDST's task
 * context and upload tracker into the library API. WebcamCapture starts recordings,
 * finalizes introduction capture, and aborts interrupted teardown; Main finalizes
 * task capture before normal navigation.
 */
import * as Facecrop from './facecrop-generated/facecrop.js';
import facecropAssets from './facecrop-generated/facecropAssets.json';

let activeSession = null;
let studyUploadQueue = null;

// -----------------------------------------------------------------------------
// 1. Configuration
// Convert CRA's build-time environment strings into the library config.
// -----------------------------------------------------------------------------

function numberSetting(name, rawValue) {
    if (rawValue === undefined || rawValue.trim() === '') return undefined;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be numeric`);
    return value;
}

function booleanSetting(name, rawValue) {
    if (rawValue === undefined || rawValue.trim() === '') return undefined;
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;
    throw new TypeError(`${name} must be 'true' or 'false'`);
}

function settingsGroup(settings) {
    // Omit unset values so browser-facecrop can apply its own defaults.
    const definedSettings = Object.fromEntries(
        Object.entries(settings).filter(([, value]) => value !== undefined)
    );
    return Object.keys(definedSettings).length ? definedSettings : undefined;
}

function facecropConfigurationFromEnvironment() {
    // Keep process.env references literal for Create React App's build-time substitution.
    return settingsGroup({
        roi: settingsGroup({
            smoothingTauMs: numberSetting(
                'REACT_APP_FACECROP_ROI_SMOOTHING_TAU_MS',
                process.env.REACT_APP_FACECROP_ROI_SMOOTHING_TAU_MS
            ),
            scale: numberSetting(
                'REACT_APP_FACECROP_ROI_SCALE',
                process.env.REACT_APP_FACECROP_ROI_SCALE
            ),
            verticalShiftRatio: numberSetting(
                'REACT_APP_FACECROP_ROI_VERTICAL_SHIFT_RATIO',
                process.env.REACT_APP_FACECROP_ROI_VERTICAL_SHIFT_RATIO
            )
        }),
        detector: settingsGroup({
            minConfidence: numberSetting(
                'REACT_APP_FACECROP_DETECTOR_MIN_CONFIDENCE',
                process.env.REACT_APP_FACECROP_DETECTOR_MIN_CONFIDENCE
            )
        }),
        pipeline: settingsGroup({
            analysisWorkerCount: numberSetting(
                'REACT_APP_FACECROP_PIPELINE_ANALYSIS_WORKER_COUNT',
                process.env.REACT_APP_FACECROP_PIPELINE_ANALYSIS_WORKER_COUNT
            )
        }),
        persistence: settingsGroup({
            maxAttempts: numberSetting(
                'REACT_APP_FACECROP_PERSISTENCE_MAX_ATTEMPTS',
                process.env.REACT_APP_FACECROP_PERSISTENCE_MAX_ATTEMPTS
            ),
            retryDelayMs: numberSetting(
                'REACT_APP_FACECROP_PERSISTENCE_RETRY_DELAY_MS',
                process.env.REACT_APP_FACECROP_PERSISTENCE_RETRY_DELAY_MS
            )
        }),
        output: settingsGroup({
            resolution: numberSetting(
                'REACT_APP_FACECROP_OUTPUT_RESOLUTION',
                process.env.REACT_APP_FACECROP_OUTPUT_RESOLUTION
            ),
            maxPartMiB: numberSetting(
                'REACT_APP_FACECROP_OUTPUT_MAX_PART_MIB',
                process.env.REACT_APP_FACECROP_OUTPUT_MAX_PART_MIB
            )
        }),
        uploadDiagnostics: booleanSetting(
            'REACT_APP_FACECROP_UPLOAD_DIAGNOSTICS',
            process.env.REACT_APP_FACECROP_UPLOAD_DIAGNOSTICS
        )
    });
}

function isEnabled() {
    // Facecrop supplements the existing recording and data-persistence opt-ins.
    return process.env.REACT_APP_FACECROP_RECORDING === 'true'
        && process.env.REACT_APP_VIDEO_RECORDING === 'true'
        && process.env.REACT_APP_LOGGING === 'true';
}

// -----------------------------------------------------------------------------
// 2. Upload tracking
// Map Facecrop artifact upload events onto openDST's existing upload tracker.
// -----------------------------------------------------------------------------

function createUploadObserver(markVideoAsUploading, markVideoAsUploaded) {
    const uploadIndexes = new Map();
    // The library emits these transitions once; this map only translates IDs to host indexes.
    return event => {
        if (event.type === 'artifact_registered') {
            uploadIndexes.set(event.artifact.uploadId, markVideoAsUploading());
        } else if (event.type === 'artifact_settled') {
            markVideoAsUploaded(uploadIndexes.get(event.artifact.uploadId), event.artifact.status);
            uploadIndexes.delete(event.artifact.uploadId);
        }
    };
}

// -----------------------------------------------------------------------------
// 3. Task lifecycle
// Own the task-scoped session and adapt its lifecycle to the study flow.
// -----------------------------------------------------------------------------

/**
 * Create and start the optional capture for a task's existing webcam video.
 * Returns the library session for component cleanup, or null when a required input or
 * feature flag is missing, or synchronous setup fails. Startup continues asynchronously
 * after this returns; a returned session does not yet mean capture has started.
 */
export function startFacecropCapture({
    video,
    studyPage,
    studyResultId,
    videoCounter,
    markVideoAsUploading,
    markVideoAsUploaded
}) {
    const jatosApi = window.jatos;
    // Respect openDST's recording/persistence switches and require its video and backend.
    if (!isEnabled() || !video || !jatosApi) return null;

    // Main stops capture through this shared slot; overlapping task sessions would
    // leave it unable to identify which session to finalize.
    if (activeSession) {
        console.warn('Facecrop capture is already active');
        return null;
    }

    // Keep synchronous setup failures from interrupting the webcam/task startup.
    // Asynchronous startup outcomes are handled separately below.
    try {
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
        // The staging step writes the hashed runtime directory below CRA's public root.
        const assetBaseUrl = new URL(
            `${publicUrl}${facecropAssets.publicSubpath}`,
            window.location.origin
        ).href;
        if (!studyUploadQueue) {
            studyUploadQueue = Facecrop.createUploadQueue({transport: Facecrop.createJatosTransport(jatosApi)});
        }
        // Reuse the existing webcam video and attach task identifiers to its uploads.
        const session = Facecrop.createCaptureSession({
            video,
            filenamePrefix: `facecrop_${studyPage}_${videoCounter}`,
            context: {studyPage, studyResultId, videoCounter},
            assetBaseUrl,
            config: facecropConfigurationFromEnvironment(),
            uploadQueue: studyUploadQueue,
            onEvent: createUploadObserver(markVideoAsUploading, markVideoAsUploaded)
        });
        // Main needs access while startup is pending; WebcamCapture also retains this
        // same session so it can abort on unmount, including while stop is draining.
        activeSession = session;
        // The library cleans up ordinary startup failures. Release only this session's
        // slot: a late result must not clear a newer task's session.
        session.start().then(result => {
            if (result.status === 'capturing' || activeSession !== session) return;
            activeSession = null;
            console.warn('Facecrop capture did not start', result);
        }, error => {
            // Unexpected rejection: attempt cleanup through the library's abort API.
            console.error('Facecrop could not start', error);
            return abortFacecropCapture(session);
        });
        return session;
    } catch (error) {
        console.error('Facecrop could not start', error);
        return null;
    }
}

/**
 * Finalize introduction recording or the current task before Main advances it.
 * Forwards the library's result; resolves to null when there is no active session.
 */
export function stopActiveFacecropCapture() {
    const session = activeSession;
    activeSession = null;
    return session ? session.stop() : Promise.resolve(null);
}

/** Stop producing artifacts when the study is cancelled without video. */
export function abortActiveFacecropCapture() {
    return abortFacecropCapture(activeSession);
}

/**
 * Stop a capture during component teardown or interrupted navigation.
 * Also aborts a session whose stop is still draining; abort after finalization is a no-op.
 * This prevents further capture work; it does not delete artifacts already
 * submitted to JATOS. Forwards the library's result; resolves to null without a session.
 */
export function abortFacecropCapture(session) {
    if (activeSession === session) activeSession = null;
    return session ? session.abort() : Promise.resolve(null);
}
