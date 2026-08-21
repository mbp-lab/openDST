import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION, PATCH_SIZE, validateFaceRoiDescriptor, FaceRoiProvider, FaceCropPipeline} from './FaceCropPipeline.worker';
import {FaceCropProcessor, BGR24_FRAME_BYTES, processFaceCropFrame} from './FaceCropPipeline.worker';

describe('MediaPipe detector configuration', () => {
    test('passes the selected delegate to MediaPipe options', async () => {
        const originalVision = global.importScripts;
        const createFromOptions = jest.fn(() => Promise.resolve('detector'));
        global.importScripts = jest.fn(() => {
            global.Vision = {
                FaceDetector: {createFromOptions},
                FilesetResolver: {forVisionTasks: jest.fn(() => Promise.resolve('fileset'))}
            };
        });
        global.fetch = jest.fn(() => Promise.resolve({ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1))}));

        try {
            const {createMediaPipeFaceDetector} = require('./FaceCropPipeline.worker');
            await expect(createMediaPipeFaceDetector({delegate: 'GPU'})).resolves.toBe('detector');
            expect(createFromOptions).toHaveBeenCalledWith('fileset', expect.objectContaining({
                baseOptions: expect.objectContaining({delegate: 'GPU'})
            }));
        } finally {
            global.importScripts = originalVision;
        }
    });
});

// Worker tests cover deterministic ROI selection and pixel conversion without
// loading MediaPipe, so algorithm changes remain cheap to validate in Jest.
function setPixel(rgbx, width, x, y, color) {
    const offset = (y * width + x) * 4;
    rgbx[offset] = color[0];
    rgbx[offset + 1] = color[1];
    rgbx[offset + 2] = color[2];
    rgbx[offset + 3] = 255;
}
function detection(originX, originY, width, height, score = 0.9) {
    return {boundingBox: {originX, originY, width, height}, categories: [{score}]};
}


