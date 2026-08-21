/* global globalThis */
import {createFaceEventsFilename, createPatchVideoFilename, encodePatchArtifact, FACE_EVENTS_FORMAT_VERSION} from './FaceCropOutput';

// Analysis, assembly, and encoding workers keep CPU-heavy patch production off
// the main thread. The main thread only schedules VideoFrames and hands encoded
// artifacts to FaceCropSink.
export const PATCH_SIZE = 72;
export const BGR24_FRAME_BYTES = PATCH_SIZE * PATCH_SIZE * 3;
export const MAX_FRAMES_PER_PART = 539;
export const FACE_ROI_DESCRIPTOR = {
    coordinateSystem: 'face', transformType: 'dynamic-face-square',
    samplingVersion: 'area-average-v1', descriptorVersion: 2
};
export const FACE_COORDINATE_SYSTEM = 'face';
export const DYNAMIC_FACE_SQUARE = 'dynamic-face-square';
export const AREA_AVERAGE_V1 = 'area-average-v1';
export const FACE_ROI_DESCRIPTOR_VERSION = 2;

const PUBLIC_ASSET_ROOT = process.env.PUBLIC_URL || '';
const MEDIAPIPE_WASM_URL = PUBLIC_ASSET_ROOT + '/mediapipe/tasks-vision-1.0.1/wasm';
const FACE_DETECTOR_MODEL_URL = PUBLIC_ASSET_ROOT + '/mediapipe/models/blaze_face_short_range.tflite';
const MEDIAPIPE_VISION_BUNDLE_URL = PUBLIC_ASSET_ROOT + '/mediapipe/tasks-vision-1.0.1/vision_bundle.js';

let visionTasks;

function timingNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function warmupDetector(detector, frame, timestampUs) {
    try {
        detector.detectForVideo(frame, timestampUs / 1000);
        return {};
    } finally {
        frame.close();
    }
}

function loadVisionTasks() {
    // The vendored bundle is loaded synchronously inside the worker; keeping it
    // here makes the same module usable in both the worker and Jest environments.
    if (visionTasks) return visionTasks;
    if (typeof globalThis.importScripts !== 'function') throw new Error('importScripts is unavailable in the capture worker');
    globalThis.importScripts(MEDIAPIPE_VISION_BUNDLE_URL);
    if (!globalThis.Vision) throw new Error('MediaPipe vision bundle did not initialize');
    visionTasks = globalThis.Vision;
    return visionTasks;
}

function initializationError(stage, error) {
    const wrapped = new Error('MediaPipe ' + stage + ' failed: ' + (error && error.message ? error.message : String(error)));
    wrapped.stack = error && error.stack ? wrapped.message + '\nCaused by: ' + error.stack : wrapped.stack;
    return wrapped;
}

export async function createMediaPipeFaceDetector({minDetectionConfidence = 0.5, minSuppressionThreshold = 0.3, delegate = 'CPU'} = {}) {
    const {FaceDetector, FilesetResolver} = loadVisionTasks();
    let fileset;
    let modelAssetBuffer;
    try {
        fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    } catch (error) {
        throw initializationError('Wasm fileset loading', error);
    }
    try {
        const response = await fetch(FACE_DETECTOR_MODEL_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status + ' for face detector model');
        modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
        throw initializationError('model loading', error);
    }
    try {
        return await FaceDetector.createFromOptions(fileset, {
            baseOptions: {modelAssetBuffer, delegate},
            runningMode: 'VIDEO', minDetectionConfidence, minSuppressionThreshold
        });
    } catch (error) {
        throw initializationError('FaceDetector construction', error);
    }
}

function requireInteger(value, name, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(name + ' must be an integer greater than or equal to ' + minimum);
    }
}

export function validateFaceRoiDescriptor(roi) {
    if (!roi || typeof roi !== 'object' || Array.isArray(roi)) {
        throw new Error('ROI descriptor must be an object');
    }
    if (roi.coordinateSystem !== FACE_COORDINATE_SYSTEM) throw new Error('Unsupported ROI coordinate system: ' + roi.coordinateSystem);
    if (roi.transformType !== DYNAMIC_FACE_SQUARE) throw new Error('Unsupported ROI transform type: ' + roi.transformType);
    if (roi.samplingVersion !== AREA_AVERAGE_V1) throw new Error('Unsupported ROI sampling version: ' + roi.samplingVersion);
    if (roi.descriptorVersion !== FACE_ROI_DESCRIPTOR_VERSION) throw new Error('Unsupported ROI descriptor version: ' + roi.descriptorVersion);
    requireInteger(roi.x, 'ROI x', 0);
    requireInteger(roi.y, 'ROI y', 0);
    requireInteger(roi.size, 'ROI size', PATCH_SIZE);
    return roi;
}

