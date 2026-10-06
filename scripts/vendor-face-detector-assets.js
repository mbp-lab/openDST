/** Explicitly build facecrop and stage its verified browser distribution for CRA/JATOS. */
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {verifyDistribution} = require('../facecrop/scripts/verify-distribution.cjs');

const appRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(appRoot, 'facecrop');
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
            throw new Error(`Facecrop build dependency ${name}@${expected} is missing (found ${actual || 'none'}). Run npm --prefix facecrop ci, then retry.`);
        }
    });
}

function promoteFiles(replacements, workDirectory, rename = fs.renameSync) {
    const backups = [];
    const promoted = [];
    try {
        replacements.forEach(({temporary, destination}) => {
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            if (fs.existsSync(destination)) {
                const backup = path.join(workDirectory, `backup-${backups.length}`);
                rename(destination, backup);
                backups.push({backup, destination});
            }
            rename(temporary, destination);
            promoted.push(destination);
        });
    } catch (error) {
        const recoveryErrors = [];
        promoted.reverse().forEach(destination => {
            try { fs.rmSync(destination, {recursive: true, force: true}); }
            catch (recoveryError) { recoveryErrors.push(`${destination}: ${recoveryError.message}`); }
        });
        backups.reverse().forEach(({backup, destination}) => {
            if (!fs.existsSync(backup)) return;
            try { rename(backup, destination); }
            catch (recoveryError) { recoveryErrors.push(`${destination} (backup ${backup}): ${recoveryError.message}`); }
        });
        if (recoveryErrors.length) {
            error.recoveryDirectory = workDirectory;
            error.message += `. Rollback was incomplete; recovery files remain at ${workDirectory}. Restore: ${recoveryErrors.join('; ')}`;
        }
        throw error;
    }
}

function copyTree(source, destination) {
    fs.cpSync(source, destination, {recursive: true, errorOnExist: true, force: false});
}

function stageDistribution(root, distributionRoot, options = {}) {
    const manifest = verifyDistribution(distributionRoot);
    const generatedDirectory = path.join(root, 'src', 'faceCrop', 'generated');
    const publicRoot = path.join(root, 'public', 'facecrop');
    const generatedEntry = path.join(generatedDirectory, 'facecrop.js');
    const generatedMetadata = path.join(generatedDirectory, 'facecropAssets.json');
    const stagedPublic = path.join(publicRoot, manifest.assetDirectory);
    const stageDirectory = fs.mkdtempSync(path.join(root, '.facecrop-stage-'));
    let createdPublic = false;
    let preserveStageDirectory = false;
    try {
        if (fs.existsSync(stagedPublic)) {
            const existing = verifyDistribution(stagedPublic);
            if (existing.assetDirectory !== manifest.assetDirectory) throw new Error('Existing staged facecrop directory does not match its hash path');
        } else {
            const temporaryPublic = path.join(stageDirectory, 'public-assets');
            copyTree(distributionRoot, temporaryPublic);
            verifyDistribution(temporaryPublic);
            fs.mkdirSync(publicRoot, {recursive: true});
            (options.rename || fs.renameSync)(temporaryPublic, stagedPublic);
            createdPublic = true;
        }

        const temporaryEntry = path.join(stageDirectory, 'facecrop.js');
        const temporaryMetadata = path.join(stageDirectory, 'facecropAssets.json');
        fs.writeFileSync(temporaryEntry, '/* eslint-disable */\n' + fs.readFileSync(path.join(distributionRoot, 'facecrop.js')));
        fs.writeFileSync(temporaryMetadata, JSON.stringify({
            publicSubpath: `/facecrop/${manifest.assetDirectory}/`
        }, null, 2) + '\n');
        promoteFiles([
            {temporary: temporaryEntry, destination: generatedEntry},
            {temporary: temporaryMetadata, destination: generatedMetadata}
        ], stageDirectory, options.rename || fs.renameSync);
        return {assetDirectory: manifest.assetDirectory, publicSubpath: `/facecrop/${manifest.assetDirectory}/`};
    } catch (error) {
        if (error.recoveryDirectory === stageDirectory) preserveStageDirectory = true;
        if (createdPublic) fs.rmSync(stagedPublic, {recursive: true, force: true});
        throw error;
    } finally {
        if (!preserveStageDirectory) fs.rmSync(stageDirectory, {recursive: true, force: true});
    }
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
