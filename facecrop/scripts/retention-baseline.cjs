/*
 * Reproduce the campaign's completed-part retention observation.
 * Run from this package with either:
 *   node --expose-gc scripts/retention-baseline.cjs --baseline --baseline-repository /path/to/openDST
 *   node --expose-gc scripts/retention-baseline.cjs --baseline --baseline-source /path/to/source-snapshot
 *   node --expose-gc scripts/retention-baseline.cjs
 * The transport bytes are deliberately synthetic; the frame metadata follows
 * the production face-event shape. This is not a browser memory benchmark.
 */
const path = require('path');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const {execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const babel = require(path.join(root, 'node_modules/@babel/core'));
const BASELINE_COMMIT = '4fd85bc6e031f33f3dd3aad6207e25b69fd8d595';
function optionValue(name) {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
    return value;
}
const baselineMode = process.argv.includes('--baseline');
const baselineRepository = optionValue('--baseline-repository');
const baselineSource = optionValue('--baseline-source');
if (baselineRepository && baselineSource) throw new Error('Choose either --baseline-repository or --baseline-source');
if (baselineMode && !baselineRepository && !baselineSource) {
    throw new Error('Baseline mode needs an explicit source: pass --baseline-repository PATH or --baseline-source PATH (a directory containing src/)');
}
if (!baselineMode && (baselineRepository || baselineSource)) {
    throw new Error('--baseline-repository and --baseline-source require --baseline');
}
let sourceRoot = root;
let baselineSnapshot;
let sourceDescription = 'current worktree';
if (baselineSource) {
    sourceRoot = path.resolve(baselineSource);
    if (!fs.existsSync(path.join(sourceRoot, 'src', 'FaceCropOutput.js')) ||
        !fs.existsSync(path.join(sourceRoot, 'src', 'Metadata.js')) ||
        !fs.existsSync(path.join(sourceRoot, 'src', 'uploadState.js'))) {
        throw new Error(`Baseline source must contain src/FaceCropOutput.js, src/Metadata.js and src/uploadState.js: ${sourceRoot}`);
    }
    sourceDescription = `baseline source ${sourceRoot}`;
} else if (baselineMode) {
    const repositoryRoot = path.resolve(baselineRepository);
    baselineSnapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'facecrop-retention-baseline-'));
    try {
        fs.mkdirSync(path.join(baselineSnapshot, 'src'));
        ['FaceCropOutput.js', 'Metadata.js', 'uploadState.js'].forEach(filename => {
            const content = execFileSync('git', ['show', `${BASELINE_COMMIT}:facecrop/src/${filename}`], {
                cwd: repositoryRoot, encoding: 'utf8'
            });
            fs.writeFileSync(path.join(baselineSnapshot, 'src', filename), content);
        });
    } catch (error) {
        fs.rmSync(baselineSnapshot, {recursive: true, force: true});
        throw error;
    }
    sourceRoot = baselineSnapshot;
    sourceDescription = `${BASELINE_COMMIT} from ${repositoryRoot}`;
}
const originalJsLoader = Module._extensions['.js'];
Module._extensions['.js'] = (module, filename) => {
    if (!filename.startsWith(path.join(sourceRoot, 'src') + path.sep)) return originalJsLoader(module, filename);
    const {code} = babel.transformFileSync(filename, {
        babelrc: false,
        configFile: false,
        presets: [[require.resolve(path.join(root, 'node_modules/@babel/preset-env')),
            {targets: {node: 'current'}}]],
        plugins: [require.resolve(path.join(root, 'node_modules/@babel/plugin-proposal-nullish-coalescing-operator'))]
    });
    module._compile(code, filename);
};

const {FaceCropSink} = require(path.join(sourceRoot, 'src/FaceCropOutput.js'));

async function main() {
    const echoPayload = process.argv.includes('--echo-payload');
    const acknowledgementRefs = [];
    const sink = new FaceCropSink({write: ({payload}) => {
        if (!echoPayload) return Promise.resolve();
        const acknowledgement = {payload};
        acknowledgementRefs.push(new WeakRef(acknowledgement));
        return Promise.resolve(acknowledgement);
    }});
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const parts = 200;
    const framesPerPart = 500;

    for (let partIndex = 0; partIndex < parts; partIndex += 1) {
        const filename = 'capture_patch_s000_p' + String(partIndex).padStart(3, '0') + '.avi.gz';
        const frames = Array.from({length: framesPerPart}, (_, frameIndex) => ({
            frameIndex,
            presentationTimeUs: (partIndex * framesPerPart + frameIndex) * 33333,
            wallClockMs: 1700000000000 + frameIndex * 33,
            source: {width: 720, height: 1280},
            state: 'largest',
            detection: {candidateCount: 1},
            selection: {score: 0.9, boundingBox: {x: 10, y: 20, width: 100, height: 100}},
            roi: {x: 10, y: 20, size: 150, descriptorVersion: 2}
        }));
        await sink.enqueuePart({
            captureId: 'capture', segmentIndex: 0, partIndex,
            filename,
            faceEventsFilename: filename.replace('.avi.gz', '.face-events.json'),
            frameCount: framesPerPart, frameRate: 30,
            gzipBytes: new Uint8Array([1]).buffer,
            faceEvents: {aviFilename: filename, frameCount: framesPerPart, analysis: {frames}}
        });
    }

    await sink.finalize();
    // WeakRef targets remain alive through their creation job; leave that job
    // before collecting, rather than treating immediate deref as retention.
    await new Promise(resolve => setImmediate(resolve));
    if (global.gc) global.gc();
    const compactHistoryBytes = Buffer.byteLength(JSON.stringify({parts: sink.results,
        artifacts: sink.inventory().map(({completion, ...artifact}) => artifact)}));
    const report = {
        scope: 'Node sink fixture; no browser/model/camera; synthetic encoded bytes, realistic metadata shape',
        source: sourceDescription,
        node: process.version,
        echoPayload,
        compactHistorySerializedBytes: compactHistoryBytes,
        retainedTransportCompletions: sink.fileEntries.filter(entry => entry.completion !== null).length,
        observedAcknowledgements: acknowledgementRefs.length,
        liveAcknowledgementsAfterGc: acknowledgementRefs.filter(ref => ref.deref() !== undefined).length,
        explicitGc: typeof global.gc === 'function',
        parts,
        framesPerPart,
        inputFrames: parts * framesPerPart,
        pendingUploads: sink.pending.length,
        resultParts: sink.results.length,
        retainedPartEntries: sink.entries.length,
        retainedFileEntries: sink.fileEntries.length,
        retainedPayloadParts: sink.entries.filter(entry => entry.part !== null).length,
        retainedFrameRecords: sink.entries.reduce((count, entry) => entry.part
            ? count + entry.part.faceEvents.analysis.frames.length : count, 0),
        remainingCompressedBuffers: sink.entries.filter(entry => entry.part && entry.part.gzipBytes !== null).length,
        approximateHeapGrowthMiB: Number(((process.memoryUsage().heapUsed - before) / 1024 / 1024).toFixed(2))
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch(error => {
    process.stderr.write((error.stack || String(error)) + '\n');
    process.exitCode = 1;
}).finally(() => {
    if (baselineSnapshot) fs.rmSync(baselineSnapshot, {recursive: true, force: true});
});
