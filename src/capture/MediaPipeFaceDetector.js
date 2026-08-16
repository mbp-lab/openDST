import {FaceDetector, FilesetResolver} from '@mediapipe/tasks-vision';

const PUBLIC_ASSET_ROOT = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

export const DEFAULT_MEDIAPIPE_WASM_URL =
    PUBLIC_ASSET_ROOT + '/mediapipe/tasks-vision-0.10.3/wasm';
export const DEFAULT_FACE_DETECTOR_MODEL_URL =
    PUBLIC_ASSET_ROOT + '/mediapipe/models/blaze_face_short_range.tflite';

export async function createMediaPipeFaceDetector({
    wasmUrl = process.env.REACT_APP_MEDIAPIPE_WASM_URL || DEFAULT_MEDIAPIPE_WASM_URL,
    modelUrl = process.env.REACT_APP_MEDIAPIPE_FACE_MODEL_URL || DEFAULT_FACE_DETECTOR_MODEL_URL
} = {}) {
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    return FaceDetector.createFromOptions(vision, {
        baseOptions: {modelAssetPath: modelUrl, delegate: 'CPU'},
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3
    });
}
