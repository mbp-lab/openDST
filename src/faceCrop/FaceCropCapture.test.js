import {
    DEFAULT_FACE_ROI_SMOOTHING_TAU_MS,
    DEFAULT_FACE_ROI_SCALE,
    DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO,
    DEFAULT_FACE_DETECTION_MIN_CONFIDENCE,
    DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD,
    DEFAULT_FACE_DETECTION_DELEGATE,
    DEFAULT_FACE_CROP_ANALYSIS_WORKER_COUNT,
    FACE_CROP_STATUS,
    FaceCropCaptureController,
    resolveFaceCropConfiguration,
    resolveStudyResultId
} from './FaceCropCapture';

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

// Configuration is an external contract: values are build-time strings, so
// bounds and defaults must be enforced before they reach the worker.
describe('resolveFaceCropConfiguration', () => {
    test('defaults detector execution to the CPU delegate and accepts GPU', () => {
        expect(resolveFaceCropConfiguration({}).faceDetectionDelegate).toBe(DEFAULT_FACE_DETECTION_DELEGATE);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_DETECTION_DELEGATE: 'GPU'}).faceDetectionDelegate).toBe('GPU');
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_DETECTION_DELEGATE: 'invalid'}).faceDetectionDelegate)
            .toBe(DEFAULT_FACE_DETECTION_DELEGATE);
    });
    test('uses the default face ROI time constant in milliseconds', () => {
        expect(resolveFaceCropConfiguration({}).faceRoiSmoothingTauMs).toBe(DEFAULT_FACE_ROI_SMOOTHING_TAU_MS);
    });

    test('accepts a bounded face ROI time constant in milliseconds', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_SMOOTHING_TAU_MS: '400'}).faceRoiSmoothingTauMs).toBe(400);
    });

    test('accepts configurable face ROI scale', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_SCALE: '1.75'}).faceRoiScale).toBe(1.75);
    });

    test('falls back to the default for invalid face ROI scale', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_SCALE: '0.5'}).faceRoiScale)
            .toBe(DEFAULT_FACE_ROI_SCALE);
    });

    test('accepts configurable signed face ROI vertical shift ratio', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO: '-0.25'}).faceRoiVerticalShiftRatio).toBe(-0.25);
    });

    test('falls back to the default for invalid face ROI vertical shift ratio', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO: '1.1'}).faceRoiVerticalShiftRatio)
            .toBe(DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO);
    });

    test('falls back to the default for invalid face ROI time constants', () => {
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_SMOOTHING_TAU_MS: '-1'}).faceRoiSmoothingTauMs)
            .toBe(DEFAULT_FACE_ROI_SMOOTHING_TAU_MS);
    });

    test('bounds the experimental analysis worker count to one or two', () => {
        expect(resolveFaceCropConfiguration({}).analysisWorkerCount).toBe(DEFAULT_FACE_CROP_ANALYSIS_WORKER_COUNT);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '2'}).analysisWorkerCount).toBe(2);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '3'}).analysisWorkerCount).toBe(1);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '1.5'}).analysisWorkerCount).toBe(1);
    });

    test('resolves bounded detector thresholds and time-based face hold configuration', () => {
        const configuration = resolveFaceCropConfiguration({
            REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '0.65',
            REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '0.4'
        });

        expect(configuration.faceDetectionMinConfidence).toBe(0.65);
        expect(configuration.faceDetectionMinSuppressionThreshold).toBe(0.4);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '1.1'}).faceDetectionMinConfidence)
            .toBe(DEFAULT_FACE_DETECTION_MIN_CONFIDENCE);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '-0.1'}).faceDetectionMinSuppressionThreshold)
            .toBe(DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD);
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
            const createPipelineWorker = jest.fn().mockReturnValueOnce(analysis).mockReturnValueOnce(assembly).mockReturnValueOnce(encoder);
            const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
                configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn(), createPipelineWorker});
            const preparing = controller.prepare();
            await Promise.resolve();
            expect(createPipelineWorker).not.toHaveBeenCalled();
            video.videoWidth = 72; video.videoHeight = 72; video.readyState = 2;
            callback(0, {mediaTime: 0, presentedFrames: 1});
            await expect(preparing).resolves.toBe(FACE_CROP_STATUS.DISABLED);
            expect(createPipelineWorker).toHaveBeenCalledTimes(3);
            expect(analysis.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'analysis'}));
            expect(assembly.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'assembly', identity: expect.objectContaining({studyResultId: 'RESULT'})}));
            expect(encoder.initialize).toHaveBeenCalledWith(expect.objectContaining({role: 'encoder'}));
            expect(analysis.warmup).toHaveBeenCalledTimes(3);
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

    test('waits for current frame data when dimensions precede readiness', async () => {
        let callback;
        const video = {videoWidth: 480, videoHeight: 640, readyState: 0,
            requestVideoFrameCallback: jest.fn(nextCallback => { callback = nextCallback; return 1; }), cancelVideoFrameCallback: jest.fn()};
        const controller = new FaceCropCaptureController({video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        let resolved = false;
        const ready = controller.waitForVideoReady().then(value => { resolved = value; });
        await Promise.resolve();
        expect(resolved).toBe(false);
        video.readyState = 2; callback(); await ready;
        expect(resolved).toBe(true);
    });

    test('creates a fresh controller identity for a second capture', () => {
        const options = {video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()};
        const first = new FaceCropCaptureController(options);
        const second = new FaceCropCaptureController({...options, videoCounter: 2});

        expect(first.captureId).not.toBe(second.captureId);
        expect(first.captureId).toContain('introduction-1');
        expect(second.captureId).toContain('introduction-2');
    });

    test('uses the JATOS result ID while the React prop is still null', () => {
        expect(resolveStudyResultId({studyResultId: null}, {studyResultId: 163})).toBe(163);
        expect(resolveStudyResultId({studyResultId: 164}, {studyResultId: 163})).toBe(164);
        expect(resolveStudyResultId({}, null)).toBeNull();
    });

    test('drains detector and assembly work before manifest finalization', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const gate = deferred();
        const probeFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const warmupFrame = {displayWidth: 72, displayHeight: 72, close: jest.fn()};
        const captureFrame = {displayWidth: 72, displayHeight: 72, close: jest.fn()};
        const artifact = {captureId: 'capture', segmentIndex: 0, partIndex: 0, filename: 'part.avi.gz', faceEventsFilename: 'part.face-events.json',
            frameCount: 1, gzipBytes: new Uint8Array([1]).buffer, faceEvents: {aviFilename: 'part.avi.gz', frameCount: 1, frames: []}};
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
                captureId: 'capture', configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile,
                createPipelineWorker: jest.fn().mockReturnValueOnce(analysis).mockReturnValueOnce(assembly).mockReturnValueOnce(encoder)});
            await controller.start();
            callback(0, {mediaTime: 1, presentedFrames: 1}); await Promise.resolve();
            const stopping = controller.stop(); gate.resolve(); await stopping;
            expect(controller.acceptedFrames).toBe(1);
            expect(assembly.finish).toHaveBeenCalledTimes(1);
            expect(uploadResultFile).toHaveBeenCalledTimes(3);
            const statistics = JSON.parse(uploadResultFile.mock.calls[2][0]).statistics;
            expect(statistics.frameCallbacks).toBe(1);
            expect(Object.keys(statistics.frameTimings).sort()).toEqual([
                'analysisMs', 'assemblyMs', 'detectionMs', 'roiSelectionMs', 'rgbaCopyMs', 'cropAndSegmentMs'
            ].sort());
            expect(statistics.encodingTimings.encodingMs.count).toBe(1);
            expect(statistics).not.toHaveProperty('artifactTimings');
            expect(captureFrame.close).toHaveBeenCalledTimes(1);
        } finally { window.VideoFrame = original.VideoFrame; window.CompressionStream = original.CompressionStream; }
    });

});
