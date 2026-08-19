/**
 * Vendors pinned MediaPipe runtime/model assets into public/mediapipe for same-origin loading.
 * Runs before start/build to keep browser capture dependencies local and version-stable.
 * Fails fast if package version or model checksum differ from pinned values.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TASKS_VISION_VERSION = '1.0.1';
const MODEL_SHA256 = 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f';
const VISION_BUNDLE_FILE = 'vision_bundle.js';
const WASM_FILES = [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm'
];
const root = path.resolve(__dirname, '..');
const tasksVisionRoot = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const modelSource = path.join(root, 'vendor', 'mediapipe', 'blaze_face_short_range.tflite');
const licenseSource = path.join(root, 'vendor', 'mediapipe', 'LICENSE');
const tasksVisionDestination = path.join(root, 'public', 'mediapipe', `tasks-vision-${TASKS_VISION_VERSION}`);
const wasmDestination = path.join(tasksVisionDestination, 'wasm');
const modelDestination = path.join(root, 'public', 'mediapipe', 'models', 'blaze_face_short_range.tflite');
const licenseDestination = path.join(root, 'public', 'mediapipe', 'LICENSE');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copy(source, destination) {
    if (!fs.existsSync(source)) {
        throw new Error(`Missing required MediaPipe asset: ${source}`);
    }
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(source, destination);
}

const packageMetadata = JSON.parse(fs.readFileSync(path.join(tasksVisionRoot, 'package.json'), 'utf8'));
// Pin package version and model digest to detect supply-chain drift before publishing assets.
if (packageMetadata.version !== TASKS_VISION_VERSION) {
    throw new Error(`Expected @mediapipe/tasks-vision ${TASKS_VISION_VERSION}, found ${packageMetadata.version}`);
}
if (sha256(modelSource) !== MODEL_SHA256) {
    throw new Error('Vendored BlazeFace model checksum does not match the pinned release');
}

WASM_FILES.forEach(file => copy(path.join(tasksVisionRoot, 'wasm', file), path.join(wasmDestination, file)));
copy(path.join(tasksVisionRoot, VISION_BUNDLE_FILE), path.join(tasksVisionDestination, VISION_BUNDLE_FILE));
copy(modelSource, modelDestination);
copy(licenseSource, licenseDestination);
console.log('Vendored MediaPipe Wasm runtime and BlazeFace model into public/mediapipe');
