/** Build facecrop independently, then stage its browser distribution for CRA/JATOS. */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(appRoot, 'facecrop');
const generatedDirectory = path.join(appRoot, 'src', 'faceCrop', 'generated');
const generatedEntry = path.join(generatedDirectory, 'facecrop.js');
const publicRoot = path.join(appRoot, 'public', 'facecrop');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function packageVersion(packageName) {
    try { return require(path.join(packageRoot, 'node_modules', packageName, 'package.json')).version; }
    catch (_) { return null; }
}
function requireInstalledPackage(name, expectedVersion) {
    if (packageVersion(name) !== expectedVersion) {
        execFileSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: packageRoot, stdio: 'inherit'});
    }
}
function copyTree(source, destination) {
    fs.rmSync(destination, {recursive: true, force: true});
    fs.cpSync(source, destination, {recursive: true});
}

['webpack:4.42.0', '@tensorflow/tfjs:4.22.0', '@tensorflow/tfjs-backend-wasm:4.22.0',
    '@tensorflow-models/blazeface:0.1.0'].forEach(pair => {
    const separator = pair.lastIndexOf(':');
    requireInstalledPackage(pair.slice(0, separator), pair.slice(separator + 1));
});
execFileSync(npm, ['run', 'build'], {cwd: packageRoot, stdio: 'inherit'});

const distRoot = path.join(packageRoot, 'dist');
if (!fs.existsSync(path.join(distRoot, 'facecrop.js')) || !fs.existsSync(path.join(distRoot, 'facecrop.worker.js'))) {
    throw new Error('Facecrop build did not produce its UMD library and classic worker');
}
const assetManifest = JSON.parse(fs.readFileSync(path.join(distRoot, 'asset-manifest.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(assetManifest.assetDirectory)) throw new Error('Facecrop asset hash is invalid');
fs.mkdirSync(generatedDirectory, {recursive: true});
fs.writeFileSync(generatedEntry, '/* eslint-disable */\n' + fs.readFileSync(path.join(distRoot, 'facecrop.js'), 'utf8'));
fs.writeFileSync(path.join(generatedDirectory, 'facecropAssets.json'), JSON.stringify({
    publicSubpath: '/facecrop/' + assetManifest.assetDirectory + '/'
}, null, 2) + '\n');
fs.rmSync(publicRoot, {recursive: true, force: true});
copyTree(distRoot, path.join(publicRoot, assetManifest.assetDirectory));
console.log('Staged standalone facecrop distribution at /facecrop/' + assetManifest.assetDirectory + '/');
