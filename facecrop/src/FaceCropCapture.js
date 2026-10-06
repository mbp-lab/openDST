import {UPLOAD_STATUS} from './uploadState';
import {PATCH_VIDEO_FORMAT_VERSION, FaceCropSink, createCaptureManifestFilename} from './FaceCropOutput';
import {reconcileAccounting} from './Accounting';
import {buildCaptureManifest} from './Metadata';
import {ORIENTATION_REFERENCE_SIZE, rotatedDimensions, selectQuarterTurnByLuminance} from './FrameNormalization';

// Capture consumes an application-owned video element. The application decides how runtime
// failures affect the study; the library never controls camera tracks or navigation.
export const FACE_CROP_STATUS = {
    DISABLED: 'disabled',
    UNSUPPORTED: 'unsupported',
    CAPTURING: 'capturing',
    COMPLETE: 'complete',
    INCOMPLETE: 'incomplete'
};
export const FACE_DETECTION_WARMUP_FRAMES = 3;
const MAX_PENDING_ENCODE_PARTS = 1;

const MAX_SOURCE_PIXELS = 1920 * 1080;

function dimensions(video) {
    return {
        width: video && Number.isSafeInteger(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : null,
        height: video && Number.isSafeInteger(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : null,
        readyState: video && Number.isInteger(video.readyState) ? video.readyState : null
    };
}
function supportedDimensions({width, height}) {
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 72 && height >= 72 && width * height <= MAX_SOURCE_PIXELS;
}

function errorMetadata(error) {
    return error ? {name: error.name || 'Error', message: error.message || String(error)} : null;
}

function isTransientVideoFrameError(error) {
    return Boolean(error && (error.name === 'InvalidStateError' || /invalid source state/i.test(error.message || '')));
}

function videoStateMetadata(video) {
    const stream = video && video.srcObject;
    const track = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] : null;
    return {...dimensions(video), paused: video && typeof video.paused === 'boolean' ? video.paused : null,
        ended: video && typeof video.ended === 'boolean' ? video.ended : null,
        seeking: video && typeof video.seeking === 'boolean' ? video.seeking : null,
        currentTime: video && Number.isFinite(video.currentTime) ? video.currentTime : null,
        networkState: video && Number.isInteger(video.networkState) ? video.networkState : null,
        streamActive: stream && typeof stream.active === 'boolean' ? stream.active : null,
        track: track ? {readyState: track.readyState || null,
            enabled: typeof track.enabled === 'boolean' ? track.enabled : null,
            muted: typeof track.muted === 'boolean' ? track.muted : null} : null};
}

function frameCallbackMetadata(now, metadata) {
    return {now: Number.isFinite(now) ? now : null,
        presentationTime: metadata && Number.isFinite(metadata.presentationTime) ? metadata.presentationTime : null,
        expectedDisplayTime: metadata && Number.isFinite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : null,
        mediaTime: metadata && Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : null,
        presentedFrames: metadata && Number.isSafeInteger(metadata.presentedFrames) ? metadata.presentedFrames : null,
        width: metadata && Number.isFinite(metadata.width) ? metadata.width : null,
        height: metadata && Number.isFinite(metadata.height) ? metadata.height : null};
}

const FRAME_TIMING_STAGES = ['analysisMs', 'assemblyMs', 'detectionMs', 'roiSelectionMs', 'rgbaCopyMs', 'cropAndSegmentMs'];
const ENCODING_TIMING_STAGES = ['encodingMs'];

function createTimingMetrics(stages) {
    return stages.reduce((metrics, stage) => {
        metrics[stage] = {count: 0, meanMs: null, minMs: null, maxMs: null};
        return metrics;
    }, {});
}

function addTiming(metrics, stage, durationMs) {
    if (!metrics[stage] || !Number.isFinite(durationMs) || durationMs < 0) return;
    const current = metrics[stage];
    current.count += 1;
    current.meanMs = current.meanMs === null ? durationMs : current.meanMs + (durationMs - current.meanMs) / current.count;
    current.minMs = current.minMs === null ? durationMs : Math.min(current.minMs, durationMs);
    current.maxMs = current.maxMs === null ? durationMs : Math.max(current.maxMs, durationMs);
}

function rectangleMetadata(rectangle) {
    if (!rectangle) return null;
    return {x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height};
}

function colorSpaceMetadata(colorSpace) {
    if (!colorSpace) return null;
    return {primaries: colorSpace.primaries, transfer: colorSpace.transfer, matrix: colorSpace.matrix,
        fullRange: colorSpace.fullRange};
}

function renderedReferenceLuminance(video) {
    const canvas = document.createElement('canvas');
    canvas.width = ORIENTATION_REFERENCE_SIZE;
    canvas.height = ORIENTATION_REFERENCE_SIZE;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('2D canvas is unavailable for orientation preflight');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = new Uint8Array(canvas.width * canvas.height);
    for (let source = 0, destination = 0; source < rgba.length; source += 4) {
        luminance[destination++] = Math.round(0.2126 * rgba[source] + 0.7152 * rgba[source + 1] + 0.0722 * rgba[source + 2]);
    }
    return luminance;
}

function nv12ColorSpace(colorSpace) {
    const metadata = colorSpaceMetadata(colorSpace);
    if (!metadata || metadata.fullRange !== true || metadata.primaries !== 'bt709' || metadata.transfer !== 'bt709' ||
        (metadata.matrix !== null && metadata.matrix !== 'bt709')) {
        throw new Error('Only full-range BT.709 NV12 camera frames are supported');
    }
    return metadata;
}

async function normalizationPreflight(frame, video, source) {
    const format = frame.format || null;
    const visibleRect = rectangleMetadata(frame.visibleRect);
    const nativeWidth = visibleRect ? visibleRect.width : frame.codedWidth || frame.displayWidth;
    const nativeHeight = visibleRect ? visibleRect.height : frame.codedHeight || frame.displayHeight;
    if (format === 'NV12') {
        if (frame.flip) throw new Error('Flipped NV12 VideoFrames are unsupported');
        const colorSpace = nv12ColorSpace(frame.colorSpace);
        const nativeSize = frame.allocationSize();
        const bytes = new Uint8Array(nativeSize);
        const layouts = await frame.copyTo(bytes);
        let rotation = frame.rotation || 0;
        let calibration = {method: 'frame-metadata-v1', clockwiseDistance: null, counterclockwiseDistance: null};
        if (rotation === 0 && nativeWidth === source.height && nativeHeight === source.width && source.width !== source.height) {
            const selected = selectQuarterTurnByLuminance({bytes, width: nativeWidth, height: nativeHeight, layouts,
                reference: renderedReferenceLuminance(video)});
            rotation = selected.rotation;
            calibration = {method: 'presented-luminance-distance-v1', clockwiseDistance: selected.clockwiseDistance,
                counterclockwiseDistance: selected.counterclockwiseDistance};
        }
        const output = rotatedDimensions(nativeWidth, nativeHeight, rotation);
        if (output.width !== source.width || output.height !== source.height) {
            throw new Error('Native VideoFrame geometry cannot be normalized to the presented video dimensions');
        }
        return {mode: 'nv12-bt709-full', nativeFormat: format, nativeWidth, nativeHeight,
            presentedWidth: source.width, presentedHeight: source.height, rotation, flip: Boolean(frame.flip), colorSpace,
            layouts: layouts.map(layout => ({offset: layout.offset, stride: layout.stride})), nativeAllocationSize: nativeSize,
            ...calibration};
    }
    const options = {format: 'RGBA', colorSpace: 'srgb'};
    const packedSize = frame.displayWidth * frame.displayHeight * 4;
    const allocationSize = typeof frame.allocationSize === 'function' ? frame.allocationSize(options) : packedSize;
    if (allocationSize !== packedSize) throw new Error('VideoFrame RGBA conversion is unavailable for format ' + (format || 'unknown'));
    const layouts = await frame.copyTo(new Uint8Array(packedSize), options);
    if (Array.isArray(layouts) && layouts.length && (layouts.length !== 1 || layouts[0].offset !== 0 || layouts[0].stride !== frame.displayWidth * 4)) {
        throw new Error('VideoFrame did not return packed RGBA');
    }
    if (frame.displayWidth !== source.width || frame.displayHeight !== source.height) {
        throw new Error('RGBA VideoFrame dimensions do not match the presented video');
    }
    return {mode: 'rgba-copy', nativeFormat: format, nativeWidth: frame.displayWidth, nativeHeight: frame.displayHeight,
        presentedWidth: source.width, presentedHeight: source.height, rotation: 0, flip: false,
        colorSpace: colorSpaceMetadata(frame.colorSpace), layouts: [{offset: 0, stride: frame.displayWidth * 4}],
        nativeAllocationSize: allocationSize, method: 'native-presentation-v1', clockwiseDistance: null, counterclockwiseDistance: null};
}

export async function probeFaceCropCapability(video) {
    const source = dimensions(video);
    const checks = {};
    const failed = (reason, stage, error) => ({supported: false,
        capability: {status: 'failed', checks, failedStage: stage, error: errorMetadata(error)}, source, reason, error});
    if (!video || typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') {
        checks.requestVideoFrameCallback = {status: 'failed'};
        checks.cancelVideoFrameCallback = {status: 'failed'};
        return failed('requestVideoFrameCallback is unavailable', 'requestVideoFrameCallback');
    }
    checks.requestVideoFrameCallback = {status: 'passed'};
    checks.cancelVideoFrameCallback = {status: 'passed'};
    if (typeof window.VideoFrame !== 'function') return failed('VideoFrame is unavailable', 'videoFrame');
    checks.videoFrame = {status: 'available'};
    if (typeof window.CompressionStream !== 'function') return failed('Native CompressionStream is unavailable', 'compressionStream');
    checks.compressionStream = {status: 'passed'};
    let frame;
    try {
        frame = new window.VideoFrame(video);
        checks.videoFrame.construct = {status: 'passed', format: frame.format || null,
            codedWidth: frame.codedWidth || null, codedHeight: frame.codedHeight || null,
            displayWidth: frame.displayWidth, displayHeight: frame.displayHeight,
            visibleRect: rectangleMetadata(frame.visibleRect), rotation: frame.rotation || 0, flip: Boolean(frame.flip),
            colorSpace: colorSpaceMetadata(frame.colorSpace)};
        const frameNormalization = await normalizationPreflight(frame, video, source);
        checks.videoFrame.copyTo = {status: 'passed', returnedLayouts: frameNormalization.layouts};
        return {supported: true, capability: {status: 'passed', checks}, source, frameNormalization};
    } catch (error) {
        if (!checks.videoFrame.construct) checks.videoFrame.construct = {status: 'failed'};
        else checks.videoFrame.copyTo = {status: 'failed'};
        return failed(error.message || 'VideoFrame normalization preflight failed',
            checks.videoFrame.construct.status === 'failed' ? 'videoFrame.construct' : 'videoFrame.copyTo', error);
    } finally {
        if (frame) frame.close();
    }
}

export class PipelineWorker {
    constructor(assetBaseUrl, diagnostics = false) {
        this.worker = new Worker(new URL('facecrop.worker.js', assetBaseUrl).href);
        this.diagnostics = diagnostics;
        this.pending = null;
        this.queue = [];
        this.closed = false;
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = event => this.fail(new Error(event.message || 'Face-crop worker crashed'));
        this.worker.onmessageerror = () => this.fail(new Error('Face-crop worker message could not be decoded'));
    }

    receive(message) {
        if (message && message.diagnostic) {
            if (this.diagnostics) console.info('[face-crop worker]', message.diagnostic);
            return;
        }

        if (!this.pending) return;

        const pending = this.pending;
        this.pending = null;

        if (message && message.error) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            if (message.error.stack) error.stack = message.error.stack;
            pending.reject(error);
        } else {
            pending.resolve(message && message.result);
        }

        this.pump();
    }

    releaseFrame(request) {
        // Until postMessage succeeds, this request still owns the VideoFrame.
        const frame = request.payload && request.payload.frame;
        if (frame && !request.transferred) {
            try { frame.close(); } catch (_) {}
        }
    }

    fail(error) {
        if (this.diagnostics) console.error('[face-crop] Worker failure', error);
        this.closed = true;
        this.worker.terminate();
        if (this.pending) { this.releaseFrame(this.pending); this.pending.reject(error); }
        this.pending = null;
        this.queue.splice(0).forEach(request => { this.releaseFrame(request); request.reject(error); });
    }

    request(type, payload = {}, transfer = []) {
        if (this.closed) {
            this.releaseFrame({payload});
            return Promise.reject(new Error('Face-crop worker is closed'));
        }
        return new Promise((resolve, reject) => {
            this.queue.push({type, payload, transfer, resolve, reject});
            this.pump();
        });
    }

    pump() {
        if (this.pending || this.closed || !this.queue.length) return;
        const pending = this.queue.shift();
        this.pending = pending;
        try {
            this.worker.postMessage({type: pending.type, payload: pending.payload}, pending.transfer);
            pending.transferred = true;
        } catch (error) {
            this.pending = null;
            this.releaseFrame(pending);
            pending.reject(error);
            this.pump();
        }
    }

    initialize(payload) { return this.request('initialize', payload); }
    processFrame(payload) { return this.request('processFrame', payload, [payload.frame]); }
    processAnalysisResult(payload) { return this.request('processAnalysisResult', payload, [payload.rgbx.buffer]); }
    encodePart(payload) { return this.request('encodePart', payload, [payload.bytes.buffer]); }
    warmup(payload) { return this.request('warmup', payload, [payload.frame]); }
    finish() { return this.request('finish'); }
    terminate() { this.fail(new Error('Capture aborted')); }

    async close() {
        if (this.closed) return;
        try {
            await this.request('close');
        } finally {
            this.closed = true;
            this.worker.terminate();
        }
    }
}