describe('FaceCropProcessor', () => {
    // Pixel tests define the RGBX-to-BGR24 byte order and area-resampling rule;
    // these are data-contract tests, not implementation-detail tests.
    test('rejects the removed camera ROI descriptor', () => {
        expect(() => validateFaceRoiDescriptor({coordinateSystem: 'camera'})).toThrow('Unsupported ROI coordinate system');
    });
    test('area-resamples an arbitrary source-pixel crop with integer half-up rounding', () => {
        const width = 73;
        const rgbx = new Uint8Array(width * width * 4);
        setPixel(rgbx, width, 72, 72, [255, 255, 255]);
        const roi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: 73
        };

        const output = new FaceCropProcessor().process({rgbx, width, height: width, roi});

        expect(output.slice((71 * PATCH_SIZE + 71) * 3, (71 * PATCH_SIZE + 72) * 3)).toEqual(new Uint8Array([248, 248, 248]));
        expect(output.slice((70 * PATCH_SIZE + 71) * 3, (70 * PATCH_SIZE + 72) * 3)).toEqual(new Uint8Array([0, 0, 0]));
    });
    test('emits BGR24 directly from RGBX input', () => {
        const rgbx = new Uint8Array(PATCH_SIZE * PATCH_SIZE * 4);
        for (let offset = 0; offset < rgbx.byteLength; offset += 4) {
            rgbx.set([11, 22, 33, 255], offset);
        }
        const roi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: PATCH_SIZE
        };

        const output = new FaceCropProcessor().process({rgbx, width: PATCH_SIZE, height: PATCH_SIZE, roi});

        expect(output.byteLength).toBe(BGR24_FRAME_BYTES);
        expect(output.slice(0, 3)).toEqual(new Uint8Array([33, 22, 11]));
    });
    test('writes into a caller-provided BGR24 output buffer', () => {
        const rgbx = new Uint8Array(PATCH_SIZE * PATCH_SIZE * 4);
        for (let offset = 0; offset < rgbx.byteLength; offset += 4) rgbx.set([11, 22, 33, 255], offset);
        const roi = {
            coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE,
            samplingVersion: AREA_AVERAGE_V1,
            descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0,
            y: 0,
            size: PATCH_SIZE
        };
        const output = new Uint8Array(BGR24_FRAME_BYTES).fill(255);

        expect(processFaceCropFrame({rgbx, width: PATCH_SIZE, height: PATCH_SIZE, roi, output})).toBe(output);
        expect(output.slice(0, 3)).toEqual(new Uint8Array([33, 22, 11]));
        expect(() => processFaceCropFrame({rgbx, width: PATCH_SIZE, height: PATCH_SIZE, roi, output: new Uint8Array(1)}))
            .toThrow('BGR24 output must be a');
    });
});
describe('FaceRoiProvider', () => {
    // ROI tests protect deterministic selection, smoothing, bounds, and the
    // policy of holding a valid crop through temporary detector misses.
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

    test('uses the largest centered square before a face is detected', () => {
        const provider = new FaceRoiProvider();
        expect(provider.getSelection({width: 640, height: 480, detections: [], timestampMs: 0})).toMatchObject({
            state: 'default',
            roi: {x: 80, y: 0, size: 480}
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

    test('uses a centered default crop after a source resize', () => {
        const provider = new FaceRoiProvider();
        provider.getRoi({width: 640, height: 480, detections: [detection(200, 100, 200, 200)], timestampMs: 0});

        expect(provider.getRoi({width: 320, height: 240, detections: [], timestampMs: 100})).toMatchObject({x: 40, y: 0, size: 240});
    });
});


describe('FaceCropPipeline worker input', () => {
    test('passes the VideoFrame directly and resamples the selected source ROI', async () => {
        const pipeline = new FaceCropPipeline();
        pipeline.detector = {detectForVideo: jest.fn(() => ({detections: [detection(21, 21, 60, 60)]}))};
        pipeline.roi = new FaceRoiProvider({scale: 1, verticalShiftRatio: 0, smoothingTauMs: 0});
        let appendInput;
        pipeline.segmenter = {appendFrame: jest.fn(input => { appendInput = input; return []; })};
        const frame = {copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};

        const result = await pipeline.processFrame({frame, width: 100, height: 120, timestampUs: 1000, wallClockMs: 1000});
        expect(result).toMatchObject({accepted: true});
        expect(result.timings).toEqual(expect.objectContaining({
            detectionMs: expect.any(Number), roiSelectionMs: expect.any(Number), rgbaCopyMs: expect.any(Number),
            cropAndSegmentMs: expect.any(Number), pipelineTotalMs: expect.any(Number)
        }));
        expect(pipeline.detector.detectForVideo).toHaveBeenCalledWith(frame, 1);
        expect(frame.copyTo).toHaveBeenCalledTimes(1);
        const [rgba, options] = frame.copyTo.mock.calls[0];
        expect(rgba).toBeInstanceOf(Uint8Array);
        expect(rgba.byteLength).toBe(100 * 120 * 4);
        expect(options).toEqual({format: 'RGBA', colorSpace: 'srgb'});
        expect(appendInput).toMatchObject({sourceWidth: 100, sourceHeight: 120, roi: {x: 15, y: 15, size: 72}});
        expect(frame.close).toHaveBeenCalledTimes(1);

        const output = new Uint8Array(BGR24_FRAME_BYTES);
        appendInput.writeBgr24(output);
        expect(output).toHaveLength(BGR24_FRAME_BYTES);
    });

    test('closes the frame when detection fails', async () => {
        const pipeline = new FaceCropPipeline();
        const error = new Error('detector failed');
        pipeline.detector = {detectForVideo: jest.fn(() => { throw error; })};
        const frame = {copyTo: jest.fn(), close: jest.fn()};

        await expect(pipeline.processFrame({frame, width: 100, height: 120, timestampUs: 1000, wallClockMs: 1000})).rejects.toBe(error);
        expect(frame.copyTo).not.toHaveBeenCalled();
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('repackages padded VideoFrame rows before resampling', async () => {
        const pipeline = new FaceCropPipeline();
        pipeline.detector = {detectForVideo: jest.fn(() => ({detections: [detection(21, 21, 60, 60)]}))};
        pipeline.roi = new FaceRoiProvider({scale: 1, verticalShiftRatio: 0, smoothingTauMs: 0});
        let appendInput;
        pipeline.segmenter = {appendFrame: jest.fn(input => { appendInput = input; return []; })};
        const frame = {
            allocationSize: jest.fn(() => 112 * 120 * 4),
            copyTo: jest.fn(buffer => {
                for (let row = 0; row < 120; row += 1) {
                    for (let column = 0; column < 100; column += 1) buffer[row * 112 * 4 + column * 4] = 11;
                }
                return Promise.resolve([{offset: 0, stride: 112 * 4}]);
            }),
            close: jest.fn()
        };

        await pipeline.processFrame({frame, width: 100, height: 120, timestampUs: 1000, wallClockMs: 1000});
        const output = new Uint8Array(BGR24_FRAME_BYTES);
        appendInput.writeBgr24(output);
        expect(output[2]).toBe(11);
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('closes the frame when ROI extraction fails', async () => {
        const pipeline = new FaceCropPipeline();
        pipeline.detector = {detectForVideo: jest.fn(() => ({detections: [detection(10, 20, 20, 20)]}))};
        pipeline.roi = new FaceRoiProvider({scale: 1, verticalShiftRatio: 0, smoothingTauMs: 0});
        pipeline.segmenter = {appendFrame: jest.fn()};
        const error = new Error('copy failed');
        const frame = {copyTo: jest.fn(() => Promise.reject(error)), close: jest.fn()};

        await expect(pipeline.processFrame({frame, width: 100, height: 120, timestampUs: 1000, wallClockMs: 1000})).rejects.toBe(error);
        expect(frame.close).toHaveBeenCalledTimes(1);
    });
});
