import {createFaceCropStudySession, resolveFaceCropStudyConfiguration, resolveStudyResultId} from './FaceCropStudyAdapter';
import * as library from './generated/facecrop';

jest.mock('./generated/facecrop', () => {
    const actual = jest.requireActual('./generated/facecrop');
    return {...actual, createCaptureSession: jest.fn()};
});

function deferred() {
    let resolve;
    return {promise: new Promise(next => { resolve = next; }), get resolve() { return resolve; }};
}
function session(overrides = {}) {
    return {captureId: 'unique', prepare: jest.fn(() => Promise.resolve({status: 'ready'})),
        start: jest.fn(() => Promise.resolve({status: 'capturing'})),
        stop: jest.fn(() => Promise.resolve({status: 'complete'})),
        abort: jest.fn(() => Promise.resolve({status: 'aborted', artifacts: []})),
        dispose: jest.fn(() => Promise.resolve({status: 'aborted'})), ...overrides};
}
function props() {
    return {studyPage: 'speechTask', videoCounter: 2, studyResultId: 'result42',
        markVideoAsUploading: jest.fn(), markVideoAsUploaded: jest.fn(), markVideoAsFailed: jest.fn()};
}

const originalMode = process.env.REACT_APP_FACE_CROP_RECORDING_MODE;
const originalJatos = window.jatos;
afterEach(() => {
    if (originalMode === undefined) delete process.env.REACT_APP_FACE_CROP_RECORDING_MODE;
    else process.env.REACT_APP_FACE_CROP_RECORDING_MODE = originalMode;
    window.jatos = originalJatos;
    jest.clearAllMocks();
});

test('study policies select captures while provided invalid settings fail explicitly', () => {
    expect(resolveFaceCropStudyConfiguration({}, 'speechTask').enabled).toBe(false);
    expect(resolveFaceCropStudyConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'calibration'}, 'introduction').enabled).toBe(true);
    expect(resolveFaceCropStudyConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'calibration'}, 'speechTask').enabled).toBe(false);
    expect(() => resolveFaceCropStudyConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'typo'}, 'speechTask')).toThrow();
    expect(() => resolveFaceCropStudyConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all', REACT_APP_FACE_CROP_SCALE: 'oops'}, 'speechTask')).toThrow();
});

test('study defaults and partial environment settings match the library resolved configuration', () => {
    const environment = {REACT_APP_FACE_CROP_RECORDING_MODE: 'all'};
    expect(resolveFaceCropStudyConfiguration(environment, 'speechTask').config).toEqual(library.validateConfiguration());
    expect(resolveFaceCropStudyConfiguration({...environment, REACT_APP_FACE_CROP_SCALE: '2',
        REACT_APP_FACE_CROP_SMOOTHING_TAU_MS: '0', REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '2'}, 'speechTask').config)
        .toEqual(library.validateConfiguration({roi: {scale: 2, smoothingTauMs: 0}, pipeline: {analysisWorkerCount: 2}}));
});

test('study context, readable prefix and finalization sentinel survive multiple writes', async () => {
    process.env.REACT_APP_FACE_CROP_RECORDING_MODE = 'all';
    window.jatos = {uploadResultFile: jest.fn(() => Promise.resolve())};
    const capture = session(); library.createCaptureSession.mockReturnValue(capture);
    const tracked = props();
    const handle = createFaceCropStudySession({video: {}, props: tracked});
    const input = library.createCaptureSession.mock.calls[0][0];
    expect(input.filenamePrefix).toBe('result42_speechTask_2');
    expect(input.context).toEqual({studyResultId: 'result42', studyPage: 'speechTask', videoCounter: 2});
    expect(tracked.markVideoAsUploading).toHaveBeenCalledWith('face-crop-session-unique');
    await handle.prepare();
    expect(window.jatos.uploadResultFile).not.toHaveBeenCalled();
    await handle.start();
    await input.transport.write({filename: 'file1', payload: 'data'});
    expect(tracked.markVideoAsUploaded).not.toHaveBeenCalledWith('face-crop-session-unique');
    await handle.stop();
    expect(tracked.markVideoAsUploaded).toHaveBeenCalledWith('face-crop-session-unique');
    expect(capture.stop).toHaveBeenCalledTimes(1);
});

test('study abort supersedes a pending stop without waiting for started writes', async () => {
    process.env.REACT_APP_FACE_CROP_RECORDING_MODE = 'all';
    window.jatos = {uploadResultFile: jest.fn()};
    const stop = deferred(), write = deferred();
    const capture = session({stop: jest.fn(() => stop.promise),
        abort: jest.fn(() => Promise.resolve({status: 'aborted', artifacts: [{filename: 'part', completion: write.promise}]}))});
    library.createCaptureSession.mockReturnValue(capture);
    const tracked = props();
    const handle = createFaceCropStudySession({video: {}, props: tracked});
    await handle.start();
    const stopping = handle.stop();
    await Promise.resolve();
    const aborting = handle.abort();
    await Promise.resolve(); await Promise.resolve();
    expect(capture.abort).toHaveBeenCalledTimes(1);
    const outcome = await aborting;
    expect(outcome).toMatchObject({status: 'aborted'});
    expect(outcome.artifacts[0].completion).toBe(write.promise);
    write.resolve();
    expect(tracked.markVideoAsFailed).toHaveBeenCalledWith('face-crop-session-unique');
    stop.resolve({status: 'aborted'}); await stopping;
});

test('failed session validation never registers a stranded pending sentinel', () => {
    process.env.REACT_APP_FACE_CROP_RECORDING_MODE = 'all';
    window.jatos = {uploadResultFile: jest.fn()};
    library.createCaptureSession.mockReset().mockImplementation(() => { throw new TypeError('invalid input'); });
    const tracked = props();
    expect(() => createFaceCropStudySession({video: {}, props: tracked})).toThrow('invalid input');
    expect(tracked.markVideoAsUploading).not.toHaveBeenCalled();
});

test('prepare rejection remains disposable and settles the study sentinel once', async () => {
    process.env.REACT_APP_FACE_CROP_RECORDING_MODE = 'all';
    window.jatos = {uploadResultFile: jest.fn()};
    const prepareError = new Error('worker initialization failed');
    const capture = session({prepare: jest.fn(() => Promise.reject(prepareError))});
    library.createCaptureSession.mockReturnValue(capture);
    const tracked = props();
    const handle = createFaceCropStudySession({video: {}, props: tracked});
    await expect(handle.start()).rejects.toBe(prepareError);
    await expect(handle.stop()).resolves.toMatchObject({status: 'aborted'});
    expect(capture.dispose).toHaveBeenCalledTimes(1);
    expect(capture.stop).not.toHaveBeenCalled();
    expect(tracked.markVideoAsFailed).toHaveBeenCalledTimes(1);
    expect(tracked.markVideoAsFailed).toHaveBeenCalledWith('face-crop-session-unique');
});

test('JATOS identity fallback belongs to the study adapter', () => {
    expect(resolveStudyResultId({studyResultId: null}, {studyResultId: 163})).toBe(163);
    expect(resolveStudyResultId({studyResultId: 164}, {studyResultId: 163})).toBe(164);
    expect(resolveStudyResultId({}, null)).toBeNull();
});
