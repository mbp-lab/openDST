import Main from './Main';
import capturedBrowserReport from '../docs/facecrop-history/campaign/sustained-final.json';

function deferred() {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return {promise, resolve};
}

test('page navigation waits for facecrop finalization and repeated navigation shares the wait', async () => {
    const gate = deferred();
    const study = {state: {pageIndex: 0, slideIndex: 0, studyPagesSequence: ['task'], slideSequences: {task: ['recording']}},
        faceCropSessions: new Map([['capture', {}]]), prepareFaceCropCancellation: jest.fn(() => gate.promise), setState: jest.fn()};
    const first = Main.prototype.handleNext.call(study);
    expect(Main.prototype.handleNext.call(study)).toBe(first);
    expect(study.setState).not.toHaveBeenCalled();
    expect(study.prepareFaceCropCancellation).toHaveBeenCalledWith('cancel_with_video');
    gate.resolve(); await first;
    expect(study.setState).toHaveBeenCalledTimes(1);
    expect(study.setState).toHaveBeenCalledWith({pageIndex: 1, slideIndex: 0});
});

test('withdrawal aborts each registered capture and retains per-capture status history', async () => {
    const first = {captureId: 'first', abort: jest.fn(() => Promise.resolve())};
    const second = {captureId: 'second', abort: jest.fn(() => Promise.resolve())};
    const study = {faceCropSessions: new Map([['first', first], ['second', second]]),
        data: {studyMetaTracker: {}}, onFaceCropSessionFinished(session) {
            Main.prototype.onFaceCropSessionFinished.call(this, session);
        }};
    Main.prototype.updateFaceCropCaptureStatus.call(study, {status: 'complete', capture: {captureId: 'first'}});
    Main.prototype.updateFaceCropCaptureStatus.call(study, {status: 'incomplete', capture: {captureId: 'second'}});
    expect(study.data.studyMetaTracker.faceCropCapture.captures.map(capture => capture.captureId)).toEqual(['first', 'second']);
    await Main.prototype.prepareFaceCropCancellation.call(study, 'cancel_without_data');
    expect(first.abort).toHaveBeenCalledTimes(1);
    expect(second.abort).toHaveBeenCalledTimes(1);
    expect(study.faceCropSessions.size).toBe(0);
});

test('capture status history replaces snapshots per capture and retains compact per-part outcomes', () => {
    const study = {data: {studyMetaTracker: {}}};
    const update = Main.prototype.updateFaceCropCaptureStatus;
    const captured = capturedBrowserReport.result.sustained[0];
    const makeStatus = (captureId, sequence) => ({
        ...JSON.parse(JSON.stringify(captured.terminalStatusSnapshot)),
        status: sequence === 999 ? 'complete' : 'capturing',
        capture: {captureId, context: {studyPage: 'speechTask', videoCounter: 2}},
        artifacts: captured.terminalArtifactOutcomes.map((artifact, part) => ({...artifact,
            filename: `${captureId}_artifact_${part}`}))
    });

    for (let sequence = 0; sequence < 1000; sequence += 1) {
        const previous = study.data.studyMetaTracker.faceCropCapture &&
            study.data.studyMetaTracker.faceCropCapture.captures[0];
        update.call(study, makeStatus('repeated', sequence));
        if (previous) expect(study.data.studyMetaTracker.faceCropCapture.captures[0]).not.toBe(previous);
    }
    let history = study.data.studyMetaTracker.faceCropCapture.captures;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({captureId: 'repeated', status: 'complete', statistics: {acceptedFrames: captured.statistics.acceptedFrames}});
    expect(history[0].artifacts).toHaveLength(captured.terminalArtifactOutcomes.length);

    for (let capture = 0; capture < 200; capture += 1) {
        update.call(study, makeStatus(`distinct-${capture}`, capture));
    }
    history = study.data.studyMetaTracker.faceCropCapture.captures;
    expect(history).toHaveLength(201);
    expect(new Set(history.map(item => item.captureId)).size).toBe(201);
    expect(history.every(item => !Object.hasOwn(item, 'frames') && !Object.hasOwn(item, 'faceEvents'))).toBe(true);
    const serialized = JSON.stringify(study.data.studyMetaTracker.faceCropCapture);
    expect(serialized.length).toBeLessThan(1_000_000);
    const hasFramePayload = value => {
        if (!value || typeof value !== 'object') return false;
        if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
        return Object.keys(value).some(key => key === 'frames' || key === 'gzipBytes' || hasFramePayload(value[key]));
    };
    expect(hasFramePayload(study.data.studyMetaTracker.faceCropCapture)).toBe(false);
});

test('a late page drain cannot advance after Main unmount', async () => {
    const gate = deferred();
    const study = {state: {pageIndex: 0, slideIndex: 0, studyPagesSequence: ['task'], slideSequences: {task: ['recording']}},
        faceCropSessions: new Map([['capture', {}]]), prepareFaceCropCancellation: jest.fn(() => gate.promise),
        setState: jest.fn(), faceCropStudyUnmounted: false, disconnectHeartRateSensor: jest.fn()};
    const navigation = Main.prototype.handleNext.call(study);
    study.abortFaceCropSessions = jest.fn();
    Main.prototype.componentWillUnmount.call(study);
    gate.resolve();
    await navigation;
    expect(study.setState).not.toHaveBeenCalled();
});
