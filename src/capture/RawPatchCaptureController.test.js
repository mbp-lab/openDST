import {
    DEFAULT_FACE_ROI_SMOOTHING_TAU_MS,
    DEFAULT_FACE_ROI_SCALE,
    DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO,
    DEFAULT_FACE_DETECTION_MIN_CONFIDENCE,
    DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD,
    RAW_PATCH_STATUS,
    RawPatchCaptureController,
    resolveRawPatchConfiguration
} from './RawPatchCaptureController';
function deferred() {
    let resolve;
    return {
        promise: new Promise(nextResolve => {
            resolve = nextResolve;
        }),
        resolve
    };
}

describe('resolveRawPatchConfiguration', () => {
    test('uses the default face ROI time constant in milliseconds', () => {
        expect(resolveRawPatchConfiguration({}).faceRoiSmoothingTauMs).toBe(DEFAULT_FACE_ROI_SMOOTHING_TAU_MS);
    });

    test('accepts a bounded face ROI time constant in milliseconds', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_SMOOTHING_TAU_MS: '400'}).faceRoiSmoothingTauMs).toBe(400);
    });

    test('accepts configurable face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_SCALE: '1.75'}).faceRoiScale).toBe(1.75);
    });

    test('falls back to the default for invalid face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_SCALE: '0.5'}).faceRoiScale)
            .toBe(DEFAULT_FACE_ROI_SCALE);
    });

    test('accepts configurable signed face ROI vertical shift ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO: '-0.25'}).faceRoiVerticalShiftRatio).toBe(-0.25);
    });

    test('falls back to the default for invalid face ROI vertical shift ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO: '1.1'}).faceRoiVerticalShiftRatio)
            .toBe(DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO);
    });

    test('falls back to the default for invalid face ROI time constants', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_CROP_SMOOTHING_TAU_MS: '-1'}).faceRoiSmoothingTauMs)
            .toBe(DEFAULT_FACE_ROI_SMOOTHING_TAU_MS);
    });

    test('resolves bounded detector thresholds and time-based face hold configuration', () => {
        const configuration = resolveRawPatchConfiguration({
            REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '0.65',
            REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '0.4'
        });

        expect(configuration.faceDetectionMinConfidence).toBe(0.65);
        expect(configuration.faceDetectionMinSuppressionThreshold).toBe(0.4);
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '1.1'}).faceDetectionMinConfidence)
            .toBe(DEFAULT_FACE_DETECTION_MIN_CONFIDENCE);
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '-0.1'}).faceDetectionMinSuppressionThreshold)
            .toBe(DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD);
    });

    test('cancels the pending frame callback before finalizing a stopped capture', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const probeFrame = {
            displayWidth: 72,
            displayHeight: 72,
            copyTo: jest.fn(() => Promise.resolve()),
            close: jest.fn()
        };
        const detector = {close: jest.fn(), detectForVideo: jest.fn()};
        const video = {
            videoWidth: 72,
            videoHeight: 72,
            requestVideoFrameCallback: jest.fn(() => 7),
            cancelVideoFrameCallback: jest.fn()
        };
        window.VideoFrame = jest.fn(() => probeFrame);
        window.CompressionStream = jest.fn();

        try {
            const createFaceDetector = jest.fn(() => Promise.resolve(detector));
            const controller = new RawPatchCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveRawPatchConfiguration({
                    REACT_APP_FACE_CROP_RECORDING_MODE: 'all',
                    REACT_APP_FACE_DETECTION_MIN_CONFIDENCE: '0.7',
                    REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD: '0.2'
                }),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile: jest.fn(),
                createFaceDetector
            });

            await expect(controller.start()).resolves.toBe(RAW_PATCH_STATUS.CAPTURING);
            expect(createFaceDetector).toHaveBeenCalledWith({minDetectionConfidence: 0.7, minSuppressionThreshold: 0.2});
            await expect(controller.stop()).resolves.toBe(RAW_PATCH_STATUS.COMPLETE);

            expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
            expect(detector.close).toHaveBeenCalledTimes(1);
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });

    test('processes one frame before awaiting the next callback', async () => {
        const original = {VideoFrame: window.VideoFrame, CompressionStream: window.CompressionStream};
        const copy = deferred();
        const probeFrame = {displayWidth: 72, displayHeight: 72, copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const captureFrame = {copyTo: jest.fn(() => copy.promise), close: jest.fn()};
        const detector = {
            close: jest.fn(),
            detectForVideo: jest.fn(() => ({detections: [{boundingBox: {originX: 0, originY: 0, width: 72, height: 72}, categories: [{score: 0.9}]}]}))
        };
        let callback;
        let callbackId = 0;
        const video = {
            videoWidth: 72,
            videoHeight: 72,
            requestVideoFrameCallback: jest.fn(nextCallback => {
                callback = nextCallback;
                callbackId += 1;
                return callbackId;
            }),
            cancelVideoFrameCallback: jest.fn()
        };
        window.VideoFrame = jest.fn()
            .mockImplementationOnce(() => probeFrame)
            .mockImplementationOnce(() => captureFrame);
        window.CompressionStream = jest.fn();

        try {
            const uploadResultFile = jest.fn(() => Promise.resolve());
            const controller = new RawPatchCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveRawPatchConfiguration({REACT_APP_FACE_CROP_RECORDING_MODE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile,
                createFaceDetector: jest.fn(() => Promise.resolve(detector))
            });
            controller.sink.encode = jest.fn(() => Promise.resolve(new Uint8Array([1])));

            await controller.start();
            callback(0, {mediaTime: 1, presentedFrames: 1});
            await Promise.resolve();
            copy.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(controller.acceptedFrames).toBe(1);
            expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
            await expect(controller.stop()).resolves.toBe(RAW_PATCH_STATUS.COMPLETE);
            expect(uploadResultFile).toHaveBeenCalledTimes(2);
            expect(captureFrame.close).toHaveBeenCalledTimes(1);
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });
});
