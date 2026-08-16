import {FaceRoiProvider} from './FaceRoiProvider';
import {RawPatchProcessor} from './RawPatchProcessor';
import {RawPatchSegmenter} from './RawPatchPartAccumulator';
import {PATCH_VIDEO_FORMAT_VERSION, PATCH_VIDEO_FRAME_RATE} from './AviPatchVideoFormat';
import {JatosPatchSink} from './JatosPatchSink';
import {createMediaPipeFaceDetector} from './MediaPipeFaceDetector';

export const RAW_PATCH_CAPTURE_MODES = ['off', 'calibration', 'all'];
export const RAW_PATCH_STATUS = {
    DISABLED: 'disabled',
    UNSUPPORTED: 'unsupported',
    CAPTURING: 'capturing',
    COMPLETE: 'complete',
    INCOMPLETE: 'incomplete'
};

const MAX_SOURCE_WIDTH = 1920;
const MAX_SOURCE_HEIGHT = 1080;
export const DEFAULT_FACE_ROI_SMOOTHING_TAU_MS = 100;
export const DEFAULT_FACE_ROI_SCALE = 1.5;
export const DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO = 0.15;
const MAX_FACE_ROI_SMOOTHING_TAU_MS = 10000;
const MAX_FACE_ROI_SCALE = 3;
const MAX_FACE_ROI_VERTICAL_SHIFT_RATIO = 1;

function resolveFaceRoiSmoothingTauMs(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_FACE_ROI_SMOOTHING_TAU_MS
        ? parsed
        : DEFAULT_FACE_ROI_SMOOTHING_TAU_MS;
}

function resolveFaceRoiScale(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_FACE_ROI_SCALE
        ? parsed
        : DEFAULT_FACE_ROI_SCALE;
}

function resolveFaceRoiVerticalShiftRatio(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= -MAX_FACE_ROI_VERTICAL_SHIFT_RATIO && parsed <= MAX_FACE_ROI_VERTICAL_SHIFT_RATIO
        ? parsed
        : DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO;
}

export function resolveRawPatchConfiguration(environment = process.env) {
    const requestedMode = environment.REACT_APP_FACE_CROP_RECORDING_MODE || 'off';

    return {
        requestedMode,
        mode: RAW_PATCH_CAPTURE_MODES.includes(requestedMode) ? requestedMode : 'off',
        faceRoiSmoothingTauMs: resolveFaceRoiSmoothingTauMs(environment.REACT_APP_FACE_CROP_SMOOTHING_TAU_MS),
        faceRoiScale: resolveFaceRoiScale(environment.REACT_APP_FACE_CROP_SCALE),
        faceRoiVerticalShiftRatio: resolveFaceRoiVerticalShiftRatio(environment.REACT_APP_FACE_CROP_VERTICAL_SHIFT_RATIO)
    };
}

export function shouldCaptureRawPatches(configuration, studyPage) {
    return configuration.mode === 'all' || (configuration.mode === 'calibration' && studyPage === 'introduction');
}

function sourceDimensions(video) {
    return {width: video.videoWidth, height: video.videoHeight};
}

function sourceIsSupported({width, height}) {
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 72 && height >= 72 &&
        width <= MAX_SOURCE_WIDTH && height <= MAX_SOURCE_HEIGHT;
}

function timestampUs(metadata) {
    return Math.round(metadata.mediaTime * 1000000);
}

/**
 * Runs the functional browser API probe required before scientific capture.
 */
export async function probeRawPatchCapability(video) {
    if (!video || typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') {
        return {supported: false, reason: 'requestVideoFrameCallback is unavailable'};
    }
    if (typeof window.VideoFrame !== 'function') {
        return {supported: false, reason: 'VideoFrame is unavailable'};
    }
    if (typeof window.CompressionStream !== 'function') {
        return {supported: false, reason: 'Native CompressionStream is unavailable'};
    }

    let frame;
    try {
        frame = new window.VideoFrame(video);
        const bytes = new Uint8Array(frame.displayWidth * frame.displayHeight * 4);
        await frame.copyTo(bytes, {format: 'RGBX', colorSpace: 'srgb'});
        return {supported: true};
    } catch (error) {
        return {supported: false, reason: error.message || 'VideoFrame RGBX/sRGB extraction failed'};
    } finally {
        if (frame) {
            frame.close();
        }
    }
}

/**
 * Coordinates requestVideoFrameCallback capture without owning UI or recorder state.
 */