function detectionScore(detection) {
    const category = detection && Array.isArray(detection.categories) ? detection.categories[0] : null;
    return category && Number.isFinite(category.score) ? category.score : null;
}

function eligibleDetections(detections, minimumScore) {
    return (detections || []).map((detection, index) => {
        const box = detection && detection.boundingBox;
        const score = detectionScore(detection);
        return {box, score, index, area: box && box.width * box.height};
    }).filter(({box, score}) => box && Number.isFinite(box.originX) && Number.isFinite(box.originY) &&
        Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0 &&
        Number.isFinite(score) && score >= minimumScore).sort((left, right) =>
        right.area - left.area || right.score - left.score || left.box.originX - right.box.originX ||
        left.box.originY - right.box.originY || left.index - right.index);
}

function detectionSummary(detections, eligibleCount) {
    return {
        rawCount: Array.isArray(detections) ? detections.length : 0,
        eligibleCount,
        scores: (detections || []).map(detectionScore)
    };
}

export class FaceRoiProvider {
    constructor({scale = 1.5, verticalShiftRatio = 0.15, smoothingTauMs = 100, minDetectionConfidence = 0.5} = {}) {
        requireInteger(smoothingTauMs, 'Face ROI time constant', 0);
        if (!Number.isFinite(scale) || scale < 1 || scale > 3 ||
            !Number.isFinite(verticalShiftRatio) || verticalShiftRatio < -1 || verticalShiftRatio > 1 ||
            !Number.isFinite(minDetectionConfidence) || minDetectionConfidence < 0 || minDetectionConfidence > 1) {
            throw new Error('Face ROI configuration is invalid');
        }
        this.configuration = {scale, verticalShiftRatio, smoothingTauMs, minDetectionConfidence};
        this.previous = null;
        this.previousDetectionTimestampMs = null;
        this.hadMiss = false;
    }

    defaultRoi(width, height) {
        const size = Math.min(width, height);
        return validateFaceRoiDescriptor({...FACE_ROI_DESCRIPTOR,
            x: Math.round((width - size) / 2),
            y: Math.round((height - size) / 2),
            size});
    }

    getSelection({width, height, detections, timestampMs}) {
        // Selection is deterministic: largest eligible area wins, then score and
        // positional tie-breakers. A valid previous ROI is held through misses;
        // before the first detection, use the largest centered square.
        requireInteger(width, 'Source width', PATCH_SIZE);
        requireInteger(height, 'Source height', PATCH_SIZE);
        const eligible = eligibleDetections(detections, this.configuration.minDetectionConfidence);
        const detection = detectionSummary(detections, eligible.length);
        if (!eligible.length) {
            this.hadMiss = true;
            if (this.previous && this.previous.x + this.previous.size <= width && this.previous.y + this.previous.size <= height) {
                return {roi: {...this.previous}, state: 'held', candidateCount: 0, selectedScore: null,
                    selectedBoundingBox: null, tieBreakOccurred: false, detection};
            }
            this.previous = this.defaultRoi(width, height);
            this.previousDetectionTimestampMs = null;
            return {roi: {...this.previous}, state: 'default', candidateCount: 0, selectedScore: null,
                selectedBoundingBox: null, tieBreakOccurred: false, detection};
        }

        const selected = eligible[0];
        const {scale, verticalShiftRatio, smoothingTauMs} = this.configuration;
        const elapsed = Math.max(0, timestampMs - this.previousDetectionTimestampMs);
        const smoothing = !this.previous || !Number.isFinite(timestampMs) ||
            !Number.isFinite(this.previousDetectionTimestampMs) || smoothingTauMs === 0 ? 1 : 1 - Math.exp(-elapsed / smoothingTauMs);
        const maximumSize = Math.min(width, height);
        const targetSize = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.ceil(Math.max(selected.box.width, selected.box.height) * scale)));
        const size = Math.max(PATCH_SIZE, Math.min(maximumSize, Math.round(this.previous
            ? this.previous.size + (targetSize - this.previous.size) * smoothing : targetSize)));
        const targetX = Math.max(0, Math.min(width - size, selected.box.originX + selected.box.width / 2 - size / 2));
        const targetY = Math.max(0, Math.min(height - size,
            selected.box.originY + selected.box.height / 2 - size / 2 - size * verticalShiftRatio));
        const interpolate = (previous, target) => this.previous ? previous + (target - previous) * smoothing : target;
        this.previous = validateFaceRoiDescriptor({...FACE_ROI_DESCRIPTOR,
            x: Math.max(0, Math.min(width - size, Math.round(interpolate(this.previous && this.previous.x, targetX)))),
            y: Math.max(0, Math.min(height - size, Math.round(interpolate(this.previous && this.previous.y, targetY)))), size});
        this.previousDetectionTimestampMs = Number.isFinite(timestampMs) ? timestampMs : null;
        const state = this.hadMiss ? 'reacquired' : 'largest';
        this.hadMiss = false;
        return {roi: {...this.previous}, state, candidateCount: eligible.length, selectedScore: selected.score,
            selectedBoundingBox: {...selected.box}, tieBreakOccurred: eligible.length > 1 && eligible[0].area === eligible[1].area, detection};
    }

    getRoi(input) {
        return this.getSelection(input).roi;
    }
}

