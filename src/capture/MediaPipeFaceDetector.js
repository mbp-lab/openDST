import {FaceDetector, FilesetResolver} from '@mediapipe/tasks-vision';

const PUBLIC_ASSET_ROOT = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const MEDIAPIPE_WASM_URL =
    PUBLIC_ASSET_ROOT + '/mediapipe/tasks-vision-0.10.3/wasm';
const FACE_DETECTOR_MODEL_URL =
    PUBLIC_ASSET_ROOT + '/mediapipe/models/blaze_face_short_range.tflite';

export async function createMediaPipeFaceDetector({minDetectionConfidence = 0.5, minSuppressionThreshold = 0.3} = {}) {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
    return FaceDetector.createFromOptions(vision, {
        baseOptions: {modelAssetPath: FACE_DETECTOR_MODEL_URL, delegate: 'CPU'},
        runningMode: 'VIDEO',
        minDetectionConfidence,
        minSuppressionThreshold
    });
}
