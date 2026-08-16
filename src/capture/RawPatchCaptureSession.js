import {
    RAW_PATCH_STATUS,
    RawPatchCaptureController,
    resolveRawPatchConfiguration,
    shouldCaptureRawPatches
} from './RawPatchCaptureController';
import {UPLOAD_STATUS} from '../uploadState';

function reportStatus(props, status, reason) {
    if (typeof props.onRawPatchStatus === 'function') {
        props.onRawPatchStatus({status, reason: reason || null});
    }
}

/**
 * Creates the browser capture session selected by build-time configuration.
 */
export function startRawPatchCaptureSession({webcam, props}) {
    const configuration = resolveRawPatchConfiguration();
    if (!shouldCaptureRawPatches(configuration, props.studyPage)) {
        return null;
    }
    const video = webcam && webcam.video;
    if (!video || !window.jatos || typeof window.jatos.uploadResultFile !== 'function') {
        reportStatus(props, RAW_PATCH_STATUS.INCOMPLETE, 'Video element or JATOS upload API is unavailable');
        return null;
    }

    const uploadTracker = {
        registerUpload: uploadId => props.markVideoAsUploading(uploadId),
        settleUpload: (uploadId, status) => {
            if (status === UPLOAD_STATUS.SUCCEEDED) {
                props.markVideoAsUploaded(uploadId);
            } else {
                props.markVideoAsFailed(uploadId);
            }
        }
    };
    const controller = new RawPatchCaptureController({
        video,
        studyResultId: props.studyResultId,
        studyPage: props.studyPage,
        videoCounter: props.videoCounter,
        configuration,
        uploadTracker,
        uploadResultFile: (payload, filename) => window.jatos.uploadResultFile(payload, filename),
        onStatus: metadata => {
            if (typeof props.onRawPatchStatus === 'function') {
                props.onRawPatchStatus(metadata);
            }
        }
    });
    controller.start().catch(error => {
        reportStatus(props, RAW_PATCH_STATUS.UNSUPPORTED, error.message || 'Raw patch capture failed to start');
    });
    return controller;
}

export async function stopRawPatchCaptureSession(controller) {
    if (controller) {
        await controller.stop();
    }
}
