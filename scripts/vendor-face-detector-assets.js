/** Vendors pinned TFJS, WASM backend, BlazeFace, and model assets for same-origin worker loading. */
const fs = require('fs');
const path = require('path');

const TFJS_VERSION = '4.22.0';
const BLAZEFACE_VERSION = '0.1.0';
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'public', 'tfjs', TFJS_VERSION);
const assets = [
    ['node_modules/@tensorflow/tfjs/dist/tf.min.js', 'tf.min.js'],
    ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js', 'tf-backend-wasm.min.js'],
    ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', 'tfjs-backend-wasm.wasm'],
    ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-simd.wasm'],
    ['node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm'],
    ['node_modules/@tensorflow-models/blazeface/dist/blazeface.min.umd.js', 'blazeface.min.umd.js'],
    ['vendor/tfjs/blazeface-model/model.json', 'model/model.json'],
    ['vendor/tfjs/blazeface-model/group1-shard1of1.bin', 'model/group1-shard1of1.bin']
];

function packageVersion(name) {
    return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}
if (packageVersion('@tensorflow/tfjs') !== TFJS_VERSION || packageVersion('@tensorflow/tfjs-backend-wasm') !== TFJS_VERSION) {
    throw new Error('Expected TensorFlow.js runtime and WASM backend ' + TFJS_VERSION);
}
if (packageVersion('@tensorflow-models/blazeface') !== BLAZEFACE_VERSION) {
    throw new Error('Expected BlazeFace ' + BLAZEFACE_VERSION);
}
assets.forEach(([sourceName, destinationName]) => {
    const source = path.join(root, sourceName);
    const target = path.join(destination, destinationName);
    if (!fs.existsSync(source)) throw new Error('Missing required face detector asset: ' + source);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
});
console.log('Vendored TensorFlow.js WASM and BlazeFace assets into public/tfjs/' + TFJS_VERSION);