export class FaceCropCaptureController {
    constructor({
        video,
        studyResultId,
        studyPage,
        videoCounter,
        captureId: providedCaptureId,
        configuration,
        uploadTracker,
        uploadResultFile,
        onStatus,
        assetBaseUrl, filenamePrefix, context = {}, onArtifact,
        createPipelineWorker = () => new PipelineWorker(assetBaseUrl, configuration.diagnostics)
    }) {
        Object.assign(this, {video, studyResultId, studyPage, videoCounter, configuration, assetBaseUrl, filenamePrefix, context});
        this.uploadTracker = uploadTracker || {registerUpload() {}, settleUpload() {}};
        this.onStatus = onStatus || (() => {});
        this.createPipelineWorker = createPipelineWorker;
        this.sink = new FaceCropSink({uploadResultFile, uploadTracker: this.uploadTracker, onArtifact, maxAttempts: configuration.maxAttempts, retryDelayMs: configuration.retryDelayMs});
        this.uploadResultFile = uploadResultFile;
        this.aborted = false;
        this.started = false;
        this.onArtifact = onArtifact || (() => {});
        this.abortPromise = null;
        this.accounting = {submittedFrames: 0, processedFrames: 0, sealedFrames: 0, encodedFrames: 0, persistedFrames: 0, failedPersistenceFrames: 0, failedProcessingFrames: 0, failedEncodingFrames: 0, discardedFrames: 0, callbackGaps: 0, analysisQueueWaitMs: 0, encodingQueueWaitMs: 0};
        this.state = 'idle';
        this.status = FACE_CROP_STATUS.DISABLED;
        this.startPromise = null;
        this.preparePromise = null;
        this.stopPromise = null;
        this.frameWait = null;
        this.captureLoop = null;
        this.analysisWorkers = [];
        this.assemblyWorker = null;
        this.encoderWorker = null;
        this.inFlight = new Map();
        this.encodingJobs = new Map();
        this.assemblyBufferedResults = 0;
        this.nextSequence = 0;
        this.nextWorker = 0;
        this.incompleteReason = null;
        this.captureId = providedCaptureId || createCaptureId(studyPage, videoCounter);
        this.acceptedFrames = 0;
        this.skippedFrames = 0;
        this.lastPresentedFrame = null;
        this.lastPresentationTimeUs = null;
        this.faceDetections = 0;
        this.faceDetectionMisses = 0;
        this.frameTimings = createTimingMetrics(FRAME_TIMING_STAGES);
        this.encodingTimings = createTimingMetrics(ENCODING_TIMING_STAGES);
        this.detectorWarmup = {requested: FACE_DETECTION_WARMUP_FRAMES, completed: 0, totalMs: 0, meanMs: null};
        this.capability = {status: 'not-run', checks: {}};
        this.source = null;
        this.frameNormalization = null;
        this.manifest = null;
        this.frameCallbacks = 0;
        this.nextProgressLogFrame = 120;
    }