function buildAxisWeights(sourceSize) {
    // Precompute exact pixel-overlap weights so arbitrary source crops are
    // area-resampled to 72x72 without browser scaling differences.
    return Array.from({length: PATCH_SIZE}, (_, outputIndex) => {
        const start = outputIndex * sourceSize;
        const end = start + sourceSize;
        const weights = [];
        for (let sourceIndex = Math.floor(start / PATCH_SIZE); sourceIndex < Math.ceil(end / PATCH_SIZE); sourceIndex += 1) {
            const weight = Math.min(end, (sourceIndex + 1) * PATCH_SIZE) - Math.max(start, sourceIndex * PATCH_SIZE);
            if (weight > 0) weights.push({sourceIndex, weight});
        }
        return weights;
    });
}

let cachedAxisWeightSize = null;
let cachedAxisWeights = null;

function axisWeights(sourceSize) {
    if (cachedAxisWeightSize !== sourceSize) {
        cachedAxisWeightSize = sourceSize;
        cachedAxisWeights = buildAxisWeights(sourceSize);
    }
    return cachedAxisWeights;
}

export function processFaceCropFrame({rgbx, width, height, roi, output}) {
    if (!(rgbx instanceof Uint8Array) || rgbx.byteLength !== width * height * 4) {
        throw new Error('RGBA source must be a tightly packed Uint8Array');
    }
    validateFaceRoiDescriptor(roi);
    if (roi.x + roi.size > width || roi.y + roi.size > height) throw new Error('ROI extends beyond source dimensions');
    if (output === undefined) output = new Uint8Array(BGR24_FRAME_BYTES);
    if (!(output instanceof Uint8Array) || output.byteLength !== BGR24_FRAME_BYTES) {
        throw new Error('BGR24 output must be a ' + BGR24_FRAME_BYTES + '-byte Uint8Array');
    }
    const weights = axisWeights(roi.size);
    const totalWeight = roi.size * roi.size;
    const halfWeight = Math.floor(totalWeight / 2);
    for (let y = 0; y < PATCH_SIZE; y += 1) {
        for (let x = 0; x < PATCH_SIZE; x += 1) {
            let red = 0, green = 0, blue = 0;
            weights[y].forEach(vertical => weights[x].forEach(horizontal => {
                const offset = ((roi.y + vertical.sourceIndex) * width + roi.x + horizontal.sourceIndex) * 4;
                const weight = vertical.weight * horizontal.weight;
                red += rgbx[offset] * weight; green += rgbx[offset + 1] * weight; blue += rgbx[offset + 2] * weight;
            }));
            const offset = (y * PATCH_SIZE + x) * 3;
            output[offset] = Math.floor((blue + halfWeight) / totalWeight);
            output[offset + 1] = Math.floor((green + halfWeight) / totalWeight);
            output[offset + 2] = Math.floor((red + halfWeight) / totalWeight);
        }
    }
    return output;
}

export class FaceCropProcessor {
    process(input) { return processFaceCropFrame(input); }
}

