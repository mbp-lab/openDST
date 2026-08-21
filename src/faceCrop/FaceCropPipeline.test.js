import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION, PATCH_SIZE, validateFaceRoiDescriptor, FaceRoiProvider, FaceCropAnalysisPipeline, FaceCropAssemblyPipeline} from './FaceCropPipeline.worker';
import {FaceCropProcessor, BGR24_FRAME_BYTES, processFaceCropFrame, FaceCropSegmenter} from './FaceCropPipeline.worker';
import {buildUncompressedAvi} from './FaceCropOutput';
import pako from 'pako';
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

describe('analysis and assembly scheduling', () => {
    test('marks a rejected detector task incomplete and removes it from the in-flight set', async () => {
        const controller = new FaceCropCaptureController({
            video: {videoWidth: 72, videoHeight: 72}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.state = 'capturing';
        controller.analysisWorkers = [{processFrame: jest.fn(() => Promise.reject(new Error('analysis failed')))}];
        controller.assemblyWorker = {processAnalysisResult: jest.fn()};
        const originalVideoFrame = window.VideoFrame;
        window.VideoFrame = jest.fn(() => ({displayWidth: 72, displayHeight: 72}));
        try {
            await controller.processAnalysisFrame({mediaTime: 1}, Date.now());
            await Promise.all([...controller.inFlight.values()]);
            expect(controller.incompleteReason).toBe('analysis failed');
            expect(controller.inFlight.size).toBe(0);
        } finally { window.VideoFrame = originalVideoFrame; }
    });

    test('drains active analysis before finalizing the assembly worker', async () => {
        let resolveAnalysis;
        const analysis = new Promise(resolve => { resolveAnalysis = resolve; });
        const controller = new FaceCropCaptureController({
            video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.inFlight.set(0, analysis);
        controller.assemblyWorker = {finish: jest.fn(() => Promise.resolve({artifacts: [], bufferedResultCount: 0}))};
        controller.sink.finalize = jest.fn(() => Promise.resolve({parts: []}));
        controller.closeWorker = jest.fn(() => Promise.resolve());
        controller.uploadManifest = jest.fn(() => Promise.resolve());
        const finalizing = controller.finalize();
        expect(controller.assemblyWorker.finish).not.toHaveBeenCalled();
        resolveAnalysis();
        await finalizing;
        expect(controller.assemblyWorker.finish).toHaveBeenCalledTimes(1);
        expect(controller.sink.finalize).toHaveBeenCalledTimes(1);
    });

    test('keeps detector dispatch bounded by the analysis-worker count', async () => {
        const first = {}; first.promise = new Promise(resolve => { first.resolve = resolve; });
        const second = {}; second.promise = new Promise(resolve => { second.resolve = resolve; });
        const worker = {processFrame: jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
            .mockReturnValueOnce(new Promise(() => {}))};
        const controller = new FaceCropCaptureController({
            video: {videoWidth: 72, videoHeight: 72}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT: '2'}),
            uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()
        });
        controller.state = 'capturing';
        controller.analysisWorkers = [worker, worker];
        controller.assemblyWorker = {processAnalysisResult: jest.fn(result => Promise.resolve({commits: [{...result, accepted: false,
            detectionState: 'default', artifacts: [], controllerStartedAt: result.controllerStartedAt, timings: {}}], bufferedResultCount: 0}))};
        const originalVideoFrame = window.VideoFrame;
        window.VideoFrame = jest.fn(() => ({displayWidth: 72, displayHeight: 72}));
        try {
            await controller.processAnalysisFrame({mediaTime: 1}, 1);
            await controller.processAnalysisFrame({mediaTime: 2}, 2);
            const thirdDispatch = controller.processAnalysisFrame({mediaTime: 3}, 3);
            expect(worker.processFrame).toHaveBeenCalledTimes(2);
            first.resolve({sequence: 0, rgbx: new Uint8Array(4), timings: {}});
            await thirdDispatch;
            expect(worker.processFrame).toHaveBeenCalledTimes(3);
        } finally { window.VideoFrame = originalVideoFrame; }
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


describe('worker roles', () => {
    test('analysis warmup and processing always close transferred frames', async () => {
        const pipeline = new FaceCropAnalysisPipeline();
        pipeline.detector = {detectForVideo: jest.fn(() => ({detections: [detection(0, 0, 72, 72)]}))};
        const warmupFrame = {close: jest.fn()};
        expect(pipeline.warmup({frame: warmupFrame, timestampUs: 1000})).toEqual({});
        expect(warmupFrame.close).toHaveBeenCalledTimes(1);
        const frame = {copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const result = await pipeline.processFrame({frame, width: 72, height: 72, timestampUs: 1000, wallClockMs: 10, sequence: 4});
        expect(result).toMatchObject({sequence: 4, rgbx: expect.any(Uint8Array)});
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('assembly commits 1 then 0 in source order and emits ordered AVI and events', async () => {
        const encodePart = jest.fn(part => Promise.resolve({...part, gzipBytes: pako.gzip(buildUncompressedAvi(part)).buffer}));
        const pipeline = new FaceCropAssemblyPipeline({encodePart});
        pipeline.maxPendingResults = 2;
        pipeline.roi = new FaceRoiProvider({smoothingTauMs: 0});
        pipeline.segmenter = new FaceCropSegmenter({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            captureId: 'capture', maxFramesPerPart: 2, selectionConfiguration: {policy: 'test'}});
        const input = (sequence, timestampUs, color) => {
            const rgbx = new Uint8Array(72 * 72 * 4);
            for (let offset = 0; offset < rgbx.byteLength; offset += 4) rgbx.set([...color, 255], offset);
            return {sequence, width: 72, height: 72, timestampUs, wallClockMs: timestampUs, detections: [], rgbx,
                controllerStartedAt: sequence, timings: {analysisMs: 1}};
        };
        expect((await pipeline.processAnalysisResult(input(1, 2000, [40, 50, 60]))).commits).toEqual([]);
        const result = await pipeline.processAnalysisResult(input(0, 1000, [10, 20, 30]));
        expect(result.commits.map(commit => commit.sequence)).toEqual([0, 1]);
        const artifact = result.commits[1].artifacts[0];
        const avi = pako.ungzip(new Uint8Array(artifact.gzipBytes));
        const frameOffsets = [];
        const indexOffset = findChunk(avi, 'idx1');
        for (let offset = 0; offset < indexOffset; offset += 1) {
            if (String.fromCharCode(...avi.subarray(offset, offset + 4)) === '00db') frameOffsets.push(offset + 8);
        }
        expect(frameOffsets.map(offset => Array.from(avi.subarray(offset, offset + 3)))).toEqual([[30, 20, 10], [60, 50, 40]]);
        expect(artifact.faceEvents.frames.map(frame => frame.mediaTimeUs)).toEqual([1000, 2000]);
        expect(artifact).toMatchObject({captureId: 'capture', segmentIndex: 0, partIndex: 0});
    });

    test('bounds out-of-order assembly buffering and fails finish on a sequence gap', async () => {
        const pipeline = new FaceCropAssemblyPipeline();
        pipeline.maxPendingResults = 1;
        pipeline.roi = new FaceRoiProvider({smoothingTauMs: 0});
        pipeline.segmenter = {finish: jest.fn(() => [])};
        const result = {sequence: 1, width: 72, height: 72, timestampUs: 1, wallClockMs: 1, detections: [], rgbx: new Uint8Array(72 * 72 * 4), timings: {}};
        await pipeline.processAnalysisResult(result);
        await expect(pipeline.processAnalysisResult({...result, sequence: 2, rgbx: new Uint8Array(result.rgbx.byteLength)}))
            .rejects.toThrow('Assembly result buffer is invalid');
        await expect(pipeline.finish()).rejects.toThrow('sequence gap');
    });

    test('starts a new segment when ordered source dimensions change', async () => {
        const encodePart = jest.fn(part => Promise.resolve({...part, gzipBytes: new ArrayBuffer(1)}));
        const pipeline = new FaceCropAssemblyPipeline({encodePart});
        pipeline.maxPendingResults = 1;
        pipeline.roi = new FaceRoiProvider({smoothingTauMs: 0});
        pipeline.segmenter = new FaceCropSegmenter({studyResultId: 'RESULT', studyPage: 'intro', videoCounter: 1,
            captureId: 'capture', maxFramesPerPart: 10, selectionConfiguration: {}});
        const result = (sequence, width) => ({sequence, width, height: 72, timestampUs: sequence, wallClockMs: sequence,
            detections: [], rgbx: new Uint8Array(width * 72 * 4), timings: {}});
        await pipeline.processAnalysisResult(result(0, 72));
        const changed = await pipeline.processAnalysisResult(result(1, 73));
        expect(changed.commits[0].artifacts[0]).toMatchObject({segmentIndex: 0, partIndex: 0});
        expect((await pipeline.finish()).artifacts[0]).toMatchObject({segmentIndex: 1, partIndex: 0});
    });
});
