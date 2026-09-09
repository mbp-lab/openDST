import {AREA_AVERAGE_V1, DYNAMIC_FACE_SQUARE, FACE_COORDINATE_SYSTEM, FACE_ROI_DESCRIPTOR_VERSION, PATCH_SIZE, validateFaceRoiDescriptor, convertBlazeFacePredictions, FaceRoiProvider, FaceCropAnalysisPipeline, FaceCropAssemblyPipeline, FaceCropEncodingPipeline} from './FaceCropPipeline.worker';
import {FaceCropProcessor, BGR24_FRAME_BYTES, processFaceCropFrame, FaceCropSegmenter} from './FaceCropPipeline.worker';
import {buildUncompressedAvi} from './FaceCropOutput';
import pako from 'pako';
import {FaceCropCaptureController, resolveFaceCropConfiguration} from './FaceCropCapture';

function deferred() {
    let resolve;
    return {promise: new Promise(nextResolve => { resolve = nextResolve; }), resolve};
}

describe('BlazeFace detector configuration', () => {
    afterEach(() => {
        delete global.tf;
        delete global.blazeface;
        jest.resetModules();
    });

    function installRuntime({load = jest.fn(() => Promise.resolve('model')), setBackend = jest.fn(() => Promise.resolve(true))} = {}) {
        const tf = {wasm: {setWasmPaths: jest.fn()}, setBackend, getBackend: jest.fn(() => 'wasm'),
            ready: jest.fn(() => Promise.resolve())};
        global.importScripts = jest.fn(url => {
            if (url.endsWith('/tf.min.js')) global.tf = tf;
            if (url.endsWith('/blazeface.min.umd.js')) global.blazeface = {load};
        });
        return {tf, load};
    }

    test('selects only the WASM backend and loads the local model with the configured confidence', async () => {
        const {tf, load} = installRuntime();
        const {createBlazeFaceDetector} = require('./FaceCropPipeline.worker');
        await expect(createBlazeFaceDetector({minDetectionConfidence: 0.65})).resolves.toMatchObject({model: 'model'});
        expect(tf.setBackend).toHaveBeenCalledTimes(1);
        expect(tf.setBackend).toHaveBeenCalledWith('wasm');
        expect(tf.setBackend).not.toHaveBeenCalledWith('webgl');
        expect(tf.wasm.setWasmPaths.mock.calls[0][0]).toContain('/tfjs/4.22.0/');
        expect(load).toHaveBeenCalledWith(expect.objectContaining({modelUrl: expect.stringContaining('/model/model.json'),
            scoreThreshold: 0.65}));
        expect(global.importScripts.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
            expect.stringMatching(/tf\.min\.js$/), expect.stringMatching(/tf-backend-wasm\.min\.js$/),
            expect.stringMatching(/blazeface\.min\.umd\.js$/)
        ]));
    });

    test('reports the initialization stage when WASM selection fails', async () => {
        installRuntime({setBackend: jest.fn(() => Promise.reject(new Error('compile failed')))});
        const {createBlazeFaceDetector} = require('./FaceCropPipeline.worker');
        await expect(createBlazeFaceDetector()).rejects.toThrow('BlazeFace WASM backend initialization failed: compile failed');
    });

    test('maps BlazeFace predictions into clamped internal detections', () => {
        expect(convertBlazeFacePredictions([{topLeft: [-5, 10], bottomRight: [110, 90], probability: [0.87]}], 100, 80))
            .toEqual([{boundingBox: {originX: 0, originY: 10, width: 100, height: 70}, categories: [{score: 0.87}]}]);
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
            await controller.processAnalysisFrame({mediaTime: 1}, Date.now(), 1000000);
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
        controller.assemblyWorker = {finish: jest.fn(() => Promise.resolve({parts: [], bufferedResultCount: 0}))};
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

    test('does not wait for encoder completion before committing later assembly results', async () => {
        const encoded = deferred();
        const artifact = {captureId: 'capture', segmentIndex: 0, partIndex: 0, filename: 'part.avi.gz', faceEventsFilename: 'part.face-events.json',
            frameCount: 1, frameRate: 30, gzipBytes: new Uint8Array([1]).buffer, faceEvents: {aviFilename: 'part.avi.gz', frameCount: 1, frames: []}};
        const rawPart = {...artifact, bytes: new Uint8Array([1])};
        const controller = new FaceCropCaptureController({video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        controller.encoderWorker = {encodePart: jest.fn(() => encoded.promise)};
        controller.sink.enqueuePart = jest.fn(() => Promise.resolve());

        await controller.commitAssemblyResult({bufferedResultCount: 0, commits: [{sequence: 0, accepted: false, detectionState: 'default',
            parts: [rawPart], timings: {}}]});
        await controller.commitAssemblyResult({bufferedResultCount: 0, commits: [{sequence: 1, accepted: false, detectionState: 'default',
            parts: [], timings: {}}]});

        expect(controller.encoderWorker.encodePart).toHaveBeenCalledWith(rawPart);
        expect(controller.encodingJobs.size).toBe(1);
        encoded.resolve({artifact, timings: {encodingMs: 1}});
        await Promise.all(controller.encodingJobs.values());
        expect(controller.sink.enqueuePart).toHaveBeenCalledWith(artifact);
    });

    test('waits for the final encoder job before finalizing uploads and the manifest', async () => {
        const encoded = deferred();
        const artifact = {captureId: 'capture', segmentIndex: 0, partIndex: 0, filename: 'part.avi.gz', faceEventsFilename: 'part.face-events.json',
            frameCount: 1, frameRate: 30, gzipBytes: new Uint8Array([1]).buffer, faceEvents: {aviFilename: 'part.avi.gz', frameCount: 1, frames: []}};
        const rawPart = {...artifact, bytes: new Uint8Array([1])};
        const controller = new FaceCropCaptureController({video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        controller.assemblyWorker = {finish: jest.fn(() => Promise.resolve({parts: [rawPart], bufferedResultCount: 0}))};
        controller.encoderWorker = {encodePart: jest.fn(() => encoded.promise)};
        controller.sink.enqueuePart = jest.fn(() => Promise.resolve());
        controller.sink.finalize = jest.fn(() => Promise.resolve({parts: []}));
        controller.closeWorker = jest.fn(() => Promise.resolve());
        controller.uploadManifest = jest.fn(() => Promise.resolve());

        const finalizing = controller.finalize();
        await Promise.resolve();
        expect(controller.sink.finalize).not.toHaveBeenCalled();
        encoded.resolve({artifact, timings: {encodingMs: 1}});
        await finalizing;
        expect(controller.sink.finalize).toHaveBeenCalledTimes(1);
        expect(controller.uploadManifest).toHaveBeenCalledWith([]);
    });

    test('bounds raw parts waiting for the encoder', async () => {
        const firstEncoding = deferred();
        const artifact = partIndex => ({captureId: 'capture', segmentIndex: 0, partIndex, filename: 'part-' + partIndex + '.avi.gz',
            faceEventsFilename: 'part-' + partIndex + '.face-events.json', frameCount: 1, frameRate: 30, gzipBytes: new Uint8Array([partIndex + 1]).buffer,
            faceEvents: {aviFilename: 'part-' + partIndex + '.avi.gz', frameCount: 1, frames: []}});
        const raw = partIndex => ({...artifact(partIndex), bytes: new Uint8Array([partIndex + 1])});
        const controller = new FaceCropCaptureController({video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        controller.encoderWorker = {encodePart: jest.fn().mockReturnValueOnce(firstEncoding.promise).mockResolvedValueOnce({artifact: artifact(1), timings: {encodingMs: 1}})};
        controller.sink.enqueuePart = jest.fn(() => Promise.resolve());

        await controller.enqueueEncodingPart(raw(0));
        const secondAdmission = controller.enqueueEncodingPart(raw(1));
        await Promise.resolve();
        expect(controller.encoderWorker.encodePart).toHaveBeenCalledTimes(1);
        firstEncoding.resolve({artifact: artifact(0), timings: {encodingMs: 1}});
        await secondAdmission;
        expect(controller.encoderWorker.encodePart).toHaveBeenCalledTimes(2);
    });

    test('marks capture incomplete when encoder work fails', async () => {
        const rawPart = {segmentIndex: 0, partIndex: 0, frameCount: 1, bytes: new Uint8Array([1])};
        const controller = new FaceCropCaptureController({video: {}, studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            configuration: resolveFaceCropConfiguration({}), uploadTracker: {registerUpload: jest.fn(), settleUpload: jest.fn()}, uploadResultFile: jest.fn()});
        controller.encoderWorker = {encodePart: jest.fn(() => Promise.reject(new Error('gzip unavailable')))};

        await controller.enqueueEncodingPart(rawPart);
        await Promise.all(controller.encodingJobs.values());
        expect(controller.incompleteReason).toBe('Face-crop encoding failed: gzip unavailable');
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
            detectionState: 'default', parts: [], timings: {}}], bufferedResultCount: 0}))};
        const originalVideoFrame = window.VideoFrame;
        window.VideoFrame = jest.fn(() => ({displayWidth: 72, displayHeight: 72}));
        try {
            await controller.processAnalysisFrame({mediaTime: 1}, 1, 1000000);
            await controller.processAnalysisFrame({mediaTime: 2}, 2, 2000000);
            const thirdDispatch = controller.processAnalysisFrame({mediaTime: 3}, 3, 3000000);
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
// loading the real TFJS/WASM runtime, so algorithm changes remain cheap to validate in Jest.
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
    test('creates a padded, bounded detector face crop in source pixels', () => {
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

    test('selects the largest eligible face independently of detector result order', () => {
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
    test('assembly and encoder initialization do not load the detector runtime', async () => {
        const originalImportScripts = global.importScripts;
        global.importScripts = jest.fn();
        try {
            const assembly = new FaceCropAssemblyPipeline();
            await assembly.initialize({configuration: {...resolveFaceCropConfiguration({}), analysisWorkerCount: 1}, identity: {}});
            const encoder = new FaceCropEncodingPipeline();
            expect(encoder).toBeTruthy();
            expect(global.importScripts).not.toHaveBeenCalled();
        } finally { global.importScripts = originalImportScripts; }
    });

    test('uses the default packed RGBA layout without consulting allocationSize', async () => {
        const pipeline = new FaceCropAnalysisPipeline();
        const dispose = jest.fn();
        pipeline.detector = {tf: {tensor3d: jest.fn(() => ({dispose}))},
            model: {estimateFaces: jest.fn(() => Promise.resolve([]))}};
        const frame = {allocationSize: jest.fn(), copyTo: jest.fn((destination, options) => {
            expect(destination.byteLength).toBe(72 * 72 * 4);
            expect(options).toEqual({format: 'RGBA', colorSpace: 'srgb'});
            return Promise.resolve([{offset: 0, stride: 72 * 4}]);
        }), close: jest.fn()};
        await expect(pipeline.processFrame({frame, width: 72, height: 72, timestampUs: 1, wallClockMs: 1, sequence: 0}))
            .resolves.toMatchObject({width: 72, height: 72, rgbx: expect.any(Uint8Array)});
        expect(frame.allocationSize).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('normalizes padded NV12 into rotated RGBA before BlazeFace', async () => {
        const pipeline = new FaceCropAnalysisPipeline();
        const dispose = jest.fn();
        const tensor3d = jest.fn(() => ({dispose}));
        pipeline.detector = {tf: {tensor3d}, model: {estimateFaces: jest.fn(() => Promise.resolve([]))}};
        pipeline.normalization = {mode: 'nv12-bt709-full', nativeWidth: 4, nativeHeight: 2,
            presentedWidth: 2, presentedHeight: 4, rotation: 90};
        const bytes = new Uint8Array(24);
        bytes.set([10, 20, 30, 40], 1);
        bytes.set([50, 60, 70, 80], 7);
        bytes.set([128, 128, 128, 128], 16);
        const frame = {format: 'NV12', codedWidth: 4, codedHeight: 2, colorSpace: {fullRange: true, primaries: 'bt709', transfer: 'bt709', matrix: null},
            allocationSize: jest.fn(() => bytes.length), copyTo: jest.fn(destination => { destination.set(bytes); return Promise.resolve([{offset: 1, stride: 6}, {offset: 16, stride: 6}]); }), close: jest.fn()};
        const result = await pipeline.processFrame({frame, width: 2, height: 4, timestampUs: 1, wallClockMs: 1, sequence: 0});
        expect(result).toMatchObject({width: 2, height: 4});
        expect(Array.from(result.rgbx.filter((_, index) => index % 4 === 0))).toEqual([50, 10, 60, 20, 70, 30, 80, 40]);
        expect(tensor3d).toHaveBeenCalledWith(expect.any(Uint8Array), [4, 2, 3], 'int32');
        expect(frame.copyTo).toHaveBeenCalledWith(expect.any(Uint8Array));
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('analysis warmup and processing always close transferred frames', async () => {
        const pipeline = new FaceCropAnalysisPipeline();
        const dispose = jest.fn();
        const tensor3d = jest.fn(() => ({dispose}));
        const estimateFaces = jest.fn(() => Promise.resolve([{topLeft: [0, 0], bottomRight: [72, 72], probability: [0.9]}]));
        pipeline.detector = {tf: {tensor3d}, model: {estimateFaces}};
        const warmupFrame = {copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        await expect(pipeline.warmup({frame: warmupFrame, width: 72, height: 72})).resolves.toEqual({});
        expect(warmupFrame.close).toHaveBeenCalledTimes(1);
        const frame = {copyTo: jest.fn(() => Promise.resolve()), close: jest.fn()};
        const result = await pipeline.processFrame({frame, width: 72, height: 72, timestampUs: 1000, wallClockMs: 10, sequence: 4});
        expect(result).toMatchObject({sequence: 4, rgbx: expect.any(Uint8Array), detections: [detection(0, 0, 72, 72, 0.9)]});
        expect(tensor3d).toHaveBeenCalledWith(expect.any(Uint8Array), [72, 72, 3], 'int32');
        expect(dispose).toHaveBeenCalledTimes(2);
        expect(frame.close).toHaveBeenCalledTimes(1);
    });

    test('assembly commits 1 then 0 in source order before the encoder builds ordered AVI and events', async () => {
        const assembly = new FaceCropAssemblyPipeline();
        assembly.maxPendingResults = 2;
        assembly.roi = new FaceRoiProvider({smoothingTauMs: 0});
        assembly.segmenter = new FaceCropSegmenter({studyResultId: 'RESULT', studyPage: 'introduction', videoCounter: 1,
            captureId: 'capture', maxFramesPerPart: 2, selectionConfiguration: {policy: 'test'}});
        const input = (sequence, timestampUs, color) => {
            const rgbx = new Uint8Array(72 * 72 * 4);
            for (let offset = 0; offset < rgbx.byteLength; offset += 4) rgbx.set([...color, 255], offset);
            return {sequence, width: 72, height: 72, timestampUs, wallClockMs: timestampUs, detections: [], rgbx,
                timings: {analysisMs: 1}};
        };
        expect((await assembly.processAnalysisResult(input(1, 2000, [40, 50, 60]))).commits).toEqual([]);
        const result = await assembly.processAnalysisResult(input(0, 1000, [10, 20, 30]));
        expect(result.commits.map(commit => commit.sequence)).toEqual([0, 1]);
        const part = result.commits[1].parts[0];
        expect(part.faceEvents.frames.map(frame => frame.presentationTimeUs)).toEqual([1000, 2000]);
        const encoder = new FaceCropEncodingPipeline({encodePart: item => Promise.resolve({...item, gzipBytes: pako.gzip(buildUncompressedAvi(item)).buffer})});
        const artifact = (await encoder.encode(part)).artifact;
        const avi = pako.ungzip(new Uint8Array(artifact.gzipBytes));
        const frameOffsets = [];
        const indexOffset = findChunk(avi, 'idx1');
        for (let offset = 0; offset < indexOffset; offset += 1) {
            if (String.fromCharCode(...avi.subarray(offset, offset + 4)) === '00db') frameOffsets.push(offset + 8);
        }
        expect(frameOffsets.map(offset => Array.from(avi.subarray(offset, offset + 3)))).toEqual([[30, 20, 10], [60, 50, 40]]);
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
        const pipeline = new FaceCropAssemblyPipeline();
        pipeline.maxPendingResults = 1;
        pipeline.roi = new FaceRoiProvider({smoothingTauMs: 0});
        pipeline.segmenter = new FaceCropSegmenter({studyResultId: 'RESULT', studyPage: 'intro', videoCounter: 1,
            captureId: 'capture', maxFramesPerPart: 10, selectionConfiguration: {}});
        const result = (sequence, width) => ({sequence, width, height: 72, timestampUs: sequence, wallClockMs: sequence,
            detections: [], rgbx: new Uint8Array(width * 72 * 4), timings: {}});
        await pipeline.processAnalysisResult(result(0, 72));
        const changed = await pipeline.processAnalysisResult(result(1, 73));
        expect(changed.commits[0].parts[0]).toMatchObject({segmentIndex: 0, partIndex: 0});
        expect((await pipeline.finish()).parts[0]).toMatchObject({segmentIndex: 1, partIndex: 0});
    });
});