async function copyPackedRgba(frame, width, height) {
    // Keep extraction full-frame for browser compatibility. Cropped VideoFrame
    // copyTo() is unreliable on some I420-backed camera implementations.
    const options = {format: 'RGBA', colorSpace: 'srgb'};
    const rect = {x: 0, y: 0, width, height};
    const rowBytes = rect.width * 4;
    const allocationSize = typeof frame.allocationSize === 'function'
        ? frame.allocationSize(options) : rowBytes * rect.height;
    if (!Number.isSafeInteger(allocationSize) || allocationSize < rowBytes * rect.height) {
        throw new Error('VideoFrame RGBA allocation is smaller than the requested frame');
    }
    const allocated = new Uint8Array(allocationSize);
    const layouts = await frame.copyTo(allocated, options);
    const plane = Array.isArray(layouts) ? layouts[0] : null;
    const offset = plane && Number.isSafeInteger(plane.offset) ? plane.offset : 0;
    const stride = plane && Number.isSafeInteger(plane.stride) ? plane.stride : rowBytes;
    if (stride < rowBytes || offset < 0 || offset + stride * (rect.height - 1) + rowBytes > allocated.byteLength) {
        throw new Error('VideoFrame RGBA layout cannot represent the requested frame');
    }
    if (offset === 0 && stride === rowBytes && allocated.byteLength === rowBytes * rect.height) return allocated;
    // VideoFrame.copyTo() may return padded rows. Normalize the layout before
    // pixel indexing assumes tightly packed width * 4 RGBA rows.
    const packed = new Uint8Array(rowBytes * rect.height);
    for (let row = 0; row < rect.height; row += 1) {
        packed.set(allocated.subarray(offset + row * stride, offset + row * stride + rowBytes), row * rowBytes);
    }
    return packed;
}

function copyEvent(provenance, frameIndex, timestampUs, wallClockMs, roi, sourceWidth, sourceHeight) {
    return {frameIndex, mediaTimeUs: timestampUs, wallClockMs, state: provenance.state,
        source: {width: sourceWidth, height: sourceHeight},
        detection: {...provenance.detection},
        selection: {score: provenance.selectedScore,
            boundingBox: provenance.selectedBoundingBox ? {...provenance.selectedBoundingBox} : null,
            tieBreakOccurred: Boolean(provenance.tieBreakOccurred)},
        roi: {...roi}};
}

export class FaceCropSegmenter {
    constructor({studyResultId, studyPage, videoCounter, captureId, maxFramesPerPart = MAX_FRAMES_PER_PART, selectionConfiguration = {}}) {
        if (!Number.isSafeInteger(maxFramesPerPart) || maxFramesPerPart < 1 || maxFramesPerPart > MAX_FRAMES_PER_PART) {
            throw new Error('Max frames per part must be between 1 and ' + MAX_FRAMES_PER_PART);
        }
        this.identity = {studyResultId, studyPage, videoCounter, captureId};
        this.maxFrames = maxFramesPerPart;
        this.selectionConfiguration = {...selectionConfiguration};
        this.sourceDimensions = null;
        this.segmentIndex = -1;
        this.partIndex = 0;
        this.part = null;
    }

    appendFrame({bgr24, writeBgr24, sourceWidth, sourceHeight, roi, provenance, timestampUs, wallClockMs}) {
        // A source resize starts a new segment because one part must have one
        // source geometry. Parts are sealed by frame count or geometry change.
        validateFaceRoiDescriptor(roi);
        const dimensionsChanged = !this.sourceDimensions || this.sourceDimensions.width !== sourceWidth || this.sourceDimensions.height !== sourceHeight;
        const sealed = dimensionsChanged ? this.seal() : null;
        if (dimensionsChanged) {
            this.sourceDimensions = {width: sourceWidth, height: sourceHeight};
            this.segmentIndex += 1;
            this.partIndex = 0;
        }
        if (!this.part) this.part = {bytes: new Uint8Array(this.maxFrames * BGR24_FRAME_BYTES), frameCount: 0, events: []};
        const output = this.part.bytes.subarray(this.part.frameCount * BGR24_FRAME_BYTES,
            (this.part.frameCount + 1) * BGR24_FRAME_BYTES);
        if (writeBgr24 !== undefined) {
            if (typeof writeBgr24 !== 'function') throw new Error('BGR24 writer is invalid');
            writeBgr24(output);
        } else {
            if (!(bgr24 instanceof Uint8Array) || bgr24.byteLength !== BGR24_FRAME_BYTES) throw new Error('BGR24 frame is invalid');
            output.set(bgr24);
        }
        this.part.events.push(copyEvent(provenance, this.part.frameCount, timestampUs, wallClockMs, roi, sourceWidth, sourceHeight));
        this.part.frameCount += 1;
        const full = this.part.frameCount === this.maxFrames ? this.seal() : null;
        return [sealed, full].filter(Boolean);
    }

