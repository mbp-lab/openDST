/** Stage a verified browser distribution into explicit host destinations. */
const fs = require('fs');
const path = require('path');
const {verifyDistribution} = require('./verify-distribution.cjs');

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

function stageDistribution(distributionRoot, {generatedDirectory, publicRoot, publicSubpath, workRoot}, options = {}) {
    if (!generatedDirectory || !publicRoot || !workRoot || !publicSubpath || !publicSubpath.startsWith('/') || !publicSubpath.endsWith('/')) {
        throw new TypeError('Staging requires generatedDirectory, publicRoot, workRoot and a publicSubpath beginning and ending with /');
    }
    const manifest = verifyDistribution(distributionRoot);
    const generatedEntry = path.join(generatedDirectory, 'facecrop.js');
    const generatedMetadata = path.join(generatedDirectory, 'facecropAssets.json');
    const stagedPublic = path.join(publicRoot, manifest.assetDirectory);
    const stageDirectory = fs.mkdtempSync(path.join(workRoot, '.facecrop-stage-'));
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
            publicSubpath: `${publicSubpath}${manifest.assetDirectory}/`
        }, null, 2) + '\n');
        promoteFiles([
            {temporary: temporaryEntry, destination: generatedEntry},
            {temporary: temporaryMetadata, destination: generatedMetadata}
        ], stageDirectory, options.rename || fs.renameSync);
        return {assetDirectory: manifest.assetDirectory, publicSubpath: `${publicSubpath}${manifest.assetDirectory}/`};
    } catch (error) {
        if (error.recoveryDirectory === stageDirectory) preserveStageDirectory = true;
        if (createdPublic) fs.rmSync(stagedPublic, {recursive: true, force: true});
        throw error;
    } finally {
        if (!preserveStageDirectory) fs.rmSync(stageDirectory, {recursive: true, force: true});
    }
}

module.exports = {promoteFiles, stageDistribution};
