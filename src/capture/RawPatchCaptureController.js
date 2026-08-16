import {CameraRoiProvider, FaceRoiProvider} from './RoiProvider';
import {RawPatchProcessor} from './RawPatchProcessor';
import {RawPatchSegmenter} from './RawPatchPartAccumulator';
import {PATCH_VIDEO_FORMAT_VERSION, PATCH_VIDEO_FRAME_RATE} from './AviPatchVideoFormat';
import {JatosPatchSink} from './JatosPatchSink';
import {createMediaPipeFaceDetector} from './MediaPipeFaceDetector';

export const RAW_PATCH_CAPTURE_MODES = ['off', 'calibration', 'all'];
export const RAW_PATCH_ROI_COORDINATES = ['camera', 'face'];
export const RAW_PATCH_STATUS = {
    DISABLED: 'disabled',
    UNSUPPORTED: 'unsupported',
    CAPTURING: 'capturing',
    COMPLETE: 'complete',
    INCOMPLETE: 'incomplete'
};

const MAX_SOURCE_WIDTH = 1920;
const MAX_SOURCE_HEIGHT = 1080;
export const DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS = 167;
export const DEFAULT_FACE_ROI_SCALE = 1.5;
export const DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO = 0.15;
const MAX_FACE_ROI_SMOOTHING_WINDOW_MS = 10000;
const MAX_FACE_ROI_SCALE = 3;
const MAX_FACE_ROI_UPWARD_OFFSET_RATIO = 0.5;

function resolveFaceRoiSmoothingWindowMs(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_FACE_ROI_SMOOTHING_WINDOW_MS
        ? parsed
        : DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS;
}

function resolveFaceRoiScale(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_FACE_ROI_SCALE
        ? parsed
        : DEFAULT_FACE_ROI_SCALE;
}

function resolveFaceRoiUpwardOffsetRatio(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_FACE_ROI_UPWARD_OFFSET_RATIO
        ? parsed
        : DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO;
}

