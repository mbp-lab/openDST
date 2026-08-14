import {CameraRoiProvider} from './RoiProvider';
import {RawPatchProcessor} from './RawPatchProcessor';
import {RawPatchSegmenter} from './RawPatchPartAccumulator';
import {buildRawPatchManifest} from './RawPatchFormat';
import {JatosPatchSink} from './JatosPatchSink';

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

export function resolveRawPatchConfiguration(environment = process.env) {
    const requestedMode = environment.REACT_APP_RAW_PATCH_CAPTURE || 'off';
    const requestedRoiCoordinates = environment.REACT_APP_PATCH_ROI_COORDINATES || 'camera';

    return {
        requestedMode,
        mode: RAW_PATCH_CAPTURE_MODES.includes(requestedMode) ? requestedMode : 'off',
        requestedRoiCoordinates,
        roiCoordinates: RAW_PATCH_ROI_COORDINATES.includes(requestedRoiCoordinates) ? requestedRoiCoordinates : 'camera'
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
        return {supported: false, reason: 'CompressionStream is unavailable'};
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
    constructor({video, studyResultId, studyPage, videoCounter, configuration, uploadTracker, uploadResultFile, onStatus}) {
        this.video = video;
        this.studyResultId = studyResultId;
        this.studyPage = studyPage;
        this.videoCounter = videoCounter;
        this.configuration = configuration;
        this.uploadTracker = uploadTracker;
        this.uploadResultFile = uploadResultFile;
        this.onStatus = onStatus || (() => {});
        this.roiProvider = new CameraRoiProvider();
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
    }

    async start() {
        if (this.configuration.roiCoordinates === 'face') {
            this.setStatus(RAW_PATCH_STATUS.UNSUPPORTED, 'Face ROI is not implemented');
            return this.status;
        }

        const capability = await probeRawPatchCapability(this.video);
        if (!capability.supported) {
            this.setStatus(RAW_PATCH_STATUS.UNSUPPORTED, capability.reason);
            return this.status;
        }
        if (!sourceIsSupported(sourceDimensions(this.video))) {
            this.setStatus(RAW_PATCH_STATUS.INCOMPLETE, 'Source dimensions are outside supported bounds');
            return this.status;
        }

        this.setStatus(RAW_PATCH_STATUS.CAPTURING);
        this.registerCallback();
        return this.status;
    }

    async stop() {
        if (this.status === RAW_PATCH_STATUS.DISABLED || this.status === RAW_PATCH_STATUS.UNSUPPORTED) {
            return this.status;
        }
        this.deactivate();
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
            frame = new window.VideoFrame(this.video, {timestamp: sourceTimestampUs});
            const rgbx = new Uint8Array(dimensions.width * dimensions.height * 4);
            await frame.copyTo(rgbx, {format: 'RGBX', colorSpace: 'srgb'});
            if (generation !== this.generation || this.status !== RAW_PATCH_STATUS.CAPTURING) {
                return;
            }

            const roi = this.roiProvider.getRoi(dimensions);
            const rgb24 = this.processor.process({...dimensions, rgbx, roi});
            const sealedParts = this.segmenter.appendFrame({
                rgb24,
                timestampUs: sourceTimestampUs,
                sourceWidth: dimensions.width,
                sourceHeight: dimensions.height,
                roi
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
                const result = await this.sink.finalize(partResults => {
                    const partFailure = partResults.some(part => part.status !== 'succeeded');
                    if (partFailure) {
                        this.incompleteReason = 'One or more raw patch part uploads failed';
                    }
                    const manifest = buildRawPatchManifest({
                        studyResultId: this.studyResultId,
                        studyPage: this.studyPage,
                        videoCounter: this.videoCounter,
                        segments: this.segmenter.getSegments(),
                        capture: this.captureMetadata(partFailure ? RAW_PATCH_STATUS.INCOMPLETE : RAW_PATCH_STATUS.COMPLETE)
                    });
                    return manifest;
                });
                const finalStatus = this.status === RAW_PATCH_STATUS.INCOMPLETE || result.manifest.status !== 'succeeded'
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
            requestedCaptureMode: this.configuration.requestedMode,
            appliedCaptureMode: this.configuration.mode,
            requestedRoiCoordinates: this.configuration.requestedRoiCoordinates,
            appliedRoiCoordinates: 'camera',
            extraction: {api: 'VideoFrame.copyTo', format: 'RGBX', colorSpace: 'srgb'},
            acceptedFrames: this.acceptedFrames,
            skippedFrames: this.skippedFrames
        };
    }

    setStatus(status, reason) {
        this.status = status;
        this.onStatus({...this.captureMetadata(status), reason: reason || null});
    }
}
