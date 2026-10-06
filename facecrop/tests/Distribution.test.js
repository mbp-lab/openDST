const fs = require('fs');
const os = require('os');
const path = require('path');
const {digestTree, expectedFiles, verifyDistribution} = require('../scripts/verify-distribution.cjs');
const packageInfo = require('../package.json');
const {stageDistribution: stageBrowserDistribution} = require('../scripts/stage-distribution.cjs');

function stageDistribution(root, distributionRoot, options) {
    return stageBrowserDistribution(distributionRoot, {
        generatedDirectory: path.join(root, 'src/faceCrop/generated'),
        publicRoot: path.join(root, 'public/facecrop'),
        publicSubpath: '/facecrop/',
        workRoot: root
    }, options);
}
const {replaceDirectory} = require('../scripts/build.cjs');

function withTempDirectory(callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facecrop-distribution-test-'));
    try { callback(root); }
    finally { fs.rmSync(root, {recursive: true, force: true}); }
}

function makeDistribution(destination) {
    fs.mkdirSync(destination, {recursive: true});
    expectedFiles().filter(file => file !== 'asset-manifest.json').forEach(file => {
        const target = path.join(destination, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, `fixture:${file}`);
    });
    const assetDirectory = digestTree(destination, expectedFiles().filter(file => file !== 'asset-manifest.json'));
    fs.writeFileSync(path.join(destination, 'asset-manifest.json'), JSON.stringify({
        schemaVersion: 1, libraryVersion: packageInfo.version, assetDirectory, assetBaseRelativePath: './'
    }, null, 2) + '\n');
    return assetDirectory;
}

test('verifier accepts a complete distribution and rejects corrupt or incomplete runtime assets', () => {
    withTempDirectory(root => {
        const corrupt = path.join(root, 'corrupt');
        makeDistribution(corrupt);
        const manifest = verifyDistribution(corrupt);
        expect(manifest.assetDirectory).toMatch(/^[a-f0-9]{64}$/);
        fs.appendFileSync(path.join(corrupt, 'facecrop.worker.js'), '\ncorrupt');
        expect(() => verifyDistribution(corrupt)).toThrow(/hash mismatch/);

        const incomplete = path.join(root, 'incomplete');
        makeDistribution(incomplete);
        fs.unlinkSync(path.join(incomplete, 'tfjs/4.22.0/tfjs-backend-wasm.wasm'));
        expect(() => verifyDistribution(incomplete)).toThrow(/file set is invalid.*missing/);
    });
});

test('failed generated-file promotion restores old CRA entry and metadata and removes new public tree', () => {
    withTempDirectory(root => {
        const generated = path.join(root, 'src/faceCrop/generated');
        fs.mkdirSync(generated, {recursive: true});
        const oldEntry = 'known-good-facecrop-entry';
        const oldMetadata = 'known-good-facecrop-metadata';
        fs.writeFileSync(path.join(generated, 'facecrop.js'), oldEntry);
        fs.writeFileSync(path.join(generated, 'facecropAssets.json'), oldMetadata);
        let failed = false;
        const rename = (source, destination) => {
            if (!failed && destination === path.join(generated, 'facecropAssets.json') && path.basename(source) === 'facecropAssets.json') {
                failed = true;
                throw new Error('injected metadata promotion failure');
            }
            fs.renameSync(source, destination);
        };

        const distribution = path.join(root, 'distribution');
        makeDistribution(distribution);
        expect(() => stageDistribution(root, distribution, {rename})).toThrow(/injected metadata promotion failure/);
        expect(fs.readFileSync(path.join(generated, 'facecrop.js'), 'utf8')).toBe(oldEntry);
        expect(fs.readFileSync(path.join(generated, 'facecropAssets.json'), 'utf8')).toBe(oldMetadata);
        const manifest = verifyDistribution(distribution);
        expect(fs.existsSync(path.join(root, 'public/facecrop', manifest.assetDirectory))).toBe(false);
    });
});

test('invalid input is rejected before staging and prior outputs stay untouched', () => {
    withTempDirectory(root => {
        const generated = path.join(root, 'src/faceCrop/generated');
        fs.mkdirSync(generated, {recursive: true});
        fs.writeFileSync(path.join(generated, 'facecrop.js'), 'old-entry');
        const invalid = path.join(root, 'invalid-dist');
        makeDistribution(invalid);
        fs.writeFileSync(path.join(invalid, 'asset-manifest.json'), '{broken');

        expect(() => stageDistribution(root, invalid)).toThrow(/invalid JSON/);
        expect(fs.readFileSync(path.join(generated, 'facecrop.js'), 'utf8')).toBe('old-entry');
        expect(fs.existsSync(path.join(root, 'public'))).toBe(false);
    });
});

