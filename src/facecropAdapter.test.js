import * as Facecrop from './facecrop-generated/facecrop.js';
import {abortFacecropCapture, startFacecropCapture, stopActiveFacecropCapture} from './facecropAdapter';

jest.mock('./facecrop-generated/facecrop.js', () => ({
    createCaptureSession: jest.fn(),
    createUploadQueue: jest.fn(() => ({})),
    createJatosTransport: jest.fn(api => api)
}));

const environmentNames = [
    'REACT_APP_FACECROP_RECORDING', 'REACT_APP_VIDEO_RECORDING', 'REACT_APP_LOGGING',
    'REACT_APP_FACECROP_UPLOAD_DIAGNOSTICS', 'REACT_APP_FACECROP_DIAGNOSTICS',
    'REACT_APP_FACECROP_ROI_SMOOTHING_TAU_MS', 'REACT_APP_FACECROP_ROI_SCALE',
    'REACT_APP_FACECROP_ROI_VERTICAL_SHIFT_RATIO', 'REACT_APP_FACECROP_DETECTOR_MIN_CONFIDENCE',
    'REACT_APP_FACECROP_PIPELINE_ANALYSIS_WORKER_COUNT', 'REACT_APP_FACECROP_PERSISTENCE_MAX_ATTEMPTS',
    'REACT_APP_FACECROP_PERSISTENCE_RETRY_DELAY_MS',
    'REACT_APP_FACECROP_OUTPUT_RESOLUTION', 'REACT_APP_FACECROP_OUTPUT_MAX_PART_MIB'
];
const originalEnvironment = environmentNames.map(name => process.env[name]);
const originalJatos = window.jatos;
let sessions;
let startupPromises;
let warn;
let error;

beforeEach(() => {
    environmentNames.slice(0, 3).forEach(name => { process.env[name] = 'true'; });
    environmentNames.slice(3).forEach(name => { delete process.env[name]; });
    window.jatos = {};
    sessions = [];
    startupPromises = [];
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    Facecrop.createCaptureSession.mockImplementation(options => {
        const startup = startupPromises.shift() || Promise.resolve({status: 'capturing'});
        const session = {
            start: jest.fn(() => startup),
            stop: jest.fn(() => Promise.resolve({status: 'complete'})),
            abort: jest.fn(() => Promise.resolve({status: 'aborted'}))
        };
        sessions.push({options, session});
        return session;
    });
});

afterEach(async () => {
    await stopActiveFacecropCapture();
    warn.mockRestore();
    error.mockRestore();
    jest.clearAllMocks();
    environmentNames.forEach((name, index) => {
        if (originalEnvironment[index] === undefined) delete process.env[name];
        else process.env[name] = originalEnvironment[index];
    });
    window.jatos = originalJatos;
});

function inputs() {
    return {video: {}, studyPage: 'mathTask', studyResultId: 'study-1', videoCounter: 1,
        markVideoAsUploading: jest.fn(() => 37), markVideoAsUploaded: jest.fn()};
}

test('forwards the upload diagnostics opt-in under the library configuration key', () => {
    process.env.REACT_APP_FACECROP_UPLOAD_DIAGNOSTICS = 'true';
    process.env.REACT_APP_FACECROP_DIAGNOSTICS = 'false';
    startFacecropCapture(inputs());
    expect(sessions[0].options.config).toMatchObject({uploadDiagnostics: true});
});

test('creates one study-scoped queue and shares it across sequential captures', async () => {
    const callbacks = inputs();
    const first = startFacecropCapture(callbacks);
    const queue = sessions[0].options.uploadQueue;
    await stopActiveFacecropCapture();
    const second = startFacecropCapture({...callbacks, videoCounter: 2});
    expect(queue).toBeTruthy();
    expect(sessions[1].options.uploadQueue).toBe(queue);
    expect(sessions[0].options).not.toHaveProperty('transport');
    expect(first).not.toBe(second);
});

test('does not forward the removed diagnostics environment setting', () => {
    process.env.REACT_APP_FACECROP_DIAGNOSTICS = 'true';
    startFacecropCapture(inputs());
    expect(sessions[0].options.config).toBeUndefined();
});

test('forwards configured output resolution and whole-MiB part size as public settings', () => {
    process.env.REACT_APP_FACECROP_OUTPUT_RESOLUTION = '128';
    process.env.REACT_APP_FACECROP_OUTPUT_MAX_PART_MIB = '1';
    startFacecropCapture(inputs());
    expect(sessions[0].options.config.output).toEqual({resolution: 128, maxPartMiB: 1});
});

