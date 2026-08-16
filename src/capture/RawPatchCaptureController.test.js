import {
    DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS,
    DEFAULT_FACE_ROI_SCALE,
    DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO,
    resolveRawPatchConfiguration
} from './RawPatchCaptureController';

describe('resolveRawPatchConfiguration', () => {
    test('uses the default face ROI smoothing window in milliseconds', () => {
        expect(resolveRawPatchConfiguration({}).faceRoiSmoothingWindowMs).toBe(DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS);
    });

    test('accepts a bounded millisecond face ROI smoothing window', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SMOOTHING_WINDOW_MS: '400'})).toMatchObject({
            requestedFaceRoiSmoothingWindowMs: '400',
            faceRoiSmoothingWindowMs: 400
        });
    });

    test('accepts configurable face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SCALE: '1.75'})).toMatchObject({
            requestedFaceRoiScale: '1.75',
            faceRoiScale: 1.75
        });
    });

    test('falls back to the default for invalid face ROI scale', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SCALE: '0.5'}).faceRoiScale)
            .toBe(DEFAULT_FACE_ROI_SCALE);
    });

    test('accepts configurable face ROI upward offset ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_UPWARD_OFFSET_RATIO: '0.25'})).toMatchObject({
            requestedFaceRoiUpwardOffsetRatio: '0.25',
            faceRoiUpwardOffsetRatio: 0.25
        });
    });

    test('falls back to the default for invalid face ROI upward offset ratio', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_UPWARD_OFFSET_RATIO: '1'}).faceRoiUpwardOffsetRatio)
            .toBe(DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO);
    });

    test('falls back to the default for invalid face ROI smoothing windows', () => {
        expect(resolveRawPatchConfiguration({REACT_APP_FACE_ROI_SMOOTHING_WINDOW_MS: '-1'}).faceRoiSmoothingWindowMs)
            .toBe(DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS);
    });
});
