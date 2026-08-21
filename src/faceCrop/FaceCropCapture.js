import {UPLOAD_STATUS} from '../uploadState';
import {PATCH_VIDEO_FORMAT_VERSION, PATCH_VIDEO_FRAME_RATE, FaceCropSink, createCaptureManifestFilename} from './FaceCropOutput';

// Face-crop capture is an optional companion to MediaRecorder. It must fail
// closed so unsupported browsers never affect the participant-facing recording.
export const FACE_CROP_CAPTURE_MODES = ['off', 'calibration', 'all'];
export const FACE_CROP_STATUS = {
    DISABLED: 'disabled',
    UNSUPPORTED: 'unsupported',
    CAPTURING: 'capturing',
    COMPLETE: 'complete',
    INCOMPLETE: 'incomplete'
};
export const DEFAULT_FACE_ROI_SMOOTHING_TAU_MS = 100;
export const DEFAULT_FACE_ROI_SCALE = 1.5;
export const DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO = 0.15;
export const DEFAULT_FACE_DETECTION_MIN_CONFIDENCE = 0.5;
export const DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD = 0.3;
export const FACE_DETECTION_DELEGATES = ['CPU', 'GPU'];
export const DEFAULT_FACE_DETECTION_DELEGATE = 'CPU';

function boundedNumber(value, minimum, maximum, fallback, integer = false) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && (!integer || Number.isSafeInteger(parsed)) && parsed >= minimum && parsed <= maximum
        ? parsed : fallback;
}

export function resolveFaceCropConfiguration(environment = process.env) {
    const requestedMode = environment.REACT_APP_FACE_CROP_RECORDING_MODE || 'off';
    return {
        requestedMode,
        mode: FACE_CROP_CAPTURE_MODES.includes(requestedMode) ? requestedMode : 'off',
        faceDetectionDelegate: FACE_DETECTION_DELEGATES.includes(environment.REACT_APP_FACE_DETECTION_DELEGATE)
            ? environment.REACT_APP_FACE_DETECTION_DELEGATE : DEFAULT_FACE_DETECTION_DELEGATE,
        faceRoiSmoothingTauMs: boundedNumber(
            environment.REACT_APP_FACE_CROP_SMOOTHING_TAU_MS,
            0,
            10000,
            DEFAULT_FACE_ROI_SMOOTHING_TAU_MS,
            true
        ),
        faceRoiScale: boundedNumber(environment.REACT_APP_FACE_CROP_SCALE, 1, 3, DEFAULT_FACE_ROI_SCALE),
        faceRoiVerticalShiftRatio: boundedNumber(
            environment.REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO,
            -1,
            1,
            DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO
        ),
        faceDetectionMinConfidence: boundedNumber(
            environment.REACT_APP_FACE_DETECTION_MIN_CONFIDENCE,
            0,
            1,
            DEFAULT_FACE_DETECTION_MIN_CONFIDENCE
        ),
        faceDetectionMinSuppressionThreshold: boundedNumber(
            environment.REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD,
            0,
            1,
            DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD
        )
    };
}

// Calibration mode is deliberately narrow: it supplies one reference capture
// without adding face-crop work to every speech-task recording.
export function shouldCaptureFaceCrop(configuration, studyPage) {
    return configuration.mode === 'all' || (configuration.mode === 'calibration' && studyPage === 'introduction');
}

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

const FRAME_TIMING_STAGES = ['workerRoundTripMs', 'detectionMs', 'roiSelectionMs', 'rgbaCopyMs', 'cropAndSegmentMs', 'pipelineTotalMs', 'enqueuePartsMs', 'totalMs'];

