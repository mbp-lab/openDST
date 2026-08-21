import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION, PATCH_SIZE, validateFaceRoiDescriptor, FaceRoiProvider, FaceCropPipeline, FaceCropAnalysisPipeline} from './FaceCropPipeline.worker';
import {FaceCropProcessor, BGR24_FRAME_BYTES, processFaceCropFrame, FaceCropSegmenter} from './FaceCropPipeline.worker';
import {buildUncompressedAvi} from './FaceCropOutput';
import {FaceCropCaptureController, resolveFaceCropConfiguration} from './FaceCropCapture';

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

describe('two-worker capture scheduling', () => {
    test('fails instead of hanging when buffered results have no in-flight worker', async () => {
        const controller = new FaceCropCaptureController({
            video: {cancelVideoFrameCallback: jest.fn()},
            studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({
                REACT_APP_FACE_CROP_RECORDING_MODE: 'all', REACT_APP_FACE_CROP_WORKER_COUNT: '2'
            }),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()},
            uploadResultFile: jest.fn()
        });
        controller.state = 'capturing';
        controller.analysisResults.set(0, {});
        controller.analysisResults.set(1, {});

        await expect(controller.processAnalysisFrame({mediaTime: 1}, Date.now())).resolves.toBeUndefined();
        expect(controller.state).toBe('stopping');
        expect(controller.incompleteReason).toBe('Face-crop analysis result sequence gap');
    });

    test('marks a rejected worker task incomplete and removes it from the in-flight set', async () => {
        const controller = new FaceCropCaptureController({
            video: {videoWidth: 72, videoHeight: 72}, studyResultId: 'RESULT',
            studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.state = 'capturing';
        controller.workers = [{processFrame: jest.fn(() => Promise.reject(new Error('analysis failed')))}];
        const originalVideoFrame = window.VideoFrame;
        window.VideoFrame = jest.fn(() => ({displayWidth: 72, displayHeight: 72}));
        try {
            await controller.processAnalysisFrame({mediaTime: 1}, Date.now());
            await Promise.resolve();
            await Promise.resolve();
            expect(controller.incompleteReason).toBe('analysis failed');
            expect(controller.inFlight.size).toBe(0);
        } finally {
            window.VideoFrame = originalVideoFrame;
        }
    });

    test('drains active analysis before two-worker finalization', async () => {
        let resolveAnalysis;
        const analysis = new Promise(resolve => { resolveAnalysis = resolve; });
        const controller = new FaceCropCaptureController({
            video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.inFlight.set(0, analysis);
        controller.segmenter = {finish: jest.fn(() => [])};
        controller.sink.finalize = jest.fn(() => Promise.resolve({parts: []}));
        controller.closeWorker = jest.fn(() => Promise.resolve());
        controller.uploadManifest = jest.fn(() => Promise.resolve());

        const finalizing = controller.finalize();
        expect(controller.segmenter.finish).not.toHaveBeenCalled();
        resolveAnalysis();
        await finalizing;

        expect(controller.segmenter.finish).toHaveBeenCalledTimes(1);
        expect(controller.sink.finalize).toHaveBeenCalledTimes(1);
    });

    test('keeps worker and result buffering bounded at two frames', async () => {
        const first = {};
        first.promise = new Promise(resolve => { first.resolve = resolve; });
        const second = {};
        second.promise = new Promise(resolve => { second.resolve = resolve; });
        const worker = {processFrame: jest.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise)
            .mockReturnValueOnce(new Promise(() => {}))};
        const controller = new FaceCropCaptureController({
            video: {videoWidth: 72, videoHeight: 72}, studyResultId: 'RESULT',
            studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.state = 'capturing';
        controller.workers = [worker, worker];
        controller.commitAnalysisResult = jest.fn(() => Promise.resolve());
        const originalVideoFrame = window.VideoFrame;
        window.VideoFrame = jest.fn(() => ({displayWidth: 72, displayHeight: 72}));
        try {
            await controller.processAnalysisFrame({mediaTime: 1}, 1);
            await controller.processAnalysisFrame({mediaTime: 2}, 2);
            const thirdDispatch = controller.processAnalysisFrame({mediaTime: 3}, 3);
            expect(worker.processFrame).toHaveBeenCalledTimes(2);
            first.resolve({rgbx: new Uint8Array(4)});
            await thirdDispatch;
            expect(worker.processFrame).toHaveBeenCalledTimes(3);
        } finally {
            window.VideoFrame = originalVideoFrame;
        }
    });
});

function findChunk(bytes, type) {
    for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
        if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === type) return offset;
    }
    return -1;
}

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
    test('warmup always closes transferred frames', () => {
        [FaceCropPipeline, FaceCropAnalysisPipeline].forEach(Pipeline => {
            const pipeline = new Pipeline();
            const frame = {close: jest.fn()};
            pipeline.detector = {detectForVideo: jest.fn()};
            expect(pipeline.warmup({frame, timestampUs: 1000})).toEqual({});
            expect(frame.close).toHaveBeenCalledTimes(1);
        });
    });

    test('warmup closes its frame when detection fails', () => {
        const pipeline = new FaceCropAnalysisPipeline();
        const error = new Error('warmup failed');
        const frame = {close: jest.fn()};
        pipeline.detector = {detectForVideo: jest.fn(() => { throw error; })};

        expect(() => pipeline.warmup({frame, timestampUs: 1000})).toThrow(error);
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('analysis returns packed pixels and closes its input frame', async () => {
        const pipeline = new FaceCropAnalysisPipeline();
        pipeline.detector = {detectForVideo: jest.fn(() => ({detections: [detection(0, 0, 72, 72)]}))};
        const frame = {copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};

        const result = await pipeline.processFrame({frame, width: 72, height: 72, timestampUs: 1000, wallClockMs: 10, sequence: 4});

        expect(result).toMatchObject({sequence: 4, width: 72, height: 72, timestampUs: 1000, wallClockMs: 10,
            detections: expect.any(Array), rgbx: expect.any(Uint8Array)});
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('commits out-of-order analysis results in sequence order', async () => {
        const controller = new FaceCropCaptureController({
            video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        const committed = [];
        controller.roi = {getSelection: jest.fn(({timestampMs}) => ({roi: {coordinateSystem: FACE_COORDINATE_SYSTEM,
            transformType: DYNAMIC_FACE_SQUARE, samplingVersion: AREA_AVERAGE_V1, descriptorVersion: FACE_ROI_DESCRIPTOR_VERSION,
            x: 0, y: 0, size: 72}, state: String(timestampMs), detection: {}}))};
        controller.segmenter = {appendFrame: jest.fn(({timestampUs}) => { committed.push(timestampUs); return []; })};
        const result = timestampUs => ({width: 72, height: 72, timestampUs, wallClockMs: timestampUs,
            detections: [], rgbx: new Uint8Array(72 * 72 * 4), timings: {}});

        await controller.commitAnalysisResult({result: result(2000), sequence: 1, startedAt: performance.now()});
        expect(committed).toEqual([]);
        await controller.commitAnalysisResult({result: result(1000), sequence: 0, startedAt: performance.now()});
        expect(committed).toEqual([1000, 2000]);
    });

    test('uploads source-ordered AVI frames and event records after out-of-order analysis', async () => {
        const uploadResultFile = jest.fn(() => Promise.resolve());
        const controller = new FaceCropCaptureController({
            video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile
        });
        controller.roi = new FaceRoiProvider({smoothingTauMs: 0});
        controller.segmenter = new FaceCropSegmenter({
            studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1, maxFramesPerPart: 2
        });
        controller.sink.encode = part => Promise.resolve(buildUncompressedAvi(part));
        const result = (timestampUs, color) => {
            const rgbx = new Uint8Array(72 * 72 * 4);
            for (let offset = 0; offset < rgbx.byteLength; offset += 4) rgbx.set([...color, 255], offset);
            return {width: 72, height: 72, timestampUs, wallClockMs: timestampUs, detections: [], rgbx,
                timings: {detectionMs: 0, rgbaCopyMs: 0, analysisMs: 0}};
        };
        const aviFramePixels = avi => {
            const indexOffset = String.fromCharCode(...avi.subarray(0, 4)) === 'RIFF'
                ? findChunk(avi, 'idx1') : -1;
            const frames = [];
            for (let offset = 0; offset < indexOffset; offset += 1) {
                if (String.fromCharCode(...avi.subarray(offset, offset + 4)) === '00db') {
                    frames.push(Array.from(avi.subarray(offset + 8, offset + 11)));
                }
            }
            return frames;
        };

        await controller.commitAnalysisResult({result: result(2000, [40, 50, 60]), sequence: 1, startedAt: performance.now()});
        await controller.commitAnalysisResult({result: result(1000, [10, 20, 30]), sequence: 0, startedAt: performance.now()});
        await controller.enqueueParts(controller.segmenter.finish());
        await controller.sink.finalize();

        expect(uploadResultFile).toHaveBeenCalledTimes(2);
        expect(aviFramePixels(uploadResultFile.mock.calls[0][0])).toEqual([[30, 20, 10], [60, 50, 40]]);
        expect(JSON.parse(uploadResultFile.mock.calls[1][0]).frames.map(frame => frame.mediaTimeUs)).toEqual([1000, 2000]);
    });

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
