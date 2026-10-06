const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const {verifyDistribution} = require('./verify-distribution.cjs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const vendor = path.join(root, 'vendor', 'tfjs');
let outputRoot;
const runtimePath = () => path.join(outputRoot, 'tfjs', '4.22.0');

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
    const destination = path.join(runtimePath(), destinationName);
    if (!fs.existsSync(source)) throw new Error('Missing required facecrop asset: ' + source);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(source, destination);
}

function replaceDirectory(staged, destination, rename = fs.renameSync) {
    const backup = `${destination}.previous-${process.pid}-${Date.now()}`;
    const hadPrevious = fs.existsSync(destination);
    if (hadPrevious) rename(destination, backup);
    try {
        rename(staged, destination);
    } catch (error) {
        if (hadPrevious && !fs.existsSync(destination)) {
            try { rename(backup, destination); }
            catch (recoveryError) {
                error.recoveryPath = backup;
                error.message += `. Could not restore previous distribution; backup remains at ${backup}: ${recoveryError.message}`;
            }
        }
        throw error;
    }
    fs.rmSync(backup, {recursive: true, force: true});
}

async function main() {
    const lockDirectory = path.join(root, '.facecrop-build.lock');
    let ownsLock = false;
    try {
        try { fs.mkdirSync(lockDirectory); ownsLock = true; }
        catch (_) { throw new Error('Another facecrop build appears to be running (.facecrop-build.lock exists)'); }
        outputRoot = fs.mkdtempSync(path.join(root, '.facecrop-build-'));
        await compile({
            mode: 'production',
            entry: path.join(root, 'src', 'index.js'),
            output: {path: outputRoot, filename: 'facecrop.js', library: 'Facecrop', libraryTarget: 'umd', globalObject: 'this', hashFunction: 'sha256'},
            module: {rules: [babelRule()]},
            optimization: {minimize: true, concatenateModules: false, minimizer: [new TerserPlugin({cache: false, parallel: false})]},
            performance: {hints: false}
        });
        await compile({
            mode: 'production',
            target: 'webworker',
            entry: path.join(root, 'src', 'FaceCropPipeline.worker.js'),
            output: {path: outputRoot, filename: 'facecrop.worker.js', globalObject: 'self', hashFunction: 'sha256'},
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
        fs.copyFileSync(apacheLicense, path.join(outputRoot, 'APACHE-2.0.txt'));
        fs.writeFileSync(path.join(outputRoot, 'THIRD_PARTY_NOTICES.txt'), [
            'TensorFlow.js 4.22.0 and TensorFlow.js WASM backend 4.22.0',
            'Copyright The TensorFlow Authors. Licensed under Apache License 2.0.',
            'BlazeFace 0.1.0',
            'Copyright The TensorFlow Authors. Licensed under Apache License 2.0.',
            'BlazeFace model files are provided by TensorFlow.js Models under Apache License 2.0.',
            'The complete Apache License 2.0 text is in APACHE-2.0.txt.'
        ].join('\n') + '\n');

        fs.copyFileSync(path.join(root, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
        const libraryPackage = require(path.join(root, 'package.json'));
        const {digestTree, expectedFiles} = require('./verify-distribution.cjs');
        const digest = digestTree(outputRoot, expectedFiles().filter(file => file !== 'asset-manifest.json'));
        fs.writeFileSync(path.join(outputRoot, 'asset-manifest.json'), JSON.stringify({
            schemaVersion: 1, libraryVersion: libraryPackage.version, assetDirectory: digest,
            assetBaseRelativePath: './'
        }, null, 2) + '\n');

        verifyDistribution(outputRoot);
        replaceDirectory(outputRoot, dist);
        outputRoot = null;
        process.stdout.write(`Validated facecrop distribution ${digest}\n`);
    } finally {
        if (outputRoot) fs.rmSync(outputRoot, {recursive: true, force: true});
        if (ownsLock) fs.rmSync(lockDirectory, {recursive: true, force: true});
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write((error.stack || String(error)) + '\n');
        process.exitCode = 1;
    });
}

module.exports = {replaceDirectory};