function createTimingMetrics() {
    return FRAME_TIMING_STAGES.reduce((metrics, stage) => {
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

export async function probeFaceCropCapability(video) {
    const source = dimensions(video);
    const checks = {};
    const failed = (reason, stage, error) => ({
        supported: false,
        capability: {status: 'failed', checks, failedStage: stage},
        source,
        reason,
        error: error ? {name: error.name || 'Error', message: error.message || String(error)} : null
    });
    if (!video || typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') {
        checks.requestVideoFrameCallback = {status: 'failed'};
        checks.cancelVideoFrameCallback = {status: 'failed'};
        return failed('requestVideoFrameCallback is unavailable', 'requestVideoFrameCallback');
    }
    checks.requestVideoFrameCallback = {status: 'passed'};
    checks.cancelVideoFrameCallback = {status: 'passed'};
    if (typeof window.VideoFrame !== 'function') {
        checks.videoFrame = {status: 'failed', stage: 'available'};
        return failed('VideoFrame is unavailable', 'videoFrame');
    }
    checks.videoFrame = {status: 'available'};
    if (typeof window.CompressionStream !== 'function') {
        checks.compressionStream = {status: 'failed'};
        return failed('Native CompressionStream is unavailable', 'compressionStream');
    }
    checks.compressionStream = {status: 'passed'};
    let frame;
    try {
        frame = new window.VideoFrame(video);
        checks.videoFrame.construct = {status: 'passed', width: frame.displayWidth, height: frame.displayHeight};
        await frame.copyTo(new Uint8Array(frame.displayWidth * frame.displayHeight * 4), {format: 'RGBA', colorSpace: 'srgb'});
        checks.videoFrame.copyTo = {status: 'passed', format: 'RGBA', colorSpace: 'srgb'};
        return {supported: true, capability: {status: 'passed', checks}, source};
    } catch (error) {
        if (!checks.videoFrame.construct) checks.videoFrame.construct = {status: 'failed'};
        else checks.videoFrame.copyTo = {status: 'failed'};
        return failed(error.message || 'VideoFrame RGBA/sRGB extraction failed',
            checks.videoFrame.construct.status === 'failed' ? 'videoFrame.construct' : 'videoFrame.copyTo', error);
    } finally {
        if (frame) frame.close();
    }
}

class PipelineWorker {
    constructor() {
        // eslint-disable-next-line import/no-webpack-loader-syntax
        const workerModule = require('worker-loader!./FaceCropPipeline.worker');
        const WorkerConstructor = workerModule.default || workerModule;
        if (typeof WorkerConstructor !== 'function') {
            throw new Error('Face-crop worker-loader did not export a Worker constructor');
        }
        this.worker = new WorkerConstructor();
        this.pending = null;
        this.closed = false;
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = event => this.fail(new Error(event.message || 'Face-crop worker crashed'));
        this.worker.onmessageerror = () => this.fail(new Error('Face-crop worker message could not be decoded'));
    }

    receive(message) {
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        if (message && message.error) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            if (message.error.stack) error.stack = message.error.stack;
            pending.reject(error);
        } else pending.resolve(message && message.result);
    }

    fail(error) {
        console.error('[face-crop] Worker failure', error);
        this.closed = true;
        this.worker.terminate();
        if (this.pending) {
            this.pending.reject(error);
            this.pending = null;
        }
    }

    request(type, payload = {}, transfer = []) {
        // The worker protocol allows one in-flight request so frame buffers and
        // responses stay ordered and the browser cannot build an unbounded queue.
        if (this.closed) return Promise.reject(new Error('Face-crop worker is closed'));
        if (this.pending) return Promise.reject(new Error('Face-crop worker already has a request in flight'));
        return new Promise((resolve, reject) => {
            this.pending = {resolve, reject};
            try {
                this.worker.postMessage({type, payload}, transfer);
            } catch (error) {
                this.pending = null;
                reject(error);
            }
        });
    }

    initialize(payload) { return this.request('initialize', payload); }
    processFrame(payload) { return this.request('processFrame', payload, [payload.frame]); }
    finish() { return this.request('finish'); }
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
        createPipelineWorker = () => new PipelineWorker()
    }) {
        Object.assign(this, {video, studyResultId, studyPage, videoCounter, configuration});
        this.onStatus = onStatus || (() => {});
        this.createPipelineWorker = createPipelineWorker;
        this.sink = new FaceCropSink({uploadResultFile, uploadTracker});
        this.uploadResultFile = uploadResultFile;
        this.uploadTracker = uploadTracker;
        this.state = 'idle';
        this.status = FACE_CROP_STATUS.DISABLED;
        this.startPromise = null;
        this.stopPromise = null;
        this.frameWait = null;
        this.captureLoop = null;
        this.worker = null;
        this.incompleteReason = null;
        this.captureId = providedCaptureId || createCaptureId(studyPage, videoCounter);
        this.acceptedFrames = 0;
        this.skippedFrames = 0;
        this.lastPresentedFrame = null;
        this.faceDetections = 0;
        this.faceDetectionMisses = 0;
        this.frameTimings = createTimingMetrics();
        this.capability = {status: 'not-run', checks: {}};
        this.source = null;
        this.manifest = null;
    }

    start() {
        if (!this.startPromise) this.startPromise = this.startInternal();
        return this.startPromise;
    }

    async startInternal() {
        this.state = 'starting';
        const capability = await probeFaceCropCapability(this.video);
        this.capability = capability.capability;
        this.source = capability.source;
        if (this.state === 'stopping') return this.status;
        if (!capability.supported) {
            await this.uploadManifest([], FACE_CROP_STATUS.UNSUPPORTED);
            return this.terminate(FACE_CROP_STATUS.UNSUPPORTED, capability.reason);
        }
        const source = dimensions(this.video);
        this.source = source;
        if (!supportedDimensions(source)) {
            this.capability = {...this.capability, status: 'failed', failedStage: 'sourceDimensions', checks: {
                ...this.capability.checks,
                sourceDimensions: {status: 'failed', width: source.width, height: source.height, maxPixels: MAX_SOURCE_PIXELS}
            }};
            await this.uploadManifest([], FACE_CROP_STATUS.INCOMPLETE);
            return this.terminate(FACE_CROP_STATUS.INCOMPLETE, 'Source dimensions are outside supported bounds');
        }
        this.capability = {...this.capability, checks: {
            ...this.capability.checks,
            sourceDimensions: {status: 'passed', width: source.width, height: source.height, maxPixels: MAX_SOURCE_PIXELS}
        }};
        try {
            this.worker = this.createPipelineWorker();
            const config = this.configuration;
            await this.worker.initialize({
                configuration: {
                    faceRoiSmoothingTauMs: config.faceRoiSmoothingTauMs,
                    faceRoiScale: config.faceRoiScale,
                    faceRoiVerticalShiftRatio: config.faceRoiVerticalShiftRatio,
                    faceDetectionMinConfidence: config.faceDetectionMinConfidence,
                    faceDetectionMinSuppressionThreshold: config.faceDetectionMinSuppressionThreshold,
                    faceDetectionDelegate: config.faceDetectionDelegate
                },
                identity: {
                    studyResultId: this.studyResultId,
                    studyPage: this.studyPage,
                    videoCounter: this.videoCounter,
                    captureId: this.captureId
                }
            });
        } catch (error) {
            await this.closeWorker();
            return this.terminate(FACE_CROP_STATUS.UNSUPPORTED, error.message || 'MediaPipe face detector initialization failed');
        }
        if (this.state === 'stopping') {
            await this.closeWorker();
            return this.status;
        }
        this.state = 'capturing';
        this.setStatus(FACE_CROP_STATUS.CAPTURING);
        this.captureLoop = this.captureFrames();
        return this.status;
    }

    stop() {
        if (!this.stopPromise) this.stopPromise = this.stopInternal();
        return this.stopPromise;
    }

    async stopInternal() {
        // Cancel the browser callback first, then drain the capture loop, then
        // flush the worker and sink. This prevents frames arriving during teardown.
        if (this.state !== 'terminal') this.state = 'stopping';
        this.cancelFrameWait();
        if (this.startPromise) await this.startPromise;
        if (this.captureLoop) await this.captureLoop;
        if (this.status === FACE_CROP_STATUS.DISABLED || this.status === FACE_CROP_STATUS.UNSUPPORTED) {
            await this.closeWorker();
            if (!this.manifest && this.status !== FACE_CROP_STATUS.DISABLED) await this.uploadManifest([], this.status);
            return this.status;
        }
        return this.finalize();
    }

    async captureFrames() {
        try {
            while (this.state === 'capturing') {
                const event = await this.waitForFrame();
                if (!event || this.state !== 'capturing') break;
                this.recordSkippedFrames(event.metadata);
                await this.processFrame(event.metadata, event.wallClockMs);
            }
        } catch (error) {
            this.markIncomplete(error.message || 'Face-crop frame processing failed');
        }
    }

    waitForFrame() {
        return new Promise(resolve => {
            const callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
                if (!this.frameWait || this.frameWait.callbackId !== callbackId) return;
                this.frameWait = null;
                resolve({metadata, wallClockMs: Date.now()});
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
        }
        this.lastPresentedFrame = metadata.presentedFrames;
    }

    async processFrame(metadata, wallClockMs = Date.now()) {
        let frame;
        const startedAt = performance.now();
        try {
            const source = dimensions(this.video);
            this.source = source;
            if (!supportedDimensions(source)) return this.markIncomplete('Source dimensions changed outside supported bounds');
            const timestampUs = Math.round(metadata.mediaTime * 1000000);
            frame = new window.VideoFrame(this.video, {timestamp: timestampUs});
            const frameSource = {width: frame.displayWidth, height: frame.displayHeight};
            const workerStartedAt = performance.now();
            const result = await this.worker.processFrame({frame, ...frameSource, timestampUs, wallClockMs});
            addTiming(this.frameTimings, 'workerRoundTripMs', performance.now() - workerStartedAt);
            frame = null;
            const enqueueStartedAt = performance.now();
            await this.enqueueParts(result.parts);
            addTiming(this.frameTimings, 'enqueuePartsMs', performance.now() - enqueueStartedAt);
            Object.keys(result.timings || {}).forEach(stage => addTiming(this.frameTimings, stage, result.timings[stage]));
            addTiming(this.frameTimings, 'totalMs', performance.now() - startedAt);
            if (!result.accepted) {
                this.faceDetectionMisses += 1;
                return;
            }
            if (result.detectionState === 'largest' || result.detectionState === 'reacquired') this.faceDetections += 1;
            else this.faceDetectionMisses += 1;
            this.acceptedFrames += 1;
        } catch (error) {
            this.markIncomplete(error.message || 'Face-crop frame processing failed');
        } finally {
            if (frame) frame.close();
        }
    }

    async enqueueParts(parts = []) {
        for (const part of parts) await this.sink.enqueuePart(part);
    }

    markIncomplete(reason) {
        if (this.state === 'terminal') return;
        this.incompleteReason = reason;
        this.state = 'stopping';
        this.cancelFrameWait();
        this.setStatus(FACE_CROP_STATUS.INCOMPLETE, reason);
    }

    async finalize() {
        // AVI and face-event sidecars are finalized together; either upload
        // failure makes the logical face-crop capture incomplete.
        let result = {parts: []};
        try {
            if (this.worker) await this.enqueueParts((await this.worker.finish()).parts);
            result = await this.sink.finalize();
            if (result.parts.some(part => part.status !== UPLOAD_STATUS.SUCCEEDED)) {
                this.incompleteReason = 'One or more patch-video uploads failed';
            }
        } catch (error) {
            this.incompleteReason = error.message || 'Face-crop finalization failed';
        } finally {
            await this.closeWorker();
        }
        await this.uploadManifest(result.parts);
        return this.terminate(this.incompleteReason ? FACE_CROP_STATUS.INCOMPLETE : FACE_CROP_STATUS.COMPLETE, this.incompleteReason);
    }

    async uploadManifest(parts, terminalStatus) {
        const filename = createCaptureManifestFilename({studyResultId: this.studyResultId, studyPage: this.studyPage,
            videoCounter: this.videoCounter, captureId: this.captureId});
        const uploadId = 'face-crop-manifest-' + this.captureId;
        const manifest = {
            capture: {captureId: this.captureId,
                identity: {studyResultId: this.studyResultId, studyPage: this.studyPage, videoCounter: this.videoCounter}},
            source: this.sourceMetadata(),
            capability: this.capability,
            configuration: this.configurationMetadata(),
            output: {format: PATCH_VIDEO_FORMAT_VERSION, container: 'avi.gz', frameRate: PATCH_VIDEO_FRAME_RATE,
                aviHeaderFrameRatePolicy: 'derived-per-part-from-mediaTimeUs-v1', frameSize: 72},
            status: terminalStatus || (this.status === FACE_CROP_STATUS.UNSUPPORTED ? FACE_CROP_STATUS.UNSUPPORTED
                : (this.incompleteReason ? FACE_CROP_STATUS.INCOMPLETE : FACE_CROP_STATUS.COMPLETE)),
            statistics: {faceDetections: this.faceDetections, faceDetectionMisses: this.faceDetectionMisses,
                acceptedFrames: this.acceptedFrames, skippedFrames: this.skippedFrames, frameTimings: this.frameTimings},
            parts: parts.map(part => ({captureId: part.captureId, filename: part.filename, faceEventsFilename: part.faceEventsFilename,
                segmentIndex: part.segmentIndex, partIndex: part.partIndex, frameCount: part.frameCount, status: part.status}))
        };
        this.manifest = {filename, status: 'pending'};
        this.uploadTracker.registerUpload(uploadId);
        try {
            await this.uploadResultFile(JSON.stringify(manifest), filename);
            this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.SUCCEEDED);
            this.manifest.status = UPLOAD_STATUS.SUCCEEDED;
        } catch (error) {
            this.uploadTracker.settleUpload(uploadId, UPLOAD_STATUS.FAILED);
            this.manifest.status = UPLOAD_STATUS.FAILED;
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
        return {requestedMode: config.requestedMode, appliedMode: config.mode,
            roi: {smoothingTauMs: config.faceRoiSmoothingTauMs, scale: config.faceRoiScale, verticalShiftRatio: config.faceRoiVerticalShiftRatio},
            detector: {delegate: config.faceDetectionDelegate, minConfidence: config.faceDetectionMinConfidence,
                minSuppressionThreshold: config.faceDetectionMinSuppressionThreshold},
            selectionPolicy: 'largest-eligible-bounding-box-v1'};
    }

    terminate(status, reason) {
        this.state = 'terminal';
        this.setStatus(status, reason);
        return status;
    }

    metadata(status) {
        return {
            status,
            capability: this.capability,
            capture: {captureId: this.captureId,
                identity: {studyResultId: this.studyResultId, studyPage: this.studyPage, videoCounter: this.videoCounter}},
            source: this.sourceMetadata(),
            manifest: this.manifest,
            configuration: this.configurationMetadata(),
            output: {format: PATCH_VIDEO_FORMAT_VERSION, container: 'avi.gz', transportEncoding: 'gzip', videoCodec: 'DIB', pixelFormat: 'bgr24', frameRate: PATCH_VIDEO_FRAME_RATE,
                aviHeaderFrameRatePolicy: 'derived-per-part-from-mediaTimeUs-v1', frameSize: 72,
                extraction: {api: 'VideoFrame.copyTo', format: 'RGBA', colorSpace: 'srgb'}},
            statistics: {faceDetections: this.faceDetections, faceDetectionMisses: this.faceDetectionMisses,
                acceptedFrames: this.acceptedFrames, skippedFrames: this.skippedFrames, frameTimings: this.frameTimings}
        };
    }

    setStatus(status, reason) {
        // Status metadata is the durable diagnostic record consumed by Main;
        // terminal failures are reported but do not block the study flow.
        this.status = status;
        const metadata = {...this.metadata(status), reason: reason || null};
        if (status === FACE_CROP_STATUS.UNSUPPORTED || status === FACE_CROP_STATUS.INCOMPLETE) {
            console.error('[face-crop] Capture ' + status + ': ' + (reason || 'unknown failure'), metadata);
        } else if (status === FACE_CROP_STATUS.COMPLETE && metadata.acceptedFrames === 0) {
            console.warn('[face-crop] Capture completed without an eligible face or output frames', metadata);
        }
        this.onStatus(metadata);
    }

    async closeWorker() {
        if (!this.worker) return;
        const worker = this.worker;
        this.worker = null;
        try {
            await worker.close();
        } catch (error) {
            console.warn('[face-crop] Worker cleanup failed', error);
        }
    }
}

let nextCaptureId = 0;
function createCaptureId(studyPage, videoCounter) {
    return 'capture-' + String(studyPage) + '-' + String(videoCounter) + '-' + Date.now() + '-' + nextCaptureId++;
}

function reportStatus(props, status, reason) {
    if (typeof props.onFaceCropStatus === 'function') {
        props.onFaceCropStatus({status, reason: reason || null});
    }
}

export function startFaceCropCaptureSession({webcam, props}) {
    const configuration = resolveFaceCropConfiguration();
    if (!shouldCaptureFaceCrop(configuration, props.studyPage)) {
        console.info('[face-crop] Capture disabled for this page', {mode: configuration.mode, studyPage: props.studyPage});
        return null;
    }
    const video = webcam && webcam.video;
    if (!video || !window.jatos || typeof window.jatos.uploadResultFile !== 'function') {
        reportStatus(props, FACE_CROP_STATUS.INCOMPLETE, 'Video element or JATOS upload API is unavailable');
        return null;
    }
    const uploadTracker = {
        registerUpload: id => props.markVideoAsUploading(id),
        settleUpload: (id, status) => (status === UPLOAD_STATUS.SUCCEEDED ? props.markVideoAsUploaded(id) : props.markVideoAsFailed(id))
    };
    const controller = new FaceCropCaptureController({
        video,
        configuration,
        uploadTracker,
        studyResultId: props.studyResultId,
        studyPage: props.studyPage,
        videoCounter: props.videoCounter,
        captureId: props.captureId,
        uploadResultFile: (payload, filename) => window.jatos.uploadResultFile(payload, filename),
        onStatus: metadata => {
            if (typeof props.onFaceCropStatus === 'function') props.onFaceCropStatus(metadata);
        }
    });
    controller.start().catch(error => reportStatus(props, FACE_CROP_STATUS.UNSUPPORTED,
        error.message || 'Face-crop capture failed to start'));
    return controller;
}

export async function stopFaceCropCaptureSession(controller) {
    if (controller) await controller.stop();
}
