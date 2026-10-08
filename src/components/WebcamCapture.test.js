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