export class RawPatchCaptureController {
    constructor({video, studyResultId, studyPage, videoCounter, configuration, uploadTracker, uploadResultFile, onStatus,
        createFaceDetector = createMediaPipeFaceDetector}) {
        this.video = video;
        this.studyResultId = studyResultId;
        this.studyPage = studyPage;
        this.videoCounter = videoCounter;
        this.configuration = configuration;
        this.uploadTracker = uploadTracker;
        this.uploadResultFile = uploadResultFile;
        this.onStatus = onStatus || (() => {});
        this.faceRoiSmoothingTauMs = Number.isSafeInteger(configuration.faceRoiSmoothingTauMs)
            ? configuration.faceRoiSmoothingTauMs
            : DEFAULT_FACE_ROI_SMOOTHING_TAU_MS;
        this.faceRoiScale = Number.isFinite(configuration.faceRoiScale)
            ? configuration.faceRoiScale
            : DEFAULT_FACE_ROI_SCALE;
        this.faceRoiVerticalShiftRatio = Number.isFinite(configuration.faceRoiVerticalShiftRatio)
            ? configuration.faceRoiVerticalShiftRatio
            : DEFAULT_FACE_ROI_VERTICAL_SHIFT_RATIO;
        this.roiProvider = new FaceRoiProvider({
            smoothingTauMs: this.faceRoiSmoothingTauMs,
            scale: this.faceRoiScale,
            verticalShiftRatio: this.faceRoiVerticalShiftRatio
        });
        this.createFaceDetector = createFaceDetector;
        this.faceDetector = null;
        this.processor = new RawPatchProcessor();
        this.segmenter = new RawPatchSegmenter({studyResultId, studyPage, videoCounter});
        this.sink = new JatosPatchSink({uploadResultFile, uploadTracker});
        this.status = RAW_PATCH_STATUS.DISABLED;
        this.acceptedFrames = 0;
        this.skippedFrames = 0;
        this.frameWait = null;
        this.captureLoop = null;
        this.stopped = false;
        this.finalization = null;
        this.incompleteReason = null;
        this.starting = null;
        this.lastPresentedFrame = null;
        this.faceDetections = 0;
        this.faceDetectionMisses = 0;
    }

    start() {
        if (!this.starting) {
            this.starting = this.startInternal();
        }
        return this.starting;
    }

    async startInternal() {
        const capability = await probeRawPatchCapability(this.video);
        if (this.stopped) {
            return this.status;
        }
        if (!capability.supported) {
            this.setStatus(RAW_PATCH_STATUS.UNSUPPORTED, capability.reason);
            return this.status;
        }
        if (!sourceIsSupported(sourceDimensions(this.video))) {
            this.setStatus(RAW_PATCH_STATUS.INCOMPLETE, 'Source dimensions are outside supported bounds');
            return this.status;
        }

        try {
            this.faceDetector = await this.createFaceDetector();
        } catch (error) {
            this.setStatus(RAW_PATCH_STATUS.UNSUPPORTED, error.message || 'MediaPipe face detector initialization failed');
            return this.status;
        }
        if (this.stopped) {
            this.closeFaceDetector();
            return this.status;
        }

        this.setStatus(RAW_PATCH_STATUS.CAPTURING);
        this.captureLoop = this.captureFrames();
        return this.status;
    }

    async stop() {
        this.stopped = true;
        this.cancelPendingFrame();
        if (this.starting) {
            await this.starting;
        }
        if (this.captureLoop) {
            await this.captureLoop;
        }
        if (this.status === RAW_PATCH_STATUS.DISABLED || this.status === RAW_PATCH_STATUS.UNSUPPORTED) {
            this.closeFaceDetector();
            return this.status;
        }
        return this.finalize();
    }

    async captureFrames() {
        try {
            while (!this.stopped && this.status === RAW_PATCH_STATUS.CAPTURING) {
                const metadata = await this.waitForFrame();
                if (!metadata || this.stopped || this.status !== RAW_PATCH_STATUS.CAPTURING) {
                    break;
                }
                this.recordSkippedFrames(metadata);
                await this.processFrame(metadata);
            }
        } catch (error) {
            this.markIncomplete(error.message || 'Raw patch frame processing failed');
        }
        if (this.status === RAW_PATCH_STATUS.INCOMPLETE) {
            await this.finalize();
        }
    }

