const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const packageInfo = require(path.join(PACKAGE_ROOT, 'package.json'));
const TFJS_VERSION = packageInfo.devDependencies['@tensorflow/tfjs'];

function listFiles(root, relative = '') {
    const absolute = path.join(root, relative);
    return fs.readdirSync(absolute, {withFileTypes: true})
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap(entry => {
            const child = path.posix.join(relative, entry.name);
            const childPath = path.join(root, child);
            if (entry.isSymbolicLink()) throw new Error(`Distribution contains a symbolic link: ${child}`);
            if (entry.isDirectory()) return listFiles(root, child);
            if (!entry.isFile()) throw new Error(`Distribution contains a non-file asset: ${child}`);
            return [child];
        });
}

function digestTree(root, files) {
    const hash = crypto.createHash('sha256');
    files.filter(file => file !== 'asset-manifest.json').forEach(relative => {
        hash.update(relative).update('\0').update(fs.readFileSync(path.join(root, relative))).update('\0');
    });
    return hash.digest('hex');
}

function expectedFiles() {
    const runtime = `tfjs/${TFJS_VERSION}/`;
    return [
        'APACHE-2.0.txt', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'asset-manifest.json',
        'facecrop.js', 'facecrop.worker.js',
        `${runtime}blazeface.min.umd.js`, `${runtime}model/group1-shard1of1.bin`, `${runtime}model/model.json`,
        `${runtime}tf-backend-wasm.min.js`, `${runtime}tf.min.js`,
        `${runtime}tfjs-backend-wasm-simd.wasm`, `${runtime}tfjs-backend-wasm-threaded-simd.wasm`,
        `${runtime}tfjs-backend-wasm.wasm`
    ].sort((left, right) => left.localeCompare(right));
}

function verifyDistribution(root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Distribution directory is missing: ${root}`);
    const files = listFiles(root);
    const expected = expectedFiles();
    const missing = expected.filter(file => !files.includes(file));
    const unexpected = files.filter(file => !expected.includes(file));
    if (missing.length || unexpected.length) {
        const details = [];
        if (missing.length) details.push(`missing: ${missing.join(', ')}`);
        if (unexpected.length) details.push(`unexpected: ${unexpected.join(', ')}`);
        throw new Error(`Facecrop distribution file set is invalid (${details.join('; ')})`);
    }

    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'asset-manifest.json'), 'utf8')); }
    catch (error) { throw new Error(`Facecrop asset manifest is invalid JSON: ${error.message}`); }
    if (!manifest || manifest.schemaVersion !== 1 || manifest.libraryVersion !== packageInfo.version || manifest.assetBaseRelativePath !== './') {
        throw new Error('Facecrop asset manifest has an unsupported schema or package version');
    }
    if (typeof manifest.assetDirectory !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.assetDirectory)) {
        throw new Error('Facecrop asset manifest hash must be 64 lowercase hexadecimal characters');
    }
    const actual = digestTree(root, files);
    if (actual !== manifest.assetDirectory) throw new Error(`Facecrop asset hash mismatch: expected ${manifest.assetDirectory}, computed ${actual}`);
    return manifest;
}

if (require.main === module) {
    const root = path.resolve(process.argv[2] || path.join(PACKAGE_ROOT, 'dist'));
    try {
        const manifest = verifyDistribution(root);
        process.stdout.write(`Verified facecrop distribution ${manifest.assetDirectory} at ${root}\n`);
    } catch (error) {
        process.stderr.write((error.stack || String(error)) + '\n');
        process.exitCode = 1;
    }
}

module.exports = {digestTree, expectedFiles, verifyDistribution};