    diagnostic(event, details = {}) {
        if (this.configuration.diagnostics) console.info('[face-crop] ' + event, {captureId: this.captureId, studyPage: this.studyPage,
            videoCounter: this.videoCounter, ...details});
    }

    start() {
        if (this.aborted || this.state === 'terminal' || this.state === 'stopping') return Promise.resolve(this.status);
        this.started = true;
        if (!this.startPromise) this.startPromise = this.startInternal();
        return this.startPromise;
    }

    prepare() {
        if (this.aborted || this.state === 'terminal' || this.state === 'stopping') return Promise.resolve(this.status);
        if (!this.preparePromise) this.preparePromise = this.prepareInternal();
        return this.preparePromise;
    }

    waitForPresentedFrame() {
        return new Promise(resolve => {
            const callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
                if (!this.frameWait || this.frameWait.callbackId !== callbackId) return;
                this.frameWait = null;
                resolve({now, metadata});
            });
            this.frameWait = {callbackId, resolve: () => resolve(null)};
        });
    }

    waitForVideoReady() { return this.waitForPresentedFrame(); }

    async prepareInternal() {
        if (this.state === 'prepared' || this.state === 'capturing') return this.status;
        this.state = 'starting';
        if (!this.video || typeof this.video.requestVideoFrameCallback !== 'function' || typeof this.video.cancelVideoFrameCallback !== 'function') {
            return this.terminate(FACE_CROP_STATUS.UNSUPPORTED, 'requestVideoFrameCallback is unavailable');
        }
        this.diagnostic('prepare-started', {analysisWorkerCount: this.configuration.analysisWorkerCount});
        let capability;
        const attempts = [];
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const presented = await this.waitForPresentedFrame();
            if (!presented || (this.state === 'stopping' || this.aborted)) return this.status;
            const diagnostic = {attempt, video: videoStateMetadata(this.video),
                callback: frameCallbackMetadata(presented.now, presented.metadata)};
            capability = await probeFaceCropCapability(this.video);
            diagnostic.error = capability.capability.error || null;
            attempts.push(diagnostic);
            this.diagnostic('probe-attempt', diagnostic);
            if (capability.supported || !isTransientVideoFrameError(capability.error) || attempt === 2) break;
        }
        capability.capability.probeAttempts = attempts;
        this.capability = capability.capability;
        this.source = capability.source;
        this.frameNormalization = capability.frameNormalization || null;
        const frameCheck = this.capability.checks && this.capability.checks.videoFrame;
        const construct = frameCheck && frameCheck.construct;
        const copy = frameCheck && frameCheck.copyTo;
        if (construct && construct.status === 'passed') {
            this.diagnostic('frame-layout', {format: construct.format, codedWidth: construct.codedWidth,
                codedHeight: construct.codedHeight, displayWidth: construct.displayWidth, displayHeight: construct.displayHeight,
                visibleRect: JSON.stringify(construct.visibleRect), rotation: construct.rotation, flip: construct.flip,
                colorSpace: JSON.stringify(construct.colorSpace), normalizationMode: this.frameNormalization && this.frameNormalization.mode,
                selectedRotation: this.frameNormalization && this.frameNormalization.rotation,
                clockwiseDistance: this.frameNormalization && this.frameNormalization.clockwiseDistance,
                counterclockwiseDistance: this.frameNormalization && this.frameNormalization.counterclockwiseDistance,
                returnedLayouts: JSON.stringify(copy && copy.returnedLayouts)});
        }
        if ((this.state === 'stopping' || this.aborted)) return this.status;
        if (!capability.supported) {
            return this.terminate(FACE_CROP_STATUS.UNSUPPORTED, capability.reason);
        }
        const source = dimensions(this.video);
        this.source = source;
        if (!supportedDimensions(source)) {
            this.capability = {...this.capability, status: 'failed', failedStage: 'sourceDimensions', checks: {
                ...this.capability.checks,
                sourceDimensions: {status: 'failed', width: source.width, height: source.height, maxPixels: MAX_SOURCE_PIXELS}
            }};
            return this.terminate(FACE_CROP_STATUS.INCOMPLETE, 'Source dimensions are outside supported bounds');
        }
        this.capability = {...this.capability, checks: {
            ...this.capability.checks,
            sourceDimensions: {status: 'passed', width: source.width, height: source.height, maxPixels: MAX_SOURCE_PIXELS}
        }};
        try {
            const config = this.configuration;
            const workerConfiguration = {
                faceRoiSmoothingTauMs: config.faceRoiSmoothingTauMs,
                faceRoiScale: config.faceRoiScale,
                faceRoiVerticalShiftRatio: config.faceRoiVerticalShiftRatio,
                faceDetectionMinConfidence: config.faceDetectionMinConfidence,
                analysisWorkerCount: config.analysisWorkerCount,
                assetBaseUrl: this.assetBaseUrl, diagnostics: Boolean(config.diagnostics),
                frameNormalization: this.frameNormalization
            };
            const identity = {studyResultId: this.studyResultId, studyPage: this.studyPage,
                videoCounter: this.videoCounter, captureId: this.captureId, filenamePrefix: this.filenamePrefix, context: this.context};
            this.analysisWorkers = Array.from({length: config.analysisWorkerCount}, () => this.createPipelineWorker());
            this.assemblyWorker = this.createPipelineWorker();
            this.encoderWorker = this.createPipelineWorker();
            await Promise.all(this.analysisWorkers.map(worker => worker.initialize({role: 'analysis', configuration: workerConfiguration})));
            await Promise.all([
                this.assemblyWorker.initialize({role: 'assembly', configuration: workerConfiguration, identity}),
                this.encoderWorker.initialize({role: 'encoder', configuration: workerConfiguration})
            ]);
        } catch (error) {
            await this.closeWorker();
            return this.terminate(FACE_CROP_STATUS.UNSUPPORTED, error.message || 'BlazeFace detector initialization failed');
        }
        if ((this.state === 'stopping' || this.aborted)) {
            await this.closeWorker();
            return this.status;
        }
        const warmupStartedAt = performance.now();
        try {
            for (let index = 0; index < this.detectorWarmup.requested; index += 1) {
                const timestampUs = index * 1000 + Math.round((performance.now() - warmupStartedAt) * 1000);
                await Promise.all(this.analysisWorkers.map(worker => {
                    const warmupFrame = new window.VideoFrame(this.video, {timestamp: timestampUs});
                    return worker.warmup({frame: warmupFrame, width: source.width, height: source.height, timestampUs});
                }));
                this.detectorWarmup.completed += 1;
            }
        } catch (error) {
            await this.closeWorker();
            return this.terminate(this.aborted ? 'aborted' : FACE_CROP_STATUS.UNSUPPORTED, error.message);
        } finally {
            this.detectorWarmup.totalMs = performance.now() - warmupStartedAt;
            this.detectorWarmup.meanMs = this.detectorWarmup.completed
                ? this.detectorWarmup.totalMs / this.detectorWarmup.completed : null;
        }
        if (this.aborted || this.state === 'stopping') { await this.closeWorker(); return this.status; }
        this.state = 'prepared';
        this.diagnostic('prepared', {source: this.source, detectorWarmup: this.detectorWarmup});
        return this.status;
    }

    async startInternal() {
        const status = await this.prepare();
        if ((this.state === 'stopping' || this.aborted) || this.state === 'terminal' || status === FACE_CROP_STATUS.UNSUPPORTED) return status;
        this.state = 'capturing';
        this.setStatus(FACE_CROP_STATUS.CAPTURING);
        this.diagnostic('capture-started');
        this.captureLoop = this.captureFrames();
        return this.status;
    }

    stop() {
        if (this.aborted) return this.abortPromise || Promise.resolve(this.status);
        if (!this.stopPromise) this.stopPromise = this.stopInternal();
        return this.stopPromise;
    }

    async stopInternal() {
        // Cancel the browser callback first, then drain the capture loop, then
        // flush the worker and sink. This prevents frames arriving during teardown.
        if (this.state !== 'terminal') this.state = 'stopping';
        this.diagnostic('stop-requested', {frameCallbacks: this.frameCallbacks, inFlight: this.inFlight.size, assemblyBufferedResults: this.assemblyBufferedResults});
        this.cancelFrameWait();
        if (this.preparePromise) await this.preparePromise;
        if (this.startPromise) await this.startPromise;
        if (this.aborted) return this.status;
        if (this.captureLoop) await this.captureLoop;
        if (this.status === FACE_CROP_STATUS.DISABLED || this.status === FACE_CROP_STATUS.UNSUPPORTED) {
            await this.closeWorker();
            if (this.started && !this.manifest && this.status !== FACE_CROP_STATUS.DISABLED) await this.uploadManifest([], this.status);
            this.state = 'terminal';
            return this.status;
        }
        if (!this.started || !this.assemblyWorker) {
            await this.closeWorker();
            if (this.started && !this.manifest) await this.uploadManifest([], this.status);
            this.state = 'terminal';
            return this.status;
        }
        return this.finalize();
    }

    abort() {
        if (this.abortPromise) return this.abortPromise;
        if (this.state === 'terminal') return Promise.resolve(this.status);
        this.aborted = true;
        this.state = 'stopping';
        this.cancelFrameWait();
        this.sink.abort();
        const workers = [...this.analysisWorkers, this.assemblyWorker, this.encoderWorker].filter(Boolean);
        workers.forEach(worker => { if (typeof worker.terminate === 'function') worker.terminate(); });
        this.abortPromise = (async () => {
            await Promise.allSettled([this.preparePromise, this.startPromise, this.captureLoop, ...this.inFlight.values(), ...this.encodingJobs.values()].filter(Boolean));
            await this.closeWorker();
            return this.terminate('aborted', 'Capture aborted by the study');
        })();
        return this.abortPromise;
    }

    async captureFrames() {
        try {
            while (this.state === 'capturing') {
                const event = await this.waitForFrame();
                if (!event || this.state !== 'capturing') break;
                this.recordSkippedFrames(event.metadata);
                await this.processFrame(event.metadata, event.wallClockMs, event.presentationTimeUs);
            }
        } catch (error) {
            this.markIncomplete(error.message || 'Face-crop frame processing failed');
        }
    }

    waitForFrame() {
        return new Promise((resolve, reject) => {
            const callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
                if (!this.frameWait || this.frameWait.callbackId !== callbackId) return;
                this.frameWait = null;
                this.frameCallbacks += 1;
                if (this.frameCallbacks >= this.nextProgressLogFrame) {
                    this.diagnostic('progress', {frameCallbacks: this.frameCallbacks, acceptedFrames: this.acceptedFrames,
                        skippedFrames: this.skippedFrames, inFlight: this.inFlight.size, assemblyBufferedResults: this.assemblyBufferedResults});
                    this.nextProgressLogFrame += 120;
                }
                if (!Number.isFinite(now) || !metadata || !Number.isFinite(metadata.presentationTime)) {
                    reject(new Error('Video frame presentationTime is unavailable'));
                    return;
                }
                const presentationTimeUs = Math.round(metadata.presentationTime * 1000);
                if (!Number.isSafeInteger(presentationTimeUs) ||
                    (this.lastPresentationTimeUs !== null && presentationTimeUs <= this.lastPresentationTimeUs)) {
                    reject(new Error('Video frame presentationTime is non-increasing'));
                    return;
                }
                this.lastPresentationTimeUs = presentationTimeUs;
                resolve({metadata, presentationTimeUs, wallClockMs: Date.now()});
            });
            this.frameWait = {callbackId, resolve};
        });
    }

    cancelFrameWait() {
        if (!this.frameWait) return;
        const wait = this.frameWait;
        this.frameWait = null;
        this.video.cancelVideoFrameCallback(wait.callbackId);
        wait.resolve(null);
    }

    recordSkippedFrames(metadata) {
        if (!Number.isSafeInteger(metadata.presentedFrames)) return;
        if (this.lastPresentedFrame !== null) {
            this.skippedFrames += Math.max(0, metadata.presentedFrames - this.lastPresentedFrame - 1);
            this.accounting.callbackGaps = this.skippedFrames;
        }
        this.lastPresentedFrame = metadata.presentedFrames;
    }

    async processFrame(metadata, wallClockMs = Date.now(), presentationTimeUs = null) {
        return this.processAnalysisFrame(metadata, wallClockMs, presentationTimeUs);
    }

    async processAnalysisFrame(metadata, wallClockMs, presentationTimeUs = null) {
        let queueStarted = null;
        while (this.inFlight.size + this.assemblyBufferedResults >= this.configuration.analysisWorkerCount) {
            if (this.state !== 'capturing') return;
            if (!this.inFlight.size) {
                this.markIncomplete('Face-crop assembly result sequence gap');
                return;
            }
            if (queueStarted === null) queueStarted = performance.now();
            await Promise.race(this.inFlight.values());
        }
        if (queueStarted !== null) this.accounting.analysisQueueWaitMs += performance.now() - queueStarted;
        if (this.aborted) return;
        const sequence = this.nextSequence++;
        const worker = this.analysisWorkers[this.nextWorker++ % this.analysisWorkers.length];
        const source = dimensions(this.video);
        this.source = source;
        if (!supportedDimensions(source)) return this.markIncomplete('Source dimensions changed outside supported bounds');
        if (!Number.isSafeInteger(presentationTimeUs)) throw new Error('Video frame presentationTime is required');
        const timestampUs = presentationTimeUs;
        const frame = new window.VideoFrame(this.video, {timestamp: timestampUs});
        this.accounting.submittedFrames += 1;
        const task = worker.processFrame({frame, width: this.source.width, height: this.source.height, timestampUs, wallClockMs, sequence})
            .then(result => { if (this.aborted) { this.accounting.discardedFrames += 1; return null; } return this.assemblyWorker.processAnalysisResult(result); })
            .then(result => { if (result && !this.aborted) return this.commitAssemblyResult(result); })
            .catch(error => { if (this.aborted) this.accounting.discardedFrames += 1; else { this.accounting.failedProcessingFrames += 1; this.markIncomplete(error.message || 'Face-crop frame processing failed'); } })
            .finally(() => this.inFlight.delete(sequence));
        this.inFlight.set(sequence, task);
    }

    async commitAssemblyResult(result) {
        this.assemblyBufferedResults = result.bufferedResultCount;
        for (const commit of result.commits) {
            this.accounting.processedFrames += 1;
            await this.enqueueEncodingParts(commit.parts);
            Object.keys(commit.timings || {}).forEach(stage => addTiming(this.frameTimings, stage, commit.timings[stage]));
            if (commit.accepted) {
                if (commit.detectionState === 'largest' || commit.detectionState === 'reacquired') this.faceDetections += 1;
                else this.faceDetectionMisses += 1;
                this.acceptedFrames += 1;
            } else this.faceDetectionMisses += 1;
        }
    }

    async enqueueEncodingParts(parts = []) {
        for (const part of parts || []) await this.enqueueEncodingPart(part);
    }

    async enqueueEncodingPart(part) {
        this.accounting.sealedFrames += part.frameCount;
        const queueStarted = this.encodingJobs.size >= MAX_PENDING_ENCODE_PARTS ? performance.now() : null;
        while (this.encodingJobs.size >= MAX_PENDING_ENCODE_PARTS) await Promise.race(this.encodingJobs.values());
        if (queueStarted !== null) this.accounting.encodingQueueWaitMs += performance.now() - queueStarted;
        if (this.aborted) return;
        const partId = String(part.segmentIndex) + ':' + String(part.partIndex);
        if (this.encodingJobs.has(partId)) throw new Error('Face-crop encoder received a duplicate part');
        this.diagnostic('part-sealed', {partIndex: part.partIndex, segmentIndex: part.segmentIndex, frameCount: part.frameCount});
        const job = this.encoderWorker.encodePart(part)
            .then(result => {
                Object.keys(result.timings || {}).forEach(stage => addTiming(this.encodingTimings, stage, result.timings[stage]));
                this.accounting.encodedFrames += result.artifact.frameCount;
                if (this.aborted) return;
                return this.enqueueEncodedPart(result.artifact);
            })
            .catch(error => { if (!this.aborted) { this.accounting.failedEncodingFrames += part.frameCount; this.markIncomplete('Face-crop encoding failed: ' + (error.message || 'unknown failure')); } })
            .finally(() => this.encodingJobs.delete(partId));
        this.encodingJobs.set(partId, job);
    }

    async enqueueEncodedPart(part) {
        if (this.aborted) return;
        this.diagnostic('part-encoded', {partIndex: part.partIndex, segmentIndex: part.segmentIndex, frameCount: part.frameCount});
        await this.sink.enqueuePart(part);
    }

    markIncomplete(reason) {
        if (this.state === 'terminal' || this.aborted) return;
        this.incompleteReason = reason;
        this.state = 'stopping';
        this.cancelFrameWait();
        this.setStatus(FACE_CROP_STATUS.INCOMPLETE, reason);
    }

    async finalize() {
        // AVI and face-event sidecars are finalized together; either upload
        // failure makes the logical face-crop capture incomplete.
        let result = {parts: []};
        this.diagnostic('finalization-started', {frameCallbacks: this.frameCallbacks, inFlight: this.inFlight.size});
        try {
            if (this.frameCallbacks === 0) {
                this.incompleteReason = this.incompleteReason || 'No video frame callbacks were received during face-crop capture';
            }
            await Promise.all(this.inFlight.values());
            if (this.aborted) return this.status;
            const assemblyResult = await this.assemblyWorker.finish();
            this.assemblyBufferedResults = assemblyResult.bufferedResultCount;
            await this.enqueueEncodingParts(assemblyResult.parts);
            await Promise.all(this.encodingJobs.values());
            if (this.aborted) return this.status;
            result = await this.sink.finalize();
            this.accounting.persistedFrames = result.parts.filter(part => part.status === UPLOAD_STATUS.SUCCEEDED).reduce((count, part) => count + part.frameCount, 0);
            this.accounting.failedPersistenceFrames = result.parts.filter(part => part.status !== UPLOAD_STATUS.SUCCEEDED).reduce((count, part) => count + part.frameCount, 0);
            this.accounting.reconciliation = reconcileAccounting(this.accounting, this.acceptedFrames);
            if (this.accounting.reconciliation.status === 'inconsistent') this.incompleteReason = this.incompleteReason || 'Pipeline frame accounting is inconsistent';
            if (result.parts.some(part => part.status !== UPLOAD_STATUS.SUCCEEDED)) {
                this.incompleteReason = 'One or more patch-video uploads failed';
            }
        } catch (error) {
            this.incompleteReason = error.message || 'Face-crop finalization failed';
        } finally {
            await this.closeWorker();
        }
        if (this.aborted) return this.status;
        await this.uploadManifest(result.parts);
        this.diagnostic('finalization-finished', {parts: result.parts.length, incompleteReason: this.incompleteReason});
        if (this.aborted) return this.status;
        return this.terminate(this.incompleteReason ? FACE_CROP_STATUS.INCOMPLETE : FACE_CROP_STATUS.COMPLETE, this.incompleteReason);
    }

    async uploadManifest(parts, terminalStatus) {
        if (this.aborted) return;
        const filename = createCaptureManifestFilename({filenamePrefix: this.filenamePrefix, context: this.context, studyResultId: this.studyResultId, studyPage: this.studyPage,
            videoCounter: this.videoCounter, captureId: this.captureId});
        const uploadId = 'face-crop-manifest-' + this.captureId;
        const manifest = buildCaptureManifest({captureId: this.captureId, context: this.context, filenamePrefix: this.filenamePrefix,
            source: this.sourceMetadata(), capability: this.capability, configuration: this.configurationMetadata(), frameNormalization: this.frameNormalization,
            status: terminalStatus || (this.incompleteReason ? FACE_CROP_STATUS.INCOMPLETE : FACE_CROP_STATUS.COMPLETE), reason: this.incompleteReason || this.terminalReason,
            statistics: this.metadata(this.status).statistics, parts, diagnostics: this.configuration.diagnostics});
        this.manifest = {filename, status: 'pending'};
        const outcome = await this.sink.writeArtifact(JSON.stringify(manifest), filename, uploadId);
        this.manifest.status = outcome.status;
        if (outcome.status !== UPLOAD_STATUS.SUCCEEDED && !this.aborted) {
            this.incompleteReason = this.incompleteReason || 'Face-crop manifest upload failed';
        }
    }

    sourceMetadata() {
        const source = this.source || {};
        const width = source.width;
        const height = source.height;
        return {...source,
            pixelCount: Number.isSafeInteger(width) && Number.isSafeInteger(height) ? width * height : null,
            aspectRatio: Number.isSafeInteger(width) && Number.isSafeInteger(height) ? width / height : null,
            orientation: Number.isSafeInteger(width) && Number.isSafeInteger(height)
                ? (width === height ? 'square' : width > height ? 'landscape' : 'portrait') : null};
    }

    configurationMetadata() {
        const config = this.configuration;
        return {roi: {smoothingTauMs: config.faceRoiSmoothingTauMs, scale: config.faceRoiScale, verticalShiftRatio: config.faceRoiVerticalShiftRatio},
            detector: {implementation: 'blazeface', modelVersion: '0.1.0', runtime: 'tensorflowjs', runtimeVersion: '4.22.0', backend: 'wasm', minConfidence: config.faceDetectionMinConfidence},
            analysisWorkerCount: config.analysisWorkerCount,
            selectionPolicy: 'largest-eligible-bounding-box-v1',
            sampling: {method: 'area-average-v1', roiDescriptorVersion: 2, rounding: 'half-up', inputColorSpace: 'srgb', outputPixelFormat: 'bgr24', frameSize: 72}};
    }

    terminate(status, reason) {
        if (this.aborted) { status = 'aborted'; reason = 'Capture aborted by the study'; }
        this.terminalReason = reason || null;
        this.state = 'terminal';
        this.diagnostic('terminal', {status, reason: reason || null, frameCallbacks: this.frameCallbacks,
            acceptedFrames: this.acceptedFrames, skippedFrames: this.skippedFrames});
        this.setStatus(status, reason);
        return status;
    }

    metadata(status) {
        return {
            status,
            capability: this.configuration.diagnostics ? this.capability : {status: this.capability.status,
                failedStage: this.capability.failedStage || null, error: this.capability.error || null},
            capture: {captureId: this.captureId, context: this.context},
            source: this.sourceMetadata(),
            manifest: this.manifest,
            configuration: this.configurationMetadata(),
            output: {format: PATCH_VIDEO_FORMAT_VERSION, container: 'avi.gz', transportEncoding: 'gzip', videoCodec: 'DIB', pixelFormat: 'bgr24',
                aviHeaderFrameRatePolicy: 'required-per-part-from-presentationTimeUs-v1', frameSize: 72,
                extraction: {api: 'VideoFrame.copyTo', normalizationMode: this.frameNormalization && this.frameNormalization.mode,
                    nativeFormat: this.frameNormalization && this.frameNormalization.nativeFormat, outputFormat: 'RGBA'}},
            statistics: {accounting: {...this.accounting}, faceDetections: this.faceDetections, faceDetectionMisses: this.faceDetectionMisses,
                acceptedFrames: this.acceptedFrames, skippedFrames: this.skippedFrames, frameCallbacks: this.frameCallbacks,
                frameTimings: this.frameTimings, encodingTimings: this.encodingTimings, detectorWarmup: this.detectorWarmup}
        };
    }

    setStatus(status, reason) {
        // Status metadata is consumed by Main;
        // terminal failures are reported but do not block the study flow.
        this.status = status;
        const metadata = {...this.metadata(status), reason: reason || null};
        if (this.configuration.diagnostics && (status === FACE_CROP_STATUS.UNSUPPORTED || status === FACE_CROP_STATUS.INCOMPLETE)) {
            console.error('[face-crop] Capture ' + status + ': ' + (reason || 'unknown failure'), metadata);
        } else if (this.configuration.diagnostics && status === FACE_CROP_STATUS.COMPLETE && metadata.statistics.acceptedFrames === 0) {
            console.warn('[face-crop] Capture completed without an eligible face or output frames', metadata);
        }
        this.onStatus(metadata);
    }

    async closeWorker() {
        const workers = [...this.analysisWorkers, this.assemblyWorker, this.encoderWorker].filter(Boolean);
        this.analysisWorkers = [];
        this.assemblyWorker = null;
        this.encoderWorker = null;
        if (!workers.length) return;
        try {
            await Promise.all(workers.map(worker => worker.close()));
        } catch (error) {
            if (this.configuration.diagnostics) console.warn('[face-crop] Worker cleanup failed', error);
        }
    }
}

let nextCaptureId = 0;
function createCaptureId(studyPage, videoCounter) {
    return 'capture-' + String(studyPage) + '-' + String(videoCounter) + '-' + Date.now() + '-' + nextCaptureId++;
}
