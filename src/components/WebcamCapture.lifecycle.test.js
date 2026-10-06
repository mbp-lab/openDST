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
    const handle = registered.mock.calls[0][0];
    expect(handle).not.toBe(capture);
    expect(component.faceCropController).toBe(handle);
    const originalStop = capture.stop;
    const stopping = handle.stop();
    expect(component.mediaStreamRecorder.stop).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onstop).toHaveBeenCalledTimes(1);
    gate.resolve({status: 'complete'});
    expect(await stopping).toEqual({status: 'complete'});
    await handle.stop();
    expect(capture.stop).toBe(originalStop);
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

test('host abort supersedes drain through a stable coordinator without waiting for transport', async () => {
    const gate = deferred();
    const registered = jest.fn();
    const component = new WebcamCapture({onFaceCropSessionCreated: registered});
    component.mediaStreamRecorder = {state: 'recording', stop: jest.fn(function () {
        this.state = 'inactive';
        Promise.resolve().then(() => this.onstop({}));
    })};
    const capture = {captureId: 'capture', stop: jest.fn(() => gate.promise),
        abort: jest.fn(() => Promise.resolve({status: 'aborted'}))};
    const originalAbort = capture.abort;
    component.registerFaceCropSession(capture);
    const handle = registered.mock.calls[0][0];
    const stopping = handle.stop();
    await expect(handle.abort()).resolves.toEqual({status: 'aborted'});
    expect(component.mediaStreamRecorder.stop).toHaveBeenCalledTimes(1);
    expect(capture.abort).toBe(originalAbort);
    gate.resolve({status: 'complete'});
    await stopping;
});

test('rejected library finalization still waits for component recorder cleanup', async () => {
    const registered = jest.fn();
    const component = new WebcamCapture({onFaceCropSessionCreated: registered});
    component.mediaStreamRecorder = {state: 'recording', stop: jest.fn(function () { this.state = 'inactive'; })};
    const error = new Error('finalization failed');
    component.registerFaceCropSession({captureId: 'capture', stop: () => Promise.reject(error), abort: jest.fn()});
    const handle = registered.mock.calls[0][0];
    let settled = false;
    const stopping = handle.stop().catch(failure => { settled = true; return failure; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    component.mediaStreamRecorder.onstop({});
    expect(await stopping).toBe(error);
});

test('cancellation-selected unmount defers the component stop so host abort remains authoritative', async () => {
    const stop = jest.fn(() => Promise.resolve({status: 'complete'}));
    const abort = jest.fn(() => Promise.resolve({status: 'aborted'}));
    const finished = jest.fn();
    const component = new WebcamCapture({studyPage: 'speechTask',
        faceCropCancellationState: {current: true}, onFaceCropSessionFinished: finished});
    component.faceCropController = {captureId: 'capture', stop, abort};
    component.mediaStreamRecorder = {state: 'inactive'};
    component.componentWillUnmount();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    expect(component.faceCropController).toBeNull();
});
