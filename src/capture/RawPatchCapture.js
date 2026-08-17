import {UPLOAD_STATUS} from '../uploadState';
import {PATCH_VIDEO_FORMAT_VERSION, PATCH_VIDEO_FRAME_RATE, RawPatchSink} from './RawPatchOutput';

export const RAW_PATCH_CAPTURE_MODES = ['off', 'calibration', 'all'];
export const RAW_PATCH_STATUS = {DISABLED: 'disabled', UNSUPPORTED: 'unsupported', CAPTURING: 'capturing',
    COMPLETE: 'complete', INCOMPLETE: 'incomplete'};
export const DEFAULT_FACE_ROI_SMOOTHING_TAU_MS = 100;
export const DEFAULT_FACE_ROI_SCALE = 1.5;
export const DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO = 0.15;
export const DEFAULT_FACE_DETECTION_MIN_CONFIDENCE = 0.5;
export const DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD = 0.3;

function boundedNumber(value, minimum, maximum, fallback, integer = false) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && (!integer || Number.isSafeInteger(parsed)) && parsed >= minimum && parsed <= maximum
        ? parsed : fallback;
}

export function resolveRawPatchConfiguration(environment = process.env) {
    const requestedMode = environment.REACT_APP_FACE_CROP_RECORDING_MODE || 'off';
    return {requestedMode, mode: RAW_PATCH_CAPTURE_MODES.includes(requestedMode) ? requestedMode : 'off',
        faceRoiSmoothingTauMs: boundedNumber(environment.REACT_APP_FACE_CROP_SMOOTHING_TAU_MS, 0, 10000,
            DEFAULT_FACE_ROI_SMOOTHING_TAU_MS, true),
        faceRoiScale: boundedNumber(environment.REACT_APP_FACE_CROP_SCALE, 1, 3, DEFAULT_FACE_ROI_SCALE),
        faceRoiVerticalShiftRatio: boundedNumber(environment.REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO, -1, 1,
            DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO),
        faceDetectionMinConfidence: boundedNumber(environment.REACT_APP_FACE_DETECTION_MIN_CONFIDENCE, 0, 1,
            DEFAULT_FACE_DETECTION_MIN_CONFIDENCE),
        faceDetectionMinSuppressionThreshold: boundedNumber(environment.REACT_APP_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD, 0, 1,
            DEFAULT_FACE_DETECTION_MIN_SUPPRESSION_THRESHOLD)};
}

export function shouldCaptureRawPatches(configuration, studyPage) {
    return configuration.mode === 'all' || (configuration.mode === 'calibration' && studyPage === 'introduction');
}

function dimensions(video) { return {width: video.videoWidth, height: video.videoHeight}; }
function supportedDimensions({width, height}) {
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 72 && height >= 72 && width <= 1920 && height <= 1080;
}

export async function probeRawPatchCapability(video) {
    if (!video || typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') {
        return {supported: false, reason: 'requestVideoFrameCallback is unavailable'};
    }
    if (typeof window.VideoFrame !== 'function') return {supported: false, reason: 'VideoFrame is unavailable'};
    if (typeof window.CompressionStream !== 'function') return {supported: false, reason: 'Native CompressionStream is unavailable'};
    let frame;
    try {
        frame = new window.VideoFrame(video);
        await frame.copyTo(new Uint8Array(frame.displayWidth * frame.displayHeight * 4), {format: 'RGBX', colorSpace: 'srgb'});
        return {supported: true};
    } catch (error) {
        return {supported: false, reason: error.message || 'VideoFrame RGBX/sRGB extraction failed'};
    } finally {
        if (frame) frame.close();
    }
}

class PipelineWorker {
    constructor() {
        // eslint-disable-next-line import/no-webpack-loader-syntax
        const workerModule = require('worker-loader!./RawPatchPipeline.worker');
        const WorkerConstructor = workerModule.default || workerModule;
        if (typeof WorkerConstructor !== 'function') {
            throw new Error('Raw patch worker-loader did not export a Worker constructor');
        }
        this.worker = new WorkerConstructor();
        this.pending = null;
        this.closed = false;
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = event => this.fail(new Error(event.message || 'Raw patch worker crashed'));
        this.worker.onmessageerror = () => this.fail(new Error('Raw patch worker message could not be decoded'));
    }

    receive(message) {
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        if (message && message.error) {
            const error = new Error(message.error.message); error.name = message.error.name;
            if (message.error.stack) error.stack = message.error.stack;
            pending.reject(error);
        } else pending.resolve(message && message.result);
    }

    fail(error) {
        console.error('[raw-patch] Worker failure', error);
        this.closed = true;
        this.worker.terminate();
        if (this.pending) { this.pending.reject(error); this.pending = null; }
    }

