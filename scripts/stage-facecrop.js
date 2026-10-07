/** Explicitly build facecrop and stage its verified browser distribution for CRA/JATOS. */
const path = require('path');
const {execFileSync} = require('child_process');
const {promoteFiles, stageDistribution: stageBrowserDistribution} = require('../browser-facecrop/scripts/stage-distribution.cjs');

const appRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(appRoot, 'browser-facecrop');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function installedPackageVersion(packageName) {
    try { return require(path.join(packageRoot, 'node_modules', packageName, 'package.json')).version; }
    catch (_) { return null; }
}

function assertBuildDependencies() {
    const packageJson = require(path.join(packageRoot, 'package.json'));
    Object.entries(packageJson.devDependencies).forEach(([name, expected]) => {
        const actual = installedPackageVersion(name);
        if (actual !== expected) {
            throw new Error(`Facecrop build dependency ${name}@${expected} is missing (found ${actual || 'none'}). Run npm run facecrop:prepare, then retry.`);
        }
    });
}

function stageDistribution(root, distributionRoot, options = {}) {
    return stageBrowserDistribution(distributionRoot, {
        generatedDirectory: path.join(root, 'src', 'faceCrop', 'generated'),
        publicRoot: path.join(root, 'public', 'facecrop'),
        publicSubpath: '/facecrop/',
        workRoot: root
    }, options);
}

function main() {
    assertBuildDependencies();
    execFileSync(npm, ['run', 'build'], {cwd: packageRoot, stdio: 'inherit'});
    const result = stageDistribution(appRoot, path.join(packageRoot, 'dist'));
    console.log(`Staged verified facecrop distribution at ${result.publicSubpath}`);
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}

module.exports = {promoteFiles, stageDistribution};
