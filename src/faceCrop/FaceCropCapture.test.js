import {
    DEFAULT_FACE_ROI_SMOOTHING_TAU_MS,
    DEFAULT_FACE_ROI_SCALE,
    DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO,
    DEFAULT_FACE_DETECTION_MIN_CONFIDENCE,
    DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD,
    DEFAULT_FACE_DETECTION_DELEGATE,
    DEFAULT_FACE_CROP_WORKER_COUNT,
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
        expect(resolveFaceCropConfiguration({}).workerCount).toBe(DEFAULT_FACE_CROP_WORKER_COUNT);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}).workerCount).toBe(2);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '3'}).workerCount).toBe(1);
        expect(resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '1.5'}).workerCount).toBe(1);
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

    test('waits for the first presented frame before preparing an early webcam session', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        let callback;
        const pipelineWorker = {
            initialize: jest.fn(() => Promise.resolve()),
            warmup: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve())
        };
        const videoFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const video = {
            videoWidth: 0,
            videoHeight: 0,
            readyState: 0,
            requestVideoFrameCallback: jest.fn(nextCallback => { callback = nextCallback; return 9; }),
            cancelVideoFrameCallback: jest.fn()
        };
        window.VideoFrame = jest.fn(() => videoFrame);
        window.CompressionStream = jest.fn();

        try {
            const createPipelineWorker = jest.fn(() => pipelineWorker);
            const controller = new FaceCropCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile: jest.fn(),
                createPipelineWorker
            });

            const preparing = controller.prepare();
            await Promise.resolve();
            expect(pipelineWorker.initialize).not.toHaveBeenCalled();
            video.videoWidth = 72;
            video.videoHeight = 72;
            video.readyState = 2;
            callback(0, {mediaTime: 0, presentedFrames: 1});
            await expect(preparing).resolves.toBe(FACE_CROP_STATUS.DISABLED);
            expect(pipelineWorker.initialize).toHaveBeenCalledTimes(1);
            expect(createPipelineWorker).toHaveBeenCalledTimes(1);
            expect(pipelineWorker.initialize.mock.calls[0][0].configuration.analysisOnly).toBeUndefined();
            expect(pipelineWorker.warmup).toHaveBeenCalledTimes(3);
            expect(controller.state).toBe('prepared');
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });

    test('waits for current frame data when dimensions are populated before video readiness', async () => {
        const video = {
            videoWidth: 480, videoHeight: 640, readyState: 0,
            requestVideoFrameCallback: jest.fn(), cancelVideoFrameCallback: jest.fn()
        };
        let callback;
        video.requestVideoFrameCallback.mockImplementation(nextCallback => { callback = nextCallback; return 1; });
        const controller = new FaceCropCaptureController({
            video, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });

        let resolved = false;
        const ready = controller.waitForVideoReady().then(value => { resolved = value; });
        await Promise.resolve();
        expect(resolved).toBe(false);
        expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);

        video.readyState = 2;
        callback();
        await ready;
        expect(resolved).toBe(true);
    });

    test('uses the JATOS result ID while the React prop is still null', () => {
        expect(resolveStudyResultId({studyResultId: null}, {studyResultId: 163})).toBe(163);
        expect(resolveStudyResultId({studyResultId: 164}, {studyResultId: 163})).toBe(164);
        expect(resolveStudyResultId({}, null)).toBeNull();
    });

    // Stopping must cancel scheduling but still await work already handed off.
    test('cancels the pending frame callback before finalizing a stopped capture', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const probeFrame = {
            displayWidth: 72,
            displayHeight: 72,
            copyTo: jest.fn(() => Promise.resolve()),
            close: jest.fn()
        };
        const pipelineWorker = {
            initialize: jest.fn(() => Promise.resolve()),
            warmup: jest.fn(() => Promise.resolve()),
            processFrame: jest.fn(),
            finish: jest.fn(() => Promise.resolve({parts: []})),
            close: jest.fn(() => Promise.resolve())
        };
        const video = {
            videoWidth: 72,
            videoHeight: 72,
            readyState: 2,
            requestVideoFrameCallback: jest.fn(() => 7),
            cancelVideoFrameCallback: jest.fn()
        };
        window.VideoFrame = jest.fn(() => probeFrame);
        window.CompressionStream = jest.fn();

        try {
            const createPipelineWorker = jest.fn(() => pipelineWorker);
            const controller = new FaceCropCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveFaceCropConfiguration({
                    REACT_APP_FACE_CROP_RECORDING_MODE: 'all',
                    REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '0.7',
                    REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '0.2'
                }),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile: jest.fn(),
                createPipelineWorker
            });

            await expect(controller.start()).resolves.toBe(FACE_CROP_STATUS.CAPTURING);
            expect(pipelineWorker.initialize).toHaveBeenCalledWith(expect.objectContaining({
                configuration: {
                    faceDetectionDelegate: DEFAULT_FACE_DETECTION_DELEGATE,
                    faceRoiSmoothingTauMs: DEFAULT_FACE_ROI_SMOOTHING_TAU_MS,
                    faceRoiScale: DEFAULT_FACE_ROI_SCALE,
                    faceRoiVerticalShiftRatio: DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO,
                    faceDetectionMinConfidence: 0.7,
                    faceDetectionMinSuppressionThreshold: 0.2
                },
                identity: expect.objectContaining({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1})
            }));
            await expect(controller.stop()).resolves.toBe(FACE_CROP_STATUS.INCOMPLETE);
            expect(controller.incompleteReason).toBe('No video frame callbacks were received during face-crop capture');

            expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
            expect(pipelineWorker.close).toHaveBeenCalledTimes(1);
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });

    test('preserves a completed in-flight part when stop begins', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const copy = deferred();
        const probeFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const warmupFrame = {displayWidth: 72, displayHeight: 72, close: jest.fn()};
        const captureFrame = {copyTo: jest.fn(() => copy.promise), close: jest.fn()};
        const pipelineWorker = {
            initialize: jest.fn(() => Promise.resolve()),
            warmup: jest.fn(() => Promise.resolve()),
            processFrame: jest.fn(({frame}) => copy.promise.then(() => {
                frame.close();
                return {accepted: true, detectionState: 'largest', parts: [{
                    filename: 'part.avi.gz', faceEventsFilename: 'part.face-events.json', frameCount: 1, byteLength: 1,
                    bytes: new Uint8Array([1]), faceEvents: {aviFilename: 'part.avi.gz', frameCount: 1}}]};
            })),
            finish: jest.fn(() => Promise.resolve({parts: []})),
            close: jest.fn(() => Promise.resolve())
        };
        let callback;
        let callbackId = 0;
        const video = {
            videoWidth: 72,
            videoHeight: 72,
            readyState: 2,
            requestVideoFrameCallback: jest.fn(nextCallback => {
                callback = nextCallback;
                callbackId += 1;
                return callbackId;
            }),
            cancelVideoFrameCallback: jest.fn()
        };
        window.VideoFrame = jest.fn()
            .mockImplementationOnce(() => probeFrame)
            .mockImplementationOnce(() => warmupFrame)
            .mockImplementationOnce(() => warmupFrame)
            .mockImplementationOnce(() => warmupFrame)
            .mockImplementationOnce(() => captureFrame);
        window.CompressionStream = jest.fn();

        try {
            const uploadResultFile = jest.fn(() => Promise.resolve());
            const controller = new FaceCropCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile,
                createPipelineWorker: jest.fn(() => pipelineWorker)
            });
            controller.sink.encode = jest.fn(() => Promise.resolve(new Uint8Array([1])));

            await controller.start();
            callback(0, {mediaTime: 1, presentedFrames: 1});
            await Promise.resolve();
            const stopping = controller.stop();
            copy.resolve();
            await stopping;

            expect(controller.acceptedFrames).toBe(1);
            expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
            await expect(controller.stop()).resolves.toBe(FACE_CROP_STATUS.COMPLETE);
            expect(uploadResultFile).toHaveBeenCalledTimes(3);
            expect(uploadResultFile.mock.calls[2][1]).toContain('_manifest.json');
            expect(JSON.parse(uploadResultFile.mock.calls[2][0]).statistics.frameCallbacks).toBe(1);
            expect(captureFrame.close).toHaveBeenCalledTimes(1);
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });
});