    request(type, payload = {}, transfer = []) {
        if (this.closed) return Promise.reject(new Error('Raw patch worker is closed'));
        if (this.pending) return Promise.reject(new Error('Raw patch worker already has a request in flight'));
        return new Promise((resolve, reject) => {
            this.pending = {resolve, reject};
            try { this.worker.postMessage({type, payload}, transfer); }
            catch (error) { this.pending = null; reject(error); }
        });
    }

    initialize(payload) { return this.request('initialize', payload); }
    processFrame(payload) { return this.request('processFrame', payload, [payload.frame]); }
    finish() { return this.request('finish'); }
    async close() {
        if (this.closed) return;
        try { await this.request('close'); }
        finally { this.closed = true; this.worker.terminate(); }
    }
}

export class RawPatchCaptureController {
    constructor({video, studyResultId, studyPage, videoCounter, configuration, uploadTracker, uploadResultFile, onStatus,
        createPipelineWorker = () => new PipelineWorker()}) {
        Object.assign(this, {video, studyResultId, studyPage, videoCounter, configuration});
        this.onStatus = onStatus || (() => {});
        this.createPipelineWorker = createPipelineWorker;
        this.sink = new RawPatchSink({uploadResultFile, uploadTracker});
        this.state = 'idle';
        this.status = RAW_PATCH_STATUS.DISABLED;
        this.startPromise = null;
        this.stopPromise = null;
        this.frameWait = null;
        this.captureLoop = null;
        this.worker = null;
        this.incompleteReason = null;
        this.acceptedFrames = 0;
        this.skippedFrames = 0;
        this.lastPresentedFrame = null;
        this.faceDetections = 0;
        this.faceDetectionMisses = 0;
        this.noInitialFaceSkippedFrames = 0;
    }

    start() {
        if (!this.startPromise) this.startPromise = this.startInternal();
        return this.startPromise;
    }

    async startInternal() {
        this.state = 'starting';
        const capability = await probeRawPatchCapability(this.video);
        if (this.state === 'stopping') return this.status;
        if (!capability.supported) return this.terminate(RAW_PATCH_STATUS.UNSUPPORTED, capability.reason);
        if (!supportedDimensions(dimensions(this.video))) return this.terminate(RAW_PATCH_STATUS.INCOMPLETE,
            'Source dimensions are outside supported bounds');
        try {
            this.worker = this.createPipelineWorker();
            const configuration = this.configuration;
            await this.worker.initialize({configuration: {
                faceRoiSmoothingTauMs: configuration.faceRoiSmoothingTauMs, faceRoiScale: configuration.faceRoiScale,
                faceRoiVerticalShiftRatio: configuration.faceRoiVerticalShiftRatio,
                faceDetectionMinConfidence: configuration.faceDetectionMinConfidence,
                faceDetectionMinSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold},
                identity: {studyResultId: this.studyResultId, studyPage: this.studyPage, videoCounter: this.videoCounter}});
        } catch (error) {
            await this.closeWorker();
            return this.terminate(RAW_PATCH_STATUS.UNSUPPORTED, error.message || 'MediaPipe face detector initialization failed');
        }
        if (this.state === 'stopping') { await this.closeWorker(); return this.status; }
        this.state = 'capturing';
        this.setStatus(RAW_PATCH_STATUS.CAPTURING);
        this.captureLoop = this.captureFrames();
        return this.status;
    }

    stop() {
        if (!this.stopPromise) this.stopPromise = this.stopInternal();
        return this.stopPromise;
    }