export function resolveRawPatchConfiguration(environment = process.env) {
    const requestedMode = environment.REACT_APP_RAW_PATCH_CAPTURE || 'off';
    const requestedRoiCoordinates = environment.REACT_APP_PATCH_ROI_COORDINATES || 'camera';
    const requestedFaceRoiSmoothingWindowMs = environment.REACT_APP_FACE_ROI_SMOOTHING_WINDOW_MS;
    const requestedFaceRoiScale = environment.REACT_APP_FACE_ROI_SCALE;
    const requestedFaceRoiUpwardOffsetRatio = environment.REACT_APP_FACE_ROI_UPWARD_OFFSET_RATIO;

    return {
        requestedMode,
        mode: RAW_PATCH_CAPTURE_MODES.includes(requestedMode) ? requestedMode : 'off',
        requestedRoiCoordinates,
        roiCoordinates: RAW_PATCH_ROI_COORDINATES.includes(requestedRoiCoordinates) ? requestedRoiCoordinates : 'camera',
        requestedFaceRoiSmoothingWindowMs,
        faceRoiSmoothingWindowMs: resolveFaceRoiSmoothingWindowMs(requestedFaceRoiSmoothingWindowMs),
        requestedFaceRoiScale,
        faceRoiScale: resolveFaceRoiScale(requestedFaceRoiScale),
        requestedFaceRoiUpwardOffsetRatio,
        faceRoiUpwardOffsetRatio: resolveFaceRoiUpwardOffsetRatio(requestedFaceRoiUpwardOffsetRatio)
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
        this.faceRoiSmoothingWindowMs = Number.isSafeInteger(configuration.faceRoiSmoothingWindowMs)
            ? configuration.faceRoiSmoothingWindowMs
            : DEFAULT_FACE_ROI_SMOOTHING_WINDOW_MS;
        this.faceRoiScale = Number.isFinite(configuration.faceRoiScale)
            ? configuration.faceRoiScale
            : DEFAULT_FACE_ROI_SCALE;
        this.faceRoiUpwardOffsetRatio = Number.isFinite(configuration.faceRoiUpwardOffsetRatio)
            ? configuration.faceRoiUpwardOffsetRatio
            : DEFAULT_FACE_ROI_UPWARD_OFFSET_RATIO;
        this.roiProvider = configuration.roiCoordinates === 'face'
            ? new FaceRoiProvider({
                smoothingWindowMs: this.faceRoiSmoothingWindowMs,
                scale: this.faceRoiScale,
                upwardOffsetRatio: this.faceRoiUpwardOffsetRatio
            })
            : new CameraRoiProvider();
        this.createFaceDetector = createFaceDetector;
        this.faceDetector = null;
        this.processor = new RawPatchProcessor();
        this.segmenter = new RawPatchSegmenter({studyResultId, studyPage, videoCounter});
        this.sink = new JatosPatchSink({uploadResultFile, uploadTracker});
        this.status = RAW_PATCH_STATUS.DISABLED;
        this.acceptedFrames = 0;
        this.skippedFrames = 0;
        this.callbackId = null;
        this.generation = 0;
        this.copyInFlight = false;
        this.finalization = null;
        this.incompleteReason = null;
        this.starting = null;
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
        const generation = this.generation;
        const capability = await probeRawPatchCapability(this.video);
        if (generation !== this.generation) {
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

        if (this.configuration.roiCoordinates === 'face') {
            try {
                this.faceDetector = await this.createFaceDetector();
            } catch (error) {
                this.setStatus(RAW_PATCH_STATUS.UNSUPPORTED, error.message || 'MediaPipe face detector initialization failed');
                return this.status;
            }
            if (generation !== this.generation) {
                this.closeFaceDetector();
                return this.status;
            }
        }

        this.setStatus(RAW_PATCH_STATUS.CAPTURING);
        this.registerCallback();
        return this.status;
    }

    async stop() {
        this.deactivate();
        if (this.starting) {
            await this.starting;
        }
        this.deactivate();
        if (this.status === RAW_PATCH_STATUS.DISABLED || this.status === RAW_PATCH_STATUS.UNSUPPORTED) {
            this.closeFaceDetector();
            return this.status;
        }
        return this.finalizeWhenIdle();
    }

    registerCallback() {
        const generation = this.generation;
        this.callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
            if (generation !== this.generation || this.status !== RAW_PATCH_STATUS.CAPTURING) {
                return;
            }
            this.registerCallback();
            if (this.copyInFlight) {
                this.skippedFrames += 1;
                return;
            }
            this.copyFrame(metadata, generation);
        });
    }

    async copyFrame(metadata, generation) {
        this.copyInFlight = true;
        let frame;
        try {
            const dimensions = sourceDimensions(this.video);
            if (!sourceIsSupported(dimensions)) {
                this.markIncomplete('Source dimensions changed outside supported bounds');
                return;
            }

            const sourceTimestampUs = timestampUs(metadata);
            let roi;
            if (this.faceDetector) {
                const result = this.faceDetector.detectForVideo(this.video, sourceTimestampUs / 1000);
                roi = this.roiProvider.getRoi({...dimensions, detections: result.detections, timestampMs: sourceTimestampUs / 1000});
                if (!roi) {
                    this.faceDetectionMisses += 1;
                    return;
                }
                if (result.detections && result.detections.length > 0) {
                    this.faceDetections += 1;
                } else {
                    this.faceDetectionMisses += 1;
                }
            } else {
                roi = this.roiProvider.getRoi(dimensions);
            }
            frame = new window.VideoFrame(this.video, {timestamp: sourceTimestampUs});
            const rgbx = new Uint8Array(dimensions.width * dimensions.height * 4);
            await frame.copyTo(rgbx, {format: 'RGBX', colorSpace: 'srgb'});
            if (generation !== this.generation || this.status !== RAW_PATCH_STATUS.CAPTURING) {
                return;
            }

            const rgb24 = this.processor.process({...dimensions, rgbx, roi});
            const sealedParts = this.segmenter.appendFrame({
                rgb24,
                sourceWidth: dimensions.width,
                sourceHeight: dimensions.height,
                roi,
                dynamicRoi: this.configuration.roiCoordinates === 'face'
            });
            this.enqueueSealedParts(sealedParts);
            this.acceptedFrames += 1;
        } catch (error) {
            this.markIncomplete(error.message || 'Raw patch frame processing failed');
        } finally {
            if (frame) {
                frame.close();
            }
            this.copyInFlight = false;
            if (this.status === RAW_PATCH_STATUS.INCOMPLETE) {
                this.finalizeWhenIdle();
            }
        }
    }

    enqueueSealedParts(parts) {
        parts.forEach(part => {
            try {
                this.sink.enqueuePart(part);
            } catch (error) {
                part.bytes = null;
                this.markIncomplete(error.message || 'Raw patch upload queue overflow');
            }
        });
    }

    deactivate() {
        this.generation += 1;
        if (this.callbackId !== null) {
            this.video.cancelVideoFrameCallback(this.callbackId);
            this.callbackId = null;
        }
    }

    markIncomplete(reason) {
        if (this.status === RAW_PATCH_STATUS.CAPTURING) {
            this.incompleteReason = reason;
            this.deactivate();
            this.setStatus(RAW_PATCH_STATUS.INCOMPLETE, reason);
        }
    }

    finalizeWhenIdle() {
        if (this.finalization) {
            return this.finalization;
        }

        this.finalization = new Promise(resolve => {
            const finalize = async () => {
                const finalParts = this.segmenter.finish();
                this.enqueueSealedParts(finalParts);
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
                resolve(finalStatus);
            };

            if (this.copyInFlight) {
                const waitForCopy = () => {
                    if (this.copyInFlight) {
                        setTimeout(waitForCopy, 0);
                    } else {
                        finalize();
                    }
                };
                waitForCopy();
            } else {
                finalize();
            }
        });

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
            requestedRoiCoordinates: this.configuration.requestedRoiCoordinates,
            appliedRoiCoordinates: this.configuration.roiCoordinates,
            roiProvider: this.configuration.roiCoordinates === 'face' ? 'mediapipe-face-detector' : 'centered-camera',
            faceDetections: this.faceDetections,
            faceDetectionMisses: this.faceDetectionMisses,
            faceRoiSmoothingWindowMs: this.faceRoiSmoothingWindowMs,
            faceRoiScale: this.faceRoiScale,
            faceRoiUpwardOffsetRatio: this.faceRoiUpwardOffsetRatio,
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