    finish() {
        const part = this.seal();
        return part ? [part] : [];
    }

    seal() {
        if (!this.part) return null;
        const {frameCount, events} = this.part;
        const identity = {...this.identity, segmentIndex: this.segmentIndex, partIndex: this.partIndex};
        const filename = createPatchVideoFilename(identity);
        const bytes = this.part.bytes.subarray(0, frameCount * BGR24_FRAME_BYTES);
        this.part = null;
        this.partIndex += 1;
        return {captureId: identity.captureId, segmentIndex: identity.segmentIndex, partIndex: identity.partIndex, filename,
            faceEventsFilename: createFaceEventsFilename(identity), frameCount, byteLength: bytes.byteLength, bytes,
            faceEvents: {formatVersion: FACE_EVENTS_FORMAT_VERSION, captureId: identity.captureId, aviFilename: filename,
                segmentIndex: identity.segmentIndex, partIndex: identity.partIndex, frameCount,
                selectionConfiguration: {...this.selectionConfiguration}, frames: events}};
    }
}

export class FaceCropAnalysisPipeline {
    async initialize({configuration}) {
        this.detector = await createMediaPipeFaceDetector({minDetectionConfidence: configuration.faceDetectionMinConfidence,
            minSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold, delegate: configuration.faceDetectionDelegate});
    }

    async processFrame({frame, width, height, timestampUs, wallClockMs, sequence}) {
        const startedAt = timingNow();
        try {
            const detectionStartedAt = timingNow();
            const detected = this.detector.detectForVideo(frame, timestampUs / 1000);
            const detectionMs = timingNow() - detectionStartedAt;
            const copyStartedAt = timingNow();
            const rgbx = await copyPackedRgba(frame, width, height);
            const rgbaCopyMs = timingNow() - copyStartedAt;
            return {sequence, width, height, timestampUs, wallClockMs, detections: detected.detections, rgbx,
                timings: {detectionMs, rgbaCopyMs, analysisMs: timingNow() - startedAt}};
        } finally {
            frame.close();
        }
    }

    warmup({frame, timestampUs}) {
        return warmupDetector(this.detector, frame, timestampUs);
    }

    close() { if (this.detector) this.detector.close(); this.detector = null; }
}

export class FaceCropAssemblyPipeline {
    constructor() {
        this.pending = new Map();
        this.nextSequence = 0;
    }

    async initialize({configuration, identity}) {
        this.maxPendingResults = configuration.analysisWorkerCount;
        this.roi = new FaceRoiProvider({smoothingTauMs: configuration.faceRoiSmoothingTauMs, scale: configuration.faceRoiScale,
            verticalShiftRatio: configuration.faceRoiVerticalShiftRatio, minDetectionConfidence: configuration.faceDetectionMinConfidence});
        this.segmenter = new FaceCropSegmenter({...identity, selectionConfiguration: {
            minDetectionConfidence: configuration.faceDetectionMinConfidence,
            minSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold,
            policy: 'largest-eligible-bounding-box-v1'}});
    }

    async processAnalysisResult(result) {
        if (!result || !Number.isSafeInteger(result.sequence) || !(result.rgbx instanceof Uint8Array)) {
            throw new Error('Analysis result is invalid');
        }
        if (this.pending.has(result.sequence) || this.pending.size >= this.maxPendingResults) {
            throw new Error('Assembly result buffer is invalid');
        }
        this.pending.set(result.sequence, result);
        const commits = [];
        while (this.pending.has(this.nextSequence)) {
            const current = this.pending.get(this.nextSequence);
            this.pending.delete(this.nextSequence++);
            const startedAt = timingNow();
            const roiStartedAt = timingNow();
            const selection = this.roi.getSelection({width: current.width, height: current.height,
                detections: current.detections, timestampMs: current.timestampUs / 1000});
            const roiSelectionMs = timingNow() - roiStartedAt;
            let parts = [];
            let cropAndSegmentMs = 0;
            if (selection.roi) {
                const cropStartedAt = timingNow();
                parts = this.segmenter.appendFrame({
                    writeBgr24: output => processFaceCropFrame({width: current.width, height: current.height,
                        rgbx: current.rgbx, roi: selection.roi, output}),
                    sourceWidth: current.width, sourceHeight: current.height, roi: selection.roi, provenance: selection,
                    timestampUs: current.timestampUs, wallClockMs: current.wallClockMs});
                cropAndSegmentMs = timingNow() - cropStartedAt;
            }
            commits.push({sequence: current.sequence, accepted: Boolean(selection.roi), detectionState: selection.state,
                parts, timings: {...current.timings, roiSelectionMs, cropAndSegmentMs,
                    assemblyMs: timingNow() - startedAt}});
        }
        return {commits, bufferedResultCount: this.pending.size};
    }

