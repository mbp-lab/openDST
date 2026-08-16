import {
    DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS,
    DEFAULT_FACE_ROI_SCALE,
    DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO,
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
    test('uses the default face ROI smoothing window in milliseconds', () => {
        expect(resolveRawPatchConfiguration({}).faceRoiSmoothingWindowMs).toBe(DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS);
    });

    test('accepts a bounded millisecond face ROI smoothing window', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SMOOTHING_WINDOW_MS: '400'}).faceRoiSmoothingWindowMs).toBe(400);
    });

    test('accepts configurable face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SCALE: '1.75'}).faceRoiScale).toBe(1.75);
    });

    test('falls back to the default for invalid face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SCALE: '0.5'}).faceRoiScale)
            .toBe(DEFAULT_FACE_ROI_SCALE);
    });

    test('accepts configurable face ROI upward offset ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_UPWARD_OFFSET_RATIO: '0.25'}).faceRoiUpwardOffsetRatio).toBe(0.25);
    });

    test('falls back to the default for invalid face ROI upward offset ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_UPWARD_OFFSET_RATIO: '1'}).faceRoiUpwardOffsetRatio)
            .toBe(DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO);
    });

    test('falls back to the default for invalid face ROI smoothing windows', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SMOOTHING_WINDOW_MS: '-1'}).faceRoiSmoothingWindowMs)
            .toBe(DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS);
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
            const controller = new RawPatchCaptureController({
                video,
                studyResultId: 'RESULT',
                studyPage: 'introduction',
                videoCounter: 1,
                configuration: resolveRawPatchConfiguration({REACT_APP_RAW_PATCH_CAPTURE: 'all'}),
                uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
                uploadResultFile: jest.fn(),
                createFaceDetector: jest.fn(() => Promise.resolve(detector))
            });

            await expect(controller.start()).resolves.toBe(RAW_PATCH_STATUS.CAPTURING);
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
            detectForVideo: jest.fn(() => ({detections: [{boundingBox: {originX: 0, originY: 0, width: 72, height: 72}}]}))
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
                configuration: resolveRawPatchConfiguration({REACT_APP_RAW_PATCH_CAPTURE: 'all'}),
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
            expect(uploadResultFile).toHaveBeenCalledTimes(1);
            expect(captureFrame.close).toHaveBeenCalledTimes(1);
        } finally {
            window.VideoFrame = original.VideoFrame;
            window.CompressionStream = original.CompressionStream;
        }
    });
});
