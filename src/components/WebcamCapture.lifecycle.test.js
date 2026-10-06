import WebcamCapture from './WebcamCapture';

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return {promise, resolve};
}

test('host finalization stops ordinary recording before waiting on facecrop writes', async () => {
    const gate = deferred();
    const registered = jest.fn();
    const component = new WebcamCapture({onFaceCropSessionCreated: registered});
    const onstop = jest.fn();
    component.mediaStreamRecorder = {state: 'recording', onstop,
        stop: jest.fn(function () {
            this.state = 'inactive';
            Promise.resolve().then(() => this.onstop({}));
        })};
    const capture = {captureId: 'capture', stop: jest.fn(() => gate.promise), abort: jest.fn(() => Promise.resolve({status: 'aborted'}))};
    component.registerFaceCropSession(capture);
    expect(registered).toHaveBeenCalledWith(capture);
    const stopping = capture.stop();
    expect(component.mediaStreamRecorder.stop).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onstop).toHaveBeenCalledTimes(1);
    gate.resolve({status: 'complete'});
    expect(await stopping).toEqual({status: 'complete'});
    await capture.stop();
    expect(component.mediaStreamRecorder.stop).toHaveBeenCalledTimes(1);
});

test('a second recording resets per-recording stop state without retaining the old capture', async () => {
    const component = new WebcamCapture({});
    component.mediaStreamRecorder = {state: 'inactive'};
    component.stopPromise = Promise.resolve();
    component.recorderStopPromise = Promise.resolve();
    component.startRecordingInternal = jest.fn(() => Promise.resolve());
    await component.startRecording();
    expect(component.stopPromise).toBeNull();
    expect(component.recorderStopPromise).toBeNull();
    expect(component.startRecordingInternal).toHaveBeenCalledTimes(1);
});

test('concurrent restarts cannot create two recorders while the prior capture drains', async () => {
    const gate = deferred();
    const component = new WebcamCapture({});
    component.mediaStreamRecorder = {state: 'inactive'};
    component.stopPromise = gate.promise;
    component.startRecordingInternal = jest.fn(() => Promise.resolve());
    const first = component.startRecording();
    const second = component.startRecording();
    expect(component.startRecordingInternal).not.toHaveBeenCalled();
    gate.resolve(); await Promise.all([first, second]);
    expect(component.startRecordingInternal).toHaveBeenCalledTimes(1);
});

test('stop during asynchronous recorder creation prevents recording from starting afterward', async () => {
    const gate = deferred();
    const component = new WebcamCapture({});
    const recorder = {state: 'inactive', start: jest.fn()};
    component.webcamRef.current = {stream: {}};
    component.createMediaRecorder = jest.fn(() => { component.mediaStreamRecorder = recorder; return gate.promise; });
    const starting = component.startRecording();
    await component.stopRecording();
    gate.resolve(); await starting;
    expect(recorder.start).not.toHaveBeenCalled();
});