test('forwards an exact fractional-MiB part size without converting units in the adapter', () => {
    process.env.REACT_APP_FACECROP_OUTPUT_MAX_PART_MIB = '0.0625';
    startFacecropCapture(inputs());
    expect(sessions[0].options.config.output).toEqual({maxPartMiB: 0.0625});
});

test('omits unset output settings so library defaults apply', () => {
    startFacecropCapture(inputs());
    expect(sessions[0].options.config).toBeUndefined();
});

test('tracks explicit upload transitions and preserves late settlement after abort', async () => {
    const callbacks = inputs();
    const handle = startFacecropCapture(callbacks);
    expect(handle).toBe(sessions[0].session);
    const {onEvent} = sessions[0].options;
    const artifact = {uploadId: 'upload-1', filename: 'part.avi.gz', status: 'pending', attempts: 0};
    onEvent({type: 'artifact_registered', artifact});
    onEvent({type: 'artifact', artifact: {...artifact, attempts: 1}});
    onEvent({type: 'artifact', artifact: {...artifact, attempts: 2}});
    await abortFacecropCapture(handle);
    onEvent({type: 'artifact_settled', artifact: {...artifact, status: 'uncertain', attempts: 2}});
    expect(callbacks.markVideoAsUploading).toHaveBeenCalledTimes(1);
    expect(callbacks.markVideoAsUploaded).toHaveBeenCalledTimes(1);
    expect(callbacks.markVideoAsUploaded).toHaveBeenCalledWith(37, 'uncertain');
});

test('failed startup frees the capture slot without overwriting its structured failure', async () => {
    const result = {status: 'unsupported', reasonCode: 'CAPABILITY_UNSUPPORTED', reason: 'no video frame callbacks'};
    const startup = Promise.resolve(result);
    startupPromises.push(startup);
    startFacecropCapture(inputs());
    await startup;
    await Promise.resolve();
    expect(sessions[0].session.abort).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Facecrop capture did not start', result);
    expect(startFacecropCapture(inputs())).not.toBeNull();
});

test('a stale startup result cannot release a newer capture', async () => {
    let resolve;
    const startup = new Promise(next => { resolve = next; });
    startupPromises.push(startup);
    const old = startFacecropCapture(inputs());
    await abortFacecropCapture(old);
    const current = startFacecropCapture(inputs());
    resolve({status: 'unsupported'});
    await startup;
    await Promise.resolve();
    await stopActiveFacecropCapture();
    expect(current.stop).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
});

test('unexpected startup rejection still uses best-effort abort cleanup', async () => {
    const failure = new Error('unexpected API rejection');
    const startup = Promise.reject(failure);
    startupPromises.push(startup);
    startFacecropCapture(inputs());
    await startup.catch(() => {});
    await Promise.resolve();
    expect(sessions[0].session.abort).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Facecrop could not start', failure);
    expect(startFacecropCapture(inputs())).not.toBeNull();
});

test('teardown can abort a draining capture without releasing a newer active capture', async () => {
    const old = startFacecropCapture(inputs());
    let finish;
    old.stop.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const stopping = stopActiveFacecropCapture();
    const current = startFacecropCapture(inputs());
    await abortFacecropCapture(old);
    expect(old.abort).toHaveBeenCalledTimes(1);
    expect(current.abort).not.toHaveBeenCalled();
    finish({status: 'aborted'});
    await expect(stopping).resolves.toMatchObject({status: 'aborted'});
    await stopActiveFacecropCapture();
    expect(current.stop).toHaveBeenCalledTimes(1);
});

test('each session observer retains its upload indexes when a newer session replaces it', async () => {
    const oldCallbacks = inputs();
    const old = startFacecropCapture(oldCallbacks);
    const oldObserver = sessions[0].options.onEvent;
    const artifact = {uploadId: 'upload-1', filename: 'part.avi.gz', status: 'pending', attempts: 0};
    oldObserver({type: 'artifact_registered', artifact});
    await abortFacecropCapture(old);
    const currentCallbacks = inputs();
    currentCallbacks.markVideoAsUploading.mockReturnValue(38);
    startFacecropCapture(currentCallbacks);
    const currentObserver = sessions[1].options.onEvent;
    currentObserver({type: 'artifact_registered', artifact});
    oldObserver({type: 'artifact_settled', artifact: {...artifact, status: 'uncertain'}});
    currentObserver({type: 'artifact_settled', artifact: {...artifact, status: 'succeeded'}});
    expect(oldCallbacks.markVideoAsUploaded).toHaveBeenCalledWith(37, 'uncertain');
    expect(currentCallbacks.markVideoAsUploaded).toHaveBeenCalledWith(38, 'succeeded');
});
