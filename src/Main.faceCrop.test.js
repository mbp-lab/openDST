import Main from './Main';

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return {promise, resolve};
}

test('page navigation waits for facecrop finalization and repeated navigation shares the wait', async () => {
    const gate = deferred();
    const host = {state: {pageIndex: 0, slideIndex: 0, studyPagesSequence: ['task'], slideSequences: {task: ['recording']}},
        faceCropSessions: new Map([['capture', {}]]), prepareFaceCropCancellation: jest.fn(() => gate.promise), setState: jest.fn()};
    const first = Main.prototype.handleNext.call(host);
    expect(Main.prototype.handleNext.call(host)).toBe(first);
    expect(host.setState).not.toHaveBeenCalled();
    expect(host.prepareFaceCropCancellation).toHaveBeenCalledWith('cancel_with_video');
    gate.resolve(); await first;
    expect(host.setState).toHaveBeenCalledTimes(1);
    expect(host.setState).toHaveBeenCalledWith({pageIndex: 1, slideIndex: 0});
});

test('withdrawal aborts each registered capture and retains per-capture status history', async () => {
    const first = {captureId: 'first', abort: jest.fn(() => Promise.resolve())};
    const second = {captureId: 'second', abort: jest.fn(() => Promise.resolve())};
    const host = {faceCropSessions: new Map([['first', first], ['second', second]]),
        data: {studyMetaTracker: {}}, onFaceCropSessionFinished(session) {
            Main.prototype.onFaceCropSessionFinished.call(this, session);
        }};
    Main.prototype.updateFaceCropCaptureStatus.call(host, {status: 'complete', capture: {captureId: 'first'}});
    Main.prototype.updateFaceCropCaptureStatus.call(host, {status: 'incomplete', capture: {captureId: 'second'}});
    expect(host.data.studyMetaTracker.faceCropCapture.captures.map(capture => capture.captureId)).toEqual(['first', 'second']);
    await Main.prototype.prepareFaceCropCancellation.call(host, 'cancel_without_data');
    expect(first.abort).toHaveBeenCalledTimes(1);
    expect(second.abort).toHaveBeenCalledTimes(1);
    expect(host.faceCropSessions.size).toBe(0);
});
