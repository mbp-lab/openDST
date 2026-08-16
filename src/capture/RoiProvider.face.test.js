import {
    AREA_AVERAGE_V1,
    DYNAMIC_FACE_SQUARE,
    FACE_COORDINATE_SYSTEM,
    FaceRoiProvider,
    PATCH_SIZE
} from './RoiProvider';

function detection(originX, originY, width, height) {
    return {boundingBox: {originX, originY, width, height}};
}

describe('FaceRoiProvider', () => {
    test('creates a padded, bounded MediaPipe face crop in source pixels', () => {
        const provider = new FaceRoiProvider({smoothingWindowMs: 0});
        const roi = provider.getRoi({
            width: 640,
            height: 480,
            detections: [detection(250, 100, 100, 120)]
        });

        expect(roi).toMatchObject({
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            x: 210,
            y: 43,
            size: 180
        });
        expect(roi.size % PATCH_SIZE).not.toBe(0);
    });

    test('adds a configurable upward offset above the detected face', () => {
        const centered = new FaceRoiProvider({scale: 1, upwardOffsetRatio: 0, smoothingWindowMs: 0});
        const upwardOffset = new FaceRoiProvider({scale: 1, upwardOffsetRatio: 0.2, smoothingWindowMs: 0});
        const frame = {width: 640, height: 480, detections: [detection(200, 100, 100, 100)]};

        expect(upwardOffset.getRoi(frame).y).toBe(centered.getRoi(frame).y - 20);
    });

    test('uses elapsed time to smooth crop size between detections', () => {
        const provider = new FaceRoiProvider({scale: 1, smoothingWindowMs: 1000});
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)], timestampMs: 0});
        const roi = provider.getRoi({width: 640, height: 480, detections: [detection(150, 50, 200, 200)], timestampMs: 100});

        expect(roi.size).toBeGreaterThan(100);
        expect(roi.size).toBeLessThan(200);
    });

    test('scales the crop relative to the detected face', () => {
        const provider = new FaceRoiProvider({scale: 2, smoothingWindowMs: 0});
        const roi = provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)]});

        expect(roi.size).toBe(200);
    });

    test('clamps crops at the image boundary', () => {
        const provider = new FaceRoiProvider({scale: 2, smoothingWindowMs: 0});
        const roi = provider.getRoi({
            width: 320,
            height: 240,
            detections: [detection(-10, -5, 100, 100)]
        });

        expect(roi.x).toBe(0);
        expect(roi.y).toBe(0);
        expect(roi.x + roi.size).toBeLessThanOrEqual(320);
        expect(roi.y + roi.size).toBeLessThanOrEqual(240);
    });

    test('holds the last crop briefly and then returns null', () => {
        const provider = new FaceRoiProvider({maxMissedFrames: 2});
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)]});

        expect(provider.getRoi({width: 640, height: 480, detections: []})).not.toBeNull();
        expect(provider.getRoi({width: 640, height: 480, detections: []})).not.toBeNull();
        expect(provider.getRoi({width: 640, height: 480, detections: []})).toBeNull();
    });

    test('does not return an out-of-bounds held crop after a source resize', () => {
        const provider = new FaceRoiProvider();
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 200, 200)]});

        expect(provider.getRoi({width: 320, height: 240, detections: []})).toBeNull();
    });
});
