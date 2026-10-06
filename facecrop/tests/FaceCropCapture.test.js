import {validateConfiguration, controllerConfiguration} from '../src/Configuration';
import {
    FACE_CROP_STATUS,
    FaceCropCaptureController,
    probeFaceCropCapability
} from '../src/FaceCropCapture';

// These tests protect the browser-side lifecycle boundary: unsupported capture
// must remain optional, while stop must drain in-flight work before finalization.
function deferred() {
    let resolve;
    return {
        promise: new Promise(nextResolve => {
            resolve = nextResolve;
        }),
        resolve
    };
}

describe('capability and capture lifecycle', () => {
    test('uses valid NV12 rotation metadata without pixel-distance calibration', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const createElement = jest.spyOn(document, 'createElement');
        const bytes = new Uint8Array(12);
        const frame = {format: 'NV12', codedWidth: 4, codedHeight: 2, displayWidth: 4, displayHeight: 2, rotation: 90, flip: false,
            colorSpace: {fullRange: true, primaries: 'bt709', transfer: 'bt709', matrix: null}, allocationSize: jest.fn(() => bytes.length),
            copyTo: jest.fn(destination => { destination.set(bytes); return Promise.resolve([{offset: 0, stride: 4}, {offset: 8, stride: 4}]); }), close: jest.fn()};
        window.VideoFrame = jest.fn(() => frame);
        window.CompressionStream = jest.fn();
        const video = {videoWidth: 2, videoHeight: 4, readyState: 4, requestVideoFrameCallback: jest.fn(), cancelVideoFrameCallback: jest.fn()};
        try {
            await expect(probeFaceCropCapability(video)).resolves.toMatchObject({supported: true, frameNormalization: {
                mode: 'nv12-bt709-full', rotation: 90, method: 'frame-metadata-v1', clockwiseDistance: null, counterclockwiseDistance: null}});
            expect(createElement).not.toHaveBeenCalled();
            expect(frame.close).toHaveBeenCalledTimes(1);
        } finally { createElement.mockRestore(); window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

    test('initializes detector and assembly workers after the first presented frame', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        let callback;
        const analysis = {initialize: jest.fn(() => Promise.resolve()), warmup: jest.fn(() => Promise.resolve()), close: jest.fn(() => Promise.resolve())};
        const assembly = {initialize: jest.fn(() => Promise.resolve()), close: jest.fn(() => Promise.resolve())};
        const encoder = {initialize: jest.fn(() => Promise.resolve()), close: jest.fn(() => Promise.resolve())};
        const videoFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const video = {videoWidth: 0, videoHeight: 0, readyState: 0,
            requestVideoFrameCallback: jest.fn(nextCallback => { callback = nextCallback; return 9; }), cancelVideoFrameCallback: jest.fn()};
        window.VideoFrame = jest.fn(() => videoFrame);
        window.CompressionStream = jest.fn();
        try {
            const createPipelineWorker = jest.fn().mockReturnValueOnce(analysis).mockReturnValueOnce(analysis)
                .mockReturnValueOnce(assembly).mockReturnValueOnce(encoder);
            const settings = validateConfiguration({roi: {smoothingTauMs: 125, scale: 1.8, verticalShiftRatio: -0.2},
                detector: {minConfidence: 0.8}, pipeline: {analysisWorkerCount: 2},
                persistence: {maxAttempts: 4, retryDelayMs: 250}});
            const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
                configuration: controllerConfiguration(settings),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn(), createPipelineWorker});
            const preparing = controller.prepare();
            await Promise.resolve();
            expect(createPipelineWorker).not.toHaveBeenCalled();
            video.videoWidth = 72; video.videoHeight = 72; video.readyState = 2;
            callback(0, {mediaTime: 0, presentedFrames: 1});
            await expect(preparing).resolves.toBe(FACE_CROP_STATUS.DISABLED);
            expect(createPipelineWorker).toHaveBeenCalledTimes(4);
            expect(analysis.initialize).toHaveBeenCalledTimes(2);
            const normalizations = analysis.initialize.mock.calls.map(call => call[0].configuration.frameNormalization);
            expect(normalizations[0]).toBe(normalizations[1]);
            expect(analysis.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'analysis'}));
            expect(assembly.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'assembly', identity: expect.objectContaining({studyResultId: 'RESULT'})}));
            expect(encoder.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'encoder'}));
            expect(analysis.warmup).toHaveBeenCalledTimes(6);
            const effectiveWorkerSettings = {faceRoiSmoothingTauMs: 125, faceRoiScale: 1.8,
                faceRoiVerticalShiftRatio: -0.2, faceDetectionMinConfidence: 0.8, analysisWorkerCount: 2};
            for (const worker of [analysis, assembly, encoder]) {
                expect(worker.initialize).toHaveBeenCalledWith(expect.objectContaining({
                    configuration: expect.objectContaining(effectiveWorkerSettings)}));
            }
            expect(controller.configurationMetadata()).toMatchObject({roi: settings.roi,
                detector: {minConfidence: 0.8}, analysisWorkerCount: 2});
            expect(controller.sink.maxAttempts).toBe(4);
            expect(controller.sink.retryDelayMs).toBe(250);
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

    test('waits for a presented frame even when dimensions and readyState are already available', async () => {
        let callback;
        const video = {videoWidth: 480, videoHeight: 640, readyState: 4,
            requestVideoFrameCallback: jest.fn(nextCallback => { callback = nextCallback; return 1; }), cancelVideoFrameCallback: jest.fn()};
        const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: controllerConfiguration(validateConfiguration()), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        let resolved = false;
        const ready = controller.waitForPresentedFrame().then(value => { resolved = value; });
        await Promise.resolve();
        expect(resolved).toBe(false);
        callback(12, {presentedFrames: 1}); await ready;
        expect(resolved).toEqual({now: 12, metadata: {presentedFrames: 1}});
    });

    test('retries a transient probe failure on the next presented frame', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const callbacks = [];
        const frame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const transient = new Error('Invalid source state'); transient.name = 'InvalidStateError';
        const worker = {initialize: jest.fn(() => Promise.resolve()), warmup: jest.fn(() => Promise.resolve()), close: jest.fn(() => Promise.resolve())};
        const video = {videoWidth: 72, videoHeight: 72, readyState: 4,
            requestVideoFrameCallback: jest.fn(callback => { callbacks.push(callback); return callbacks.length; }), cancelVideoFrameCallback: jest.fn()};
        window.VideoFrame = jest.fn().mockImplementationOnce(() => { throw transient; }).mockImplementation(() => frame);
        window.CompressionStream = jest.fn();
        try {
            const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
                configuration: controllerConfiguration(validateConfiguration()),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn(),
                createPipelineWorker: jest.fn(() => worker)});
            const preparing = controller.prepare();
            callbacks[0](1, {presentationTime: 1, presentedFrames: 1});
            await Promise.resolve(); await Promise.resolve();
            expect(callbacks).toHaveLength(2);
            callbacks[1](2, {presentationTime: 2, presentedFrames: 2});
            await expect(preparing).resolves.toBe(FACE_CROP_STATUS.DISABLED);
            expect(controller.capability.probeAttempts).toHaveLength(2);
            expect(controller.capability.probeAttempts[0].error).toMatchObject({name: 'InvalidStateError'});
            expect(controller.capability.status).toBe('passed');
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

    test('does not retry a non-transient probe failure', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const callbacks = [];
        const uploadResultFile = jest.fn(() => Promise.resolve());
        const failure = new Error('unsupported frame format');
        const video = {videoWidth: 72, videoHeight: 72, readyState: 4,
            requestVideoFrameCallback: jest.fn(callback => { callbacks.push(callback); return callbacks.length; }), cancelVideoFrameCallback: jest.fn()};
        window.VideoFrame = jest.fn(() => { throw failure; }); window.CompressionStream = jest.fn();
        try {
            const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
                configuration: controllerConfiguration(validateConfiguration()),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile});
            const preparing = controller.prepare(); callbacks[0](1, {presentedFrames: 1});
            await expect(preparing).resolves.toBe(FACE_CROP_STATUS.UNSUPPORTED);
            expect(callbacks).toHaveLength(1);
            expect(uploadResultFile).not.toHaveBeenCalled();
            expect(controller.capability.probeAttempts).toHaveLength(1);
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });


    test('creates a fresh controller identity for a second capture', () => {
        const options = {video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: controllerConfiguration(validateConfiguration()), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()};
        const first = new FaceCropCaptureController(options);
        const second = new FaceCropCaptureController({...options, videoCounter: 2});

        expect(first.captureId).not.toBe(second.captureId);
        expect(first.captureId).toContain('introduction-1');
        expect(second.captureId).toContain('introduction-2');
    });



    test('rejects missing and non-increasing presentation timestamps', async () => {
        let callback;
        const video = {requestVideoFrameCallback: jest.fn(next => { callback = next; return 1; }), cancelVideoFrameCallback: jest.fn()};
        const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: controllerConfiguration(validateConfiguration()), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
            uploadResultFile: jest.fn()});

        const missing = controller.waitForFrame();
        callback(10, {mediaTime: 0, presentedFrames: 1});
        await expect(missing).rejects.toThrow('presentationTime is unavailable');

        const first = controller.waitForFrame();
        callback(20, {mediaTime: 0, presentationTime: 15, presentedFrames: 2});
        await expect(first).resolves.toMatchObject({presentationTimeUs: 15000});

        const repeated = controller.waitForFrame();
        callback(30, {mediaTime: 0, presentationTime: 15, presentedFrames: 3});
        await expect(repeated).rejects.toThrow('presentationTime is non-increasing');
    });

    test('drains detector and assembly work before manifest finalization', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const gate = deferred();
        const probeFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const warmupFrame = {displayWidth: 72, displayHeight: 72, close: jest.fn()};
        const captureFrame = {displayWidth: 72, displayHeight: 72, close: jest.fn()};
        const artifact = {captureId: 'capture', segmentIndex: 0, partIndex: 0, filename: 'part.avi.gz', faceEventsFilename: 'part.face-events.json',
            frameCount: 1, frameRate: 30, gzipBytes: new Uint8Array([1]).buffer, faceEvents: {aviFilename: 'part.avi.gz', frameCount: 1, frames: [{frameIndex: 0, presentationTimeUs: 1000}]}};
        const analysis = {initialize: jest.fn(() => Promise.resolve()), warmup: jest.fn(() => Promise.resolve()),
            processFrame: jest.fn(({frame}) => gate.promise.then(() => { frame.close(); return {sequence: 0, rgbx: new Uint8Array(4), timings: {}}; })), close: jest.fn(() => Promise.resolve())};
        const assembly = {initialize: jest.fn(() => Promise.resolve()), processAnalysisResult: jest.fn(() => Promise.resolve({commits: [{sequence: 0,
            accepted: true, detectionState: 'largest', parts: [{...artifact, bytes: new Uint8Array([1])}], timings: {}}], bufferedResultCount: 0})),
            finish: jest.fn(() => Promise.resolve({parts: [], bufferedResultCount: 0})), close: jest.fn(() => Promise.resolve())};
        const encoder = {initialize: jest.fn(() => Promise.resolve()), encodePart: jest.fn(() => Promise.resolve({artifact, timings: {encodingMs: 1}})), close: jest.fn(() => Promise.resolve())};
        let callback; let callbackId = 0;
        const video = {videoWidth: 72, videoHeight: 72, readyState: 2, requestVideoFrameCallback: jest.fn(nextCallback => { callback = nextCallback; return ++callbackId; }), cancelVideoFrameCallback: jest.fn()};
        window.VideoFrame = jest.fn().mockImplementationOnce(() => probeFrame).mockImplementationOnce(() => warmupFrame)
            .mockImplementationOnce(() => warmupFrame).mockImplementationOnce(() => warmupFrame).mockImplementationOnce(() => captureFrame);
        window.CompressionStream = jest.fn();
        try {
            const uploadResultFile = jest.fn(() => Promise.resolve());
            const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
                captureId: 'capture', configuration: controllerConfiguration(validateConfiguration()),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile,
                createPipelineWorker: jest.fn().mockReturnValueOnce(analysis).mockReturnValueOnce(assembly).mockReturnValueOnce(encoder)});
            const starting = controller.start();
            await Promise.resolve();
            callback(10, {mediaTime: 0, presentationTime: 10, presentedFrames: 1});
            await starting;
            callback(20, {mediaTime: 0, presentationTime: 12.5, presentedFrames: 1}); await Promise.resolve();
            expect(window.VideoFrame).toHaveBeenLastCalledWith(video, {timestamp: 12500});
            expect(analysis.processFrame).toHaveBeenCalledWith(expect.objectContaining({timestampUs: 12500}));
            const stopping = controller.stop(); gate.resolve(); await stopping;
            expect(controller.acceptedFrames).toBe(1);
            expect(assembly.finish).toHaveBeenCalledTimes(1);
            expect(uploadResultFile).toHaveBeenCalledTimes(3);
            const statistics = JSON.parse(uploadResultFile.mock.calls[2][0]).validity.health;
            expect(statistics.frameCallbacks).toBe(1);
            expect(Object.keys(statistics.frameTimings).sort()).toEqual([
                'analysisMs', 'assemblyMs', 'detectionMs', 'roiSelectionMs', 'rgbaCopyMs', 'cropAndSegmentMs'
            ].sort());
            expect(statistics.encodingTimings.encodingMs.count).toBe(1);
            expect(statistics).not.toHaveProperty('artifactTimings');
            const manifest = JSON.parse(uploadResultFile.mock.calls[2][0]);
            expect(manifest.analysis.output).not.toHaveProperty('frameRate');
            expect(manifest.analysis.output).not.toHaveProperty('aviHeaderFrameRateFallback');
            expect(manifest.analysis.output.aviHeaderFrameRatePolicy).toBe('required-per-part-from-presentationTimeUs-v1');
            expect(manifest.analysis.parts[0].frameRate).toBe(30);
            expect(captureFrame.close).toHaveBeenCalledTimes(1);
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

});