    async finish() {
        if (this.pending.size) throw new Error('Face-crop assembly result sequence gap');
        const startedAt = timingNow();
        return {commits: [], parts: this.segmenter.finish(), bufferedResultCount: 0, timings: {assemblyMs: timingNow() - startedAt}};
    }

    close() {
        this.pending.clear();
        this.roi = null;
        this.segmenter = null;
    }
}

export class FaceCropEncodingPipeline {
    constructor({encodePart = encodePatchArtifact} = {}) {
        this.encodePart = encodePart;
    }

    async initialize() {
        if (typeof Blob !== 'function' || typeof CompressionStream !== 'function' || typeof Response !== 'function') {
            throw new Error('Worker-side Blob, Response, and CompressionStream APIs are required');
        }
    }

    async encode(part) {
        const startedAt = timingNow();
        const artifact = await this.encodePart(part);
        return {artifact, timings: {encodingMs: timingNow() - startedAt}};
    }

    close() {}
}

/* eslint-disable no-restricted-globals */
if (typeof self !== 'undefined' && typeof window === 'undefined') {
    const analysisPipeline = new FaceCropAnalysisPipeline();
    const assemblyPipeline = new FaceCropAssemblyPipeline();
    const encodingPipeline = new FaceCropEncodingPipeline();
    let activePipeline = null;
    const handlers = {
        initialize: payload => {
            activePipeline = payload.role === 'analysis' ? analysisPipeline : payload.role === 'assembly' ? assemblyPipeline
                : payload.role === 'encoder' ? encodingPipeline : null;
            if (!activePipeline) throw new Error('Face-crop worker role is invalid');
            return activePipeline.initialize(payload).then(() => ({}));
        },
        processFrame: payload => {
            if (activePipeline !== analysisPipeline) throw new Error('Analysis worker is not initialized');
            return analysisPipeline.processFrame(payload);
        },
        processAnalysisResult: payload => {
            if (activePipeline !== assemblyPipeline) throw new Error('Assembly worker is not initialized');
            return assemblyPipeline.processAnalysisResult(payload);
        },
        encodePart: payload => {
            if (activePipeline !== encodingPipeline) throw new Error('Encoding worker is not initialized');
            return encodingPipeline.encode(payload);
        },
        warmup: payload => {
            if (activePipeline !== analysisPipeline) throw new Error('Analysis worker is not initialized');
            return analysisPipeline.warmup(payload);
        },
        finish: () => {
            if (activePipeline !== assemblyPipeline) throw new Error('Assembly worker is not initialized');
            return assemblyPipeline.finish();
        },
        close: () => { analysisPipeline.close(); assemblyPipeline.close(); encodingPipeline.close(); return {}; }
    };
    self.onmessage = async event => {
        const {type, payload = {}} = event.data || {};
        try {
            if (!handlers[type]) throw new Error('Unknown face-crop worker request: ' + type);
            const result = await handlers[type](payload);
            const transfer = [];
            if (result.rgbx) transfer.push(result.rgbx.buffer);
            if (result.artifact) transfer.push(result.artifact.gzipBytes);
            (result.parts || []).forEach(part => transfer.push(part.bytes.buffer));
            (result.commits || []).forEach(commit => (commit.parts || []).forEach(part => transfer.push(part.bytes.buffer)));
            self.postMessage({result}, transfer);
        } catch (error) {
            console.error('[face-crop] Worker request failed', {type, error});
            self.postMessage({error: {name: error && error.name ? error.name : 'Error',
                message: error && error.message ? error.message : 'Face-crop worker failed',
                stack: error && error.stack ? error.stack : null}});
        }
    };
}