    async stopInternal() {
        if (this.state !== 'terminal') this.state = 'stopping';
        this.cancelFrameWait();
        if (this.startPromise) await this.startPromise;
        if (this.captureLoop) await this.captureLoop;
        if (this.status === RAW_PATCH_STATUS.DISABLED || this.status === RAW_PATCH_STATUS.UNSUPPORTED) {
            await this.closeWorker();
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
            this.markIncomplete(error.message || 'Raw patch frame processing failed');
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
        if (this.lastPresentedFrame !== null) this.skippedFrames += Math.max(0, metadata.presentedFrames - this.lastPresentedFrame - 1);
        this.lastPresentedFrame = metadata.presentedFrames;
    }

    async processFrame(metadata, wallClockMs = Date.now()) {
        let frame;
        try {
            const source = dimensions(this.video);
            if (!supportedDimensions(source)) return this.markIncomplete('Source dimensions changed outside supported bounds');
            const timestampUs = Math.round(metadata.mediaTime * 1000000);
            frame = new window.VideoFrame(this.video, {timestamp: timestampUs});
            const result = await this.worker.processFrame({frame, ...source, timestampUs, wallClockMs});
            frame = null;
            await this.enqueueParts(result.parts);
            if (!result.accepted) {
                this.faceDetectionMisses += 1; this.noInitialFaceSkippedFrames += 1; return;
            }
            if (result.detectionState === 'largest' || result.detectionState === 'reacquired') this.faceDetections += 1;
            else this.faceDetectionMisses += 1;
            this.acceptedFrames += 1;
        } catch (error) {
            this.markIncomplete(error.message || 'Raw patch frame processing failed');
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
        this.setStatus(RAW_PATCH_STATUS.INCOMPLETE, reason);
    }

    async finalize() {
        let result = {parts: []};
        try {
            if (this.worker) await this.enqueueParts((await this.worker.finish()).parts);
            result = await this.sink.finalize();
            if (result.parts.some(part => part.status !== UPLOAD_STATUS.SUCCEEDED)) {
                this.incompleteReason = 'One or more patch-video uploads failed';
            }
        } catch (error) {
            this.incompleteReason = error.message || 'Raw patch finalization failed';
        } finally {
            await this.closeWorker();
        }
        return this.terminate(this.incompleteReason ? RAW_PATCH_STATUS.INCOMPLETE : RAW_PATCH_STATUS.COMPLETE, this.incompleteReason);
    }

    terminate(status, reason) {
        this.state = 'terminal';
        this.setStatus(status, reason);
        return status;
    }

    metadata(status) {
        const configuration = this.configuration;
        return {status, formatVersion: PATCH_VIDEO_FORMAT_VERSION, container: 'avi.gz', transportEncoding: 'gzip',
            videoCodec: 'DIB', pixelFormat: 'bgr24', frameRate: PATCH_VIDEO_FRAME_RATE,
            requestedCaptureMode: configuration.requestedMode, appliedCaptureMode: configuration.mode,
            roiProvider: 'mediapipe-face-detector', faceDetections: this.faceDetections,
            faceDetectionMisses: this.faceDetectionMisses, faceRoiSmoothingTauMs: configuration.faceRoiSmoothingTauMs,
            faceRoiScale: configuration.faceRoiScale, faceRoiVerticalShiftRatio: configuration.faceRoiVerticalShiftRatio,
            faceDetectionMinConfidence: configuration.faceDetectionMinConfidence,
            faceDetectionMinSuppressionThreshold: configuration.faceDetectionMinSuppressionThreshold,
            faceSelectionPolicy: 'largest-eligible-bounding-box-v1', noInitialFaceSkippedFrames: this.noInitialFaceSkippedFrames,
            extraction: {api: 'VideoFrame.copyTo', format: 'RGBX', colorSpace: 'srgb'},
            acceptedFrames: this.acceptedFrames, skippedFrames: this.skippedFrames};
    }

    setStatus(status, reason) {
        this.status = status;
        const metadata = {...this.metadata(status), reason: reason || null};
        if (status === RAW_PATCH_STATUS.UNSUPPORTED || status === RAW_PATCH_STATUS.INCOMPLETE) {
            console.error('[raw-patch] Capture ' + status + ': ' + (reason || 'unknown failure'), metadata);
        } else if (status === RAW_PATCH_STATUS.COMPLETE && metadata.acceptedFrames === 0) {
            console.warn('[raw-patch] Capture completed without an eligible face or output frames', metadata);
        }
        this.onStatus(metadata);
    }

    async closeWorker() {
        if (!this.worker) return;
        const worker = this.worker;
        this.worker = null;
        try { await worker.close(); }
        catch (error) { console.warn('[raw-patch] Worker cleanup failed', error); }
    }
}

function reportStatus(props, status, reason) {
    if (typeof props.onRawPatchStatus === 'function') props.onRawPatchStatus({status, reason: reason || null});
}

export function startRawPatchCaptureSession({webcam, props}) {
    const configuration = resolveRawPatchConfiguration();
    if (!shouldCaptureRawPatches(configuration, props.studyPage)) {
        console.info('[raw-patch] Capture disabled for this page', {mode: configuration.mode, studyPage: props.studyPage});
        return null;
    }
    const video = webcam && webcam.video;
    if (!video || !window.jatos || typeof window.jatos.uploadResultFile !== 'function') {
        reportStatus(props, RAW_PATCH_STATUS.INCOMPLETE, 'Video element or JATOS upload API is unavailable');
        return null;
    }
    const uploadTracker = {registerUpload: id => props.markVideoAsUploading(id), settleUpload: (id, status) =>
        status === UPLOAD_STATUS.SUCCEEDED ? props.markVideoAsUploaded(id) : props.markVideoAsFailed(id)};
    const controller = new RawPatchCaptureController({video, configuration, uploadTracker,
        studyResultId: props.studyResultId, studyPage: props.studyPage, videoCounter: props.videoCounter,
        uploadResultFile: (payload, filename) => window.jatos.uploadResultFile(payload, filename),
        onStatus: metadata => { if (typeof props.onRawPatchStatus === 'function') props.onRawPatchStatus(metadata); }});
    controller.start().catch(error => reportStatus(props, RAW_PATCH_STATUS.UNSUPPORTED,
        error.message || 'Raw patch capture failed to start'));
    return controller;
}

export async function stopRawPatchCaptureSession(controller) {
    if (controller) await controller.stop();
}
