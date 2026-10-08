import WebcamCapture from './WebcamCapture';
import {abortFacecropCapture, startFacecropCapture, stopActiveFacecropCapture} from '../facecropAdapter';

jest.mock('../facecropAdapter', () => ({
    abortFacecropCapture: jest.fn(),
    startFacecropCapture: jest.fn(),
    stopActiveFacecropCapture: jest.fn()
}));

let session;
beforeEach(() => {
    jest.useFakeTimers();
    session = {};
    startFacecropCapture.mockReturnValue(session);
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
});

function introductionRecording() {
    const component = new WebcamCapture({
        studyPage: 'introduction', studyResultId: 92, videoCounter: 1,
        markVideoAsUploading: jest.fn(), markVideoAsUploaded: jest.fn()
    });
    component.webcamRef.current = {video: {}, stream: {}};
    component.createMediaRecorder = jest.fn(async () => {
        component.mediaStreamRecorder = {start: jest.fn(), stop: jest.fn()};
    });
    component.setState = update => Object.assign(component.state, update);
    return component;
}

test('introduction finalizes facecrop before playback unmount without aborting its pending stop', async () => {
    const component = introductionRecording();
    await component.startRecording();
    expect(startFacecropCapture).toHaveBeenCalledWith(expect.objectContaining({
        video: component.webcamRef.current.video, studyPage: 'introduction', videoCounter: 1
    }));

    let finish;
    stopActiveFacecropCapture.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const stopped = component.stopRecording();
    expect(stopActiveFacecropCapture).toHaveBeenCalledTimes(1);
    expect(component.facecropSession).toBeNull();
    component.componentWillUnmount();
    expect(abortFacecropCapture).not.toHaveBeenCalled();
    finish({status: 'complete'});
    await stopped;
    expect(component.mediaStreamRecorder.stop).toHaveBeenCalledTimes(1);
});

test('interrupted introduction aborts its own facecrop session', async () => {
    const component = introductionRecording();
    await component.startRecording();
    component.componentWillUnmount();
    expect(abortFacecropCapture).toHaveBeenCalledWith(session);
    expect(stopActiveFacecropCapture).not.toHaveBeenCalled();
});

test('records a regular video upload rejection as failed', async () => {
    const previous = {nodeEnv: process.env.NODE_ENV, recording: process.env.REACT_APP_VIDEO_RECORDING,
        logging: process.env.REACT_APP_LOGGING, jatos: global.jatos};
    process.env.NODE_ENV = 'test';
    process.env.REACT_APP_VIDEO_RECORDING = 'true';
    process.env.REACT_APP_LOGGING = 'true';
    const failure = new Error('upload rejected');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.jatos = {uploadResultFile: jest.fn(() => Promise.reject(failure))};
    const component = introductionRecording();
    component.props.markVideoAsUploading.mockReturnValue(5);
    component.recordedChunks = [new Blob(['video'])];
    component.state.mimeType = 'video/webm';
    component.props.setVideoURL = jest.fn();

    try {
        component.uploadVideo();
        await Promise.resolve();
        await Promise.resolve();
        expect(component.props.markVideoAsUploaded).toHaveBeenCalledWith(5, 'failed');
        expect(component.props.markVideoAsUploaded).not.toHaveBeenCalledWith(5, 'succeeded');
    } finally {
        process.env.NODE_ENV = previous.nodeEnv;
        process.env.REACT_APP_VIDEO_RECORDING = previous.recording;
        process.env.REACT_APP_LOGGING = previous.logging;
        log.mockRestore();
        if (previous.jatos === undefined) delete global.jatos;
        else global.jatos = previous.jatos;
    }
});
