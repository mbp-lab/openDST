import {
    AREA_AVERAGE_V1,
    DYNAMIC_FACE_SQUARE,
    FACE_COORDINATE_SYSTEM,
    FaceRoiProvider,
    PATCH_SIZE
} from './FaceRoiProvider';

function detection(originX, originY, width, height, score = 0.9) {
    return {boundingBox: {originX, originY, width, height}, categories: [{score}]};
}

describe('FaceRoiProvider', () => {
    test('creates a padded, bounded MediaPipe face crop in source pixels', () => {
        const provider = new FaceRoiProvider({smoothingTauMs: 0});
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

    test('selects the largest eligible face independently of MediaPipe result order', () => {
        const provider = new FaceRoiProvider({scale: 1, smoothingTauMs: 0, minDetectionConfidence: 0.5});
        const selection = provider.getSelection({
            width: 640,
            height: 480,
            timestampMs: 0,
            detections: [
                detection(300, 100, 80, 80, 0.99),
                detection(100, 80, 150, 120, 0.51),
                detection(200, 50, 200, 200, 0.49)
            ]
        });

        expect(selection).toMatchObject({
            state: 'largest',
            candidateCount: 2,
            selectedScore: 0.51,
            selectedBoundingBox: {originX: 100, originY: 80, width: 150, height: 120},
            tieBreakOccurred: false
        });
    });

    test('uses documented tie breakers for equal-size candidates', () => {
        const provider = new FaceRoiProvider({scale: 1, smoothingTauMs: 0});
        const selection = provider.getSelection({
            width: 640,
            height: 480,
            timestampMs: 0,
            detections: [detection(200, 100, 100, 100, 0.7), detection(50, 100, 100, 100, 0.9)]
        });

        expect(selection.selectedBoundingBox.originX).toBe(50);
        expect(selection.tieBreakOccurred).toBe(true);
    });

    test('applies signed vertical shifts around the detected face', () => {
        const centered = new FaceRoiProvider({scale: 1, verticalShiftRatio: 0, smoothingTauMs: 0});
        const upwardShift = new FaceRoiProvider({scale: 1, verticalShiftRatio: 0.2, smoothingTauMs: 0});
        const frame = {width: 640, height: 480, detections: [detection(200, 100, 100, 100)]};

        expect(upwardShift.getRoi(frame).y).toBe(centered.getRoi(frame).y - 20);
        const downwardShift = new FaceRoiProvider({scale: 1, verticalShiftRatio: -0.2, smoothingTauMs: 0});
        expect(downwardShift.getRoi(frame).y).toBe(centered.getRoi(frame).y + 20);
    });

    test('uses tau as the EMA time constant', () => {
        const provider = new FaceRoiProvider({scale: 1, smoothingTauMs: 100});
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)], timestampMs: 0});
        const roi = provider.getRoi({width: 640, height: 480, detections: [detection(150, 50, 200, 200)], timestampMs: 100});

        expect(roi.size).toBe(163);
    });

    test('scales the crop relative to the detected face', () => {
        const provider = new FaceRoiProvider({scale: 2, smoothingTauMs: 0});
        const roi = provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)]});

        expect(roi.size).toBe(200);
    });

    test('clamps crops at the image boundary', () => {
        const provider = new FaceRoiProvider({scale: 2, smoothingTauMs: 0});
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

    test('holds the last crop indefinitely after a face was selected', () => {
        const provider = new FaceRoiProvider();
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 100, 100)], timestampMs: 0});

        expect(provider.getSelection({width: 640, height: 480, detections: [], timestampMs: 200})).toMatchObject({state: 'held'});
        expect(provider.getSelection({width: 640, height: 480, detections: [], timestampMs: 200000})).toMatchObject({state: 'held'});
        expect(provider.getSelection({width: 640, height: 480, detections: [detection(200, 100, 100, 100)], timestampMs: 200100}))
            .toMatchObject({state: 'reacquired'});
    });

    test('does not return an out-of-bounds held crop after a source resize', () => {
        const provider = new FaceRoiProvider();
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 200, 200)], timestampMs: 0});

        expect(provider.getRoi({width: 320, height: 240, detections: [], timestampMs: 100})).toBeNull();
    });
});
