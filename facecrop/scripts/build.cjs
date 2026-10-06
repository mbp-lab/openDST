const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const vendor = path.join(root, 'vendor', 'tfjs');
const runtimePath = path.join(dist, 'tfjs', '4.22.0');

function compile(config) {
    return new Promise((resolve, reject) => {
        webpack(config, (error, stats) => {
            if (error) return reject(error);
            if (stats.hasErrors()) return reject(new Error(stats.toString({all: false, errors: true})));
            process.stdout.write(stats.toString({all: false, assets: true, timings: true}) + '\n');
            resolve();
        });
    });
}

function babelRule() {
    return {test: /\.js$/, exclude: /node_modules/, use: {loader: 'babel-loader'}};
}

function copyFile(sourceName, destinationName) {
    const source = path.join(root, sourceName);
    const destination = path.join(runtimePath, destinationName);
    if (!fs.existsSync(source)) throw new Error('Missing required facecrop asset: ' + source);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(source, destination);
}

async function main() {
    fs.rmSync(dist, {recursive: true, force: true});
    fs.mkdirSync(dist, {recursive: true});

    await compile({
        mode: 'production',
        entry: path.join(root, 'src', 'index.js'),
        output: {path: dist, filename: 'facecrop.js', library: 'Facecrop', libraryTarget: 'umd', globalObject: 'this', hashFunction: 'sha256'},
        module: {rules: [babelRule()]},
        optimization: {minimize: true, concatenateModules: false, minimizer: [new TerserPlugin({cache: false, parallel: false})]},
        performance: {hints: false}
    });
    await compile({
        mode: 'production',
        target: 'webworker',
        entry: path.join(root, 'src', 'FaceCropPipeline.worker.js'),
        output: {path: dist, filename: 'facecrop.worker.js', globalObject: 'self', hashFunction: 'sha256'},
        module: {rules: [babelRule()]},
        optimization: {minimize: true, concatenateModules: false, minimizer: [new TerserPlugin({cache: false, parallel: false})]},
        performance: {hints: false}
    });

    const tfjs = path.join(root, 'node_modules', '@tensorflow', 'tfjs', 'dist');
    const wasm = path.join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist');
    const blazeface = path.join(root, 'node_modules', '@tensorflow-models', 'blazeface', 'dist');
    [
        [path.join(tfjs, 'tf.min.js'), 'tf.min.js'],
        [path.join(wasm, 'tf-backend-wasm.min.js'), 'tf-backend-wasm.min.js'],
        [path.join(wasm, 'tfjs-backend-wasm.wasm'), 'tfjs-backend-wasm.wasm'],
        [path.join(wasm, 'tfjs-backend-wasm-simd.wasm'), 'tfjs-backend-wasm-simd.wasm'],
        [path.join(wasm, 'tfjs-backend-wasm-threaded-simd.wasm'), 'tfjs-backend-wasm-threaded-simd.wasm'],
        [path.join(blazeface, 'blazeface.min.umd.js'), 'blazeface.min.umd.js'],
        [path.join(vendor, 'blazeface-model', 'model.json'), 'model/model.json'],
        [path.join(vendor, 'blazeface-model', 'group1-shard1of1.bin'), 'model/group1-shard1of1.bin']
    ].forEach(([source, destination]) => copyFile(path.relative(root, source), destination));

    const apacheLicense = path.join(root, 'vendor', 'tfjs', 'LICENSE');
    fs.copyFileSync(apacheLicense, path.join(dist, 'APACHE-2.0.txt'));
    fs.writeFileSync(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), [
        'TensorFlow.js 4.22.0 and TensorFlow.js WASM backend 4.22.0',
        'Copyright The TensorFlow Authors. Licensed under Apache License 2.0.',
        'BlazeFace 0.1.0',
        'Copyright The TensorFlow Authors. Licensed under Apache License 2.0.',
        'BlazeFace model files are provided by TensorFlow.js Models under Apache License 2.0.',
        'The complete Apache License 2.0 text is in APACHE-2.0.txt.'
    ].join('\n') + '\n');

    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
    const libraryPackage = require(path.join(root, 'package.json'));
    const hash = crypto.createHash('sha256');
    function addTree(directory, prefix = '') {
        fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
            const absolute = path.join(directory, entry.name);
            const relative = path.posix.join(prefix, entry.name);
            if (entry.isDirectory()) return addTree(absolute, relative);
            hash.update(relative).update('\0').update(fs.readFileSync(absolute)).update('\0');
        });
    }
    addTree(dist);
    fs.writeFileSync(path.join(dist, 'asset-manifest.json'), JSON.stringify({
        schemaVersion: 1, libraryVersion: libraryPackage.version, assetDirectory: hash.digest('hex'),
        assetBaseRelativePath: './'
    }, null, 2) + '\n');
}

main().catch(error => {
    process.stderr.write((error.stack || String(error)) + '\n');
    process.exitCode = 1;
});