    waitForFrame() {
        return new Promise(resolve => {
            const callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
                if (!this.frameWait || this.frameWait.callbackId !== callbackId) {
                    return;
                }
                this.frameWait = null;
                resolve(metadata);
            });
            this.frameWait = {callbackId, resolve};
        });
    }

    cancelPendingFrame() {
        if (!this.frameWait) {
            return;
        }
        const frameWait = this.frameWait;
        this.frameWait = null;
        this.video.cancelVideoFrameCallback(frameWait.callbackId);
        frameWait.resolve(null);
    }

    recordSkippedFrames(metadata) {
        if (!Number.isSafeInteger(metadata.presentedFrames)) {
            return;
        }
        if (this.lastPresentedFrame !== null) {
            this.skippedFrames += Math.max(0, metadata.presentedFrames - this.lastPresentedFrame - 1);
        }
        this.lastPresentedFrame = metadata.presentedFrames;
    }

    async processFrame(metadata) {
        let frame;
        try {
            const dimensions = sourceDimensions(this.video);
            if (!sourceIsSupported(dimensions)) {
                this.markIncomplete('Source dimensions changed outside supported bounds');
                return;
            }

            const sourceTimestampUs = timestampUs(metadata);
            const result = this.faceDetector.detectForVideo(this.video, sourceTimestampUs / 1000);
            const roi = this.roiProvider.getRoi({...dimensions, detections: result.detections, timestampMs: sourceTimestampUs / 1000});
            if (!roi) {
                this.faceDetectionMisses += 1;
                return;
            }
            if (result.detections && result.detections.length > 0) {
                this.faceDetections += 1;
            } else {
                this.faceDetectionMisses += 1;
            }
            frame = new window.VideoFrame(this.video, {timestamp: sourceTimestampUs});
            const rgbx = new Uint8Array(dimensions.width * dimensions.height * 4);
            await frame.copyTo(rgbx, {format: 'RGBX', colorSpace: 'srgb'});
            if (this.stopped || this.status !== RAW_PATCH_STATUS.CAPTURING) {
                return;
            }

            const bgr24 = this.processor.process({...dimensions, rgbx, roi});
            this.enqueueSealedParts(this.segmenter.appendFrame({
                bgr24,
                sourceWidth: dimensions.width,
                sourceHeight: dimensions.height,
                roi
            }));
            this.acceptedFrames += 1;
        } catch (error) {
            this.markIncomplete(error.message || 'Raw patch frame processing failed');
        } finally {
            if (frame) {
                frame.close();
            }
        }
    }

    enqueueSealedParts(parts) {
        for (const part of parts) {
            try {
                this.sink.enqueuePart(part);
            } catch (error) {
                part.bytes = null;
                this.markIncomplete(error.message || 'Raw patch upload queue overflow');
                return;
            }
        }
    }

    markIncomplete(reason) {
        if (this.status === RAW_PATCH_STATUS.CAPTURING) {
            this.incompleteReason = reason;
            this.stopped = true;
            this.cancelPendingFrame();
            this.setStatus(RAW_PATCH_STATUS.INCOMPLETE, reason);
        }
    }

    finalize() {
        if (!this.finalization) {
            this.finalization = (async () => {
                this.enqueueSealedParts(this.segmenter.finish());
                const result = await this.sink.finalize();
                this.closeFaceDetector();
                const partFailure = result.parts.some(part => part.status !== 'succeeded');
                if (partFailure) {
                    this.incompleteReason = 'One or more patch-video uploads failed';
                }
                const finalStatus = this.status === RAW_PATCH_STATUS.INCOMPLETE || partFailure
                    ? RAW_PATCH_STATUS.INCOMPLETE
                    : RAW_PATCH_STATUS.COMPLETE;
                this.setStatus(finalStatus, this.incompleteReason);
                return finalStatus;
            })();
        }
        return this.finalization;
    }

    captureMetadata(status) {
        return {
            status,
            formatVersion: PATCH_VIDEO_FORMAT_VERSION,
            container: 'avi.gz',
            transportEncoding: 'gzip',
            videoCodec: 'DIB',
            pixelFormat: 'bgr24',
            frameRate: PATCH_VIDEO_FRAME_RATE,
            requestedCaptureMode: this.configuration.requestedMode,
            appliedCaptureMode: this.configuration.mode,
            roiProvider: 'mediapipe-face-detector',
            faceDetections: this.faceDetections,
            faceDetectionMisses: this.faceDetectionMisses,
            faceRoiSmoothingTauMs: this.faceRoiSmoothingTauMs,
            faceRoiScale: this.faceRoiScale,
            faceRoiVerticalShiftRatio: this.faceRoiVerticalShiftRatio,
            extraction: {api: 'VideoFrame.copyTo', format: 'RGBX', colorSpace: 'srgb'},
            acceptedFrames: this.acceptedFrames,
            skippedFrames: this.skippedFrames
        };
    }

    setStatus(status, reason) {
        this.status = status;
        this.onStatus({...this.captureMetadata(status), reason: reason || null});
    }

    closeFaceDetector() {
        if (this.faceDetector) {
            this.faceDetector.close();
            this.faceDetector = null;
        }
    }
}