// Drive the real controller stage transitions while substituting worker/transport
// boundaries, so reconciliation is checked against failures rather than hand counts.
test.each(['processing', 'encoding', 'persistence'])('reconciles actual %s failure transitions', async failureStage => {
    const originalVideoFrame = window.VideoFrame;
    window.VideoFrame = jest.fn(() => ({close: jest.fn()}));
    const artifact = {captureId: 'failure-capture', segmentIndex: 0, partIndex: 0,
        filename: 'failure.avi.gz', faceEventsFilename: 'failure.face-events.json',
        frameCount: 1, frameRate: 30, gzipBytes: new Uint8Array([1]).buffer,
        faceEvents: {aviFilename: 'failure.avi.gz', frameCount: 1, frames: [{frameIndex: 0, presentationTimeUs: 1000}]}};
    const close = jest.fn(() => Promise.resolve());
    const uploadResultFile = jest.fn((payload, filename) => failureStage === 'persistence' && filename.endsWith('.avi.gz')
        ? Promise.reject(new Error('transport response lost')) : Promise.resolve());
    const controller = new FaceCropCaptureController({video: {videoWidth: 72, videoHeight: 72},
        captureId: 'failure-capture', filenamePrefix: 'failure',
        configuration: controllerConfiguration(validateConfiguration()), uploadResultFile});
    controller.sink.sleep = () => Promise.resolve();
    controller.state = 'capturing';
    controller.frameCallbacks = 1;
    controller.analysisWorkers = [{close, processFrame: ({frame}) => {
        frame.close();
        return failureStage === 'processing' ? Promise.reject(new Error('analysis failed')) : Promise.resolve({sequence: 0});
    }}];
    controller.assemblyWorker = {close, processAnalysisResult: () => Promise.resolve({bufferedResultCount: 0,
        commits: [{accepted: true, detectionState: 'largest', parts: [artifact], timings: {}}]}),
        finish: () => Promise.resolve({parts: [], bufferedResultCount: 0})};
    controller.encoderWorker = {close, encodePart: () => failureStage === 'encoding'
        ? Promise.reject(new Error('encoding failed')) : Promise.resolve({artifact, timings: {}})};
    try {
        await controller.processAnalysisFrame({}, 1700000000000, 1000);
        await controller.finalize();
        expect(controller.status).toBe(FACE_CROP_STATUS.INCOMPLETE);
        expect(controller.accounting.reconciliation).toMatchObject({status: 'consistent', checks: {counts: true}});
        expect(controller.accounting.submittedFrames).toBe(1);
        expect(controller.accounting.failedProcessingFrames).toBe(failureStage === 'processing' ? 1 : 0);
        expect(controller.accounting.failedEncodingFrames).toBe(failureStage === 'encoding' ? 1 : 0);
        expect(controller.accounting.failedPersistenceFrames).toBe(failureStage === 'persistence' ? 1 : 0);
        expect(controller.accounting.persistedFrames).toBe(0);
        if (failureStage === 'persistence') {
            expect(controller.sink.inventory()).toEqual(expect.arrayContaining([
                expect.objectContaining({filename: 'failure.avi.gz', status: 'uncertain', attempts: 3}),
                expect.objectContaining({filename: 'failure.face-events.json', status: 'not_attempted', attempts: 0})
            ]));
        }
        expect(close).toHaveBeenCalledTimes(3);
    } finally { window.VideoFrame = originalVideoFrame; }
});