test('successful restage retains the old content-hash directory for already-open pages', () => {
    withTempDirectory(root => {
        const first = path.join(root, 'first');
        const second = path.join(root, 'second');
        const firstHash = makeDistribution(first);
        makeDistribution(second);
        fs.appendFileSync(path.join(second, 'facecrop.js'), ':updated');
        const secondManifest = JSON.parse(fs.readFileSync(path.join(second, 'asset-manifest.json'), 'utf8'));
        secondManifest.assetDirectory = digestTree(second, expectedFiles().filter(file => file !== 'asset-manifest.json'));
        fs.writeFileSync(path.join(second, 'asset-manifest.json'), JSON.stringify(secondManifest));
        const secondHash = secondManifest.assetDirectory;
        expect(secondHash).not.toBe(firstHash);

        stageDistribution(root, first);
        stageDistribution(root, second);

        expect(fs.existsSync(path.join(root, 'public/facecrop', firstHash, 'facecrop.worker.js'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'public/facecrop', secondHash, 'facecrop.worker.js'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'src/faceCrop/generated/facecropAssets.json'), 'utf8')))
            .toEqual({publicSubpath: `/facecrop/${secondHash}/`});
    });
});

test('directory promotion restores the previous build if publishing the validated build fails', () => {
    withTempDirectory(root => {
        const current = path.join(root, 'dist');
        const staged = path.join(root, 'build-output');
        fs.mkdirSync(current);
        fs.mkdirSync(staged);
        fs.writeFileSync(path.join(current, 'sentinel'), 'old-valid-output');
        fs.writeFileSync(path.join(staged, 'sentinel'), 'new-output');
        let failed = false;
        const rename = (source, destination) => {
            if (!failed && source === staged && destination === current) {
                failed = true;
                throw new Error('injected publish failure');
            }
            fs.renameSync(source, destination);
        };

        expect(() => replaceDirectory(staged, current, rename)).toThrow(/injected publish failure/);
        expect(fs.readFileSync(path.join(current, 'sentinel'), 'utf8')).toBe('old-valid-output');
    });
});

test('incomplete stage rollback preserves recovery backups and reports their location', () => {
    withTempDirectory(root => {
        const generated = path.join(root, 'src/faceCrop/generated');
        const distribution = path.join(root, 'distribution');
        fs.mkdirSync(generated, {recursive: true});
        makeDistribution(distribution);
        fs.writeFileSync(path.join(generated, 'facecrop.js'), 'known-good-entry');
        fs.writeFileSync(path.join(generated, 'facecropAssets.json'), 'known-good-metadata');
        let promotionFailed = false;
        const rename = (source, destination) => {
            if (!promotionFailed && destination === path.join(generated, 'facecropAssets.json') && path.basename(source) === 'facecropAssets.json') {
                promotionFailed = true;
                throw new Error('injected metadata promotion failure');
            }
            if (promotionFailed && path.basename(source) === 'backup-1' && destination === path.join(generated, 'facecropAssets.json')) {
                throw new Error('injected metadata restore failure');
            }
            fs.renameSync(source, destination);
        };

        let caught;
        try { stageDistribution(root, distribution, {rename}); }
        catch (error) { caught = error; }
        expect(caught).toBeDefined();
        expect(caught.message).toMatch(/Rollback was incomplete/);
        expect(caught.recoveryDirectory).toBeTruthy();
        expect(fs.readFileSync(path.join(caught.recoveryDirectory, 'backup-1'), 'utf8')).toBe('known-good-metadata');
        expect(fs.readFileSync(path.join(generated, 'facecrop.js'), 'utf8')).toBe('known-good-entry');
        fs.rmSync(caught.recoveryDirectory, {recursive: true, force: true});
    });
});

test('staging accepts independent application paths and deployment URLs', () => {
    withTempDirectory(root => {
        const distribution = path.join(root, 'distribution');
        const hash = makeDistribution(distribution);
        const generatedDirectory = path.join(root, 'bundle-input');
        const publicRoot = path.join(root, 'static/runtime');
        const result = stageBrowserDistribution(distribution, {
            generatedDirectory, publicRoot, publicSubpath: '/study/runtime/', workRoot: root
        });
        expect(result.publicSubpath).toBe(`/study/runtime/${hash}/`);
        expect(verifyDistribution(path.join(publicRoot, hash)).assetDirectory).toBe(hash);
        expect(JSON.parse(fs.readFileSync(path.join(generatedDirectory, 'facecropAssets.json'), 'utf8')))
            .toEqual({publicSubpath: result.publicSubpath});
        expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
    });
});
