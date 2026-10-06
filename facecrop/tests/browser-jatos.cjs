/* Real browser -> disposable real JATOS upload acceptance. Never uses installed JATOS data dirs. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const zlib = require('zlib');
const {promisify} = require('util');
const sleep = promisify(setTimeout);

const workbenchRoot = process.env.FACECROP_WORKBENCH_ROOT;
if (!workbenchRoot) {
    process.stderr.write('Set FACECROP_WORKBENCH_ROOT to the openDST workbench directory before running this study acceptance harness.\n');
    process.exit(1);
}
const repository = path.resolve(workbenchRoot);
const resolveOverride = (value, fallback) => value ? path.resolve(value) : fallback;
const sourceArchive = resolveOverride(process.env.FACECROP_JATOS_ARCHIVE,
    path.join(repository, 'jatos/archives/facecropping_test.jzip'));
const distribution = path.resolve(__dirname, '../dist');
const installedJatos = process.env.JATOS_HOME || '/opt/jatos';
const archiveStudyDirectory = 'facecropping_test';
const distributionMount = `/study_assets/${archiveStudyDirectory}/facecrop/`;
const fileTypes = {'.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream'};
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

function walk(root) {
    if (!fs.existsSync(root)) return [];
    const found = [];
    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) found.push(...walk(absolute));
        else found.push(absolute);
    }
    return found;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function snapshotInstalledState() {
    const targets = ['database', 'study_assets_root', 'result_uploads', 'study_logs', 'logs'].map(name => path.join(installedJatos, name));
    return targets.flatMap(root => walk(root).map(file => `${file} ${fs.statSync(file).size} ${fs.statSync(file).mtimeMs}`)).sort();
}
function waitChild(child) {
    return new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
}
async function poll(predicate, timeoutMs, message, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await sleep(intervalMs);
    }
    throw new Error(message);
}
function requiredDistributionHash() {
    const assetManifest = JSON.parse(fs.readFileSync(path.join(distribution, 'asset-manifest.json'), 'utf8'));
    return assetManifest.assetDirectory;
}
function locateImportedIndex(studyAssetsRoot) {
    const candidates = walk(studyAssetsRoot).filter(file => path.basename(file) === 'index.html' &&
        path.relative(studyAssetsRoot, file).split(path.sep).includes(archiveStudyDirectory));
    if (candidates.length !== 1) throw new Error(`Expected one imported ${archiveStudyDirectory}/index.html, found ${candidates.length}: ${candidates.join(', ')}`);
    return candidates[0];
}
function installHarnessIndex(indexFile) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><video id="capture" muted playsinline></video><script src="jatos.js"></script>
<script src="${distributionMount}facecrop.js"></script><script>
window.__facecropHarnessReady = false;
window.__facecropHarnessError = null;
window.__facecropStudyInfo = null;
window.__facecropWrites = [];
window.__facecropWriteHold = null;
window.__facecropFirstRealUpload = null;
window.__facecropFirstUploadResolve = null;
window.__facecropFirstRealUpload = new Promise(resolve => { window.__facecropFirstUploadResolve = resolve; });
window.__facecropOriginalUpload = null;
jatos.onLoad(() => {
  window.__facecropStudyInfo = {studyResultId: String(jatos.studyResultId), componentResultId: String(jatos.componentResultId),
    studyId: String(jatos.studyId), workerId: String(jatos.workerId)};
  const original = jatos.uploadResultFile.bind(jatos);
  window.__facecropOriginalUpload = original;
  jatos.uploadResultFile = async (payload, filename) => {
    window.__facecropWrites.push({filename, calledAt: performance.now()});
    const actualResponse = await original(payload, filename);
    window.__facecropWrites[window.__facecropWrites.length - 1].resolvedAt = performance.now();
    if (window.__facecropWriteHold && filename === window.__facecropWriteHold.filename) {
      window.__facecropWriteHold.acceptedResolve({filename});
      await new Promise(resolve => { window.__facecropWriteHold.release = resolve; });
    }
    if (window.__facecropFirstUploadResolve) {
      window.__facecropFirstUploadResolve({filename}); window.__facecropFirstUploadResolve = null;
    }
    return actualResponse;
  };
  window.__facecropHarnessReady = true;
});
</script></body></html>`;
    fs.writeFileSync(indexFile, html);
}

async function main() {
    assert(fs.existsSync(sourceArchive), `Missing disposable test archive: ${sourceArchive}`);
    assert(fs.existsSync(path.join(distribution, 'facecrop.js')), 'Current facecrop distribution is missing; build/stage it first');
    assert(fs.existsSync(path.join(distribution, 'tfjs/4.22.0/model/model.json')), 'Current model assets are missing');
    assert(fs.existsSync(path.join(installedJatos, 'bin/jatos')), `JATOS is not installed at ${installedJatos}`);
    const version = fs.readFileSync(path.join(installedJatos, 'VERSION'), 'utf8').trim();
    const sourceSeed = resolveOverride(process.env.FACECROP_JATOS_SEED,
        path.join(repository, '.jatos-temp', version));
    for (const file of ['jatos.mv.db', 'api-token', 'VERSION']) assert(fs.existsSync(path.join(sourceSeed, file)), `Missing provisioned seed file ${file}`);
    const distHash = requiredDistributionHash();
    if (process.env.FACECROP_EXPECTED_DIST_HASH) assert.equal(distHash, process.env.FACECROP_EXPECTED_DIST_HASH,
        'Current distribution hash differs from the build accepted for this run');

    const beforeInstalledState = snapshotInstalledState();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'facecrop-jatos-browser-'));
    const fixture = path.join(tempRoot, 'repository');
    const fixtureSeed = path.join(fixture, '.jatos-temp', version);
    const fixtureArchive = path.join(fixture, 'jatos/archives/test.jzip');
    fs.mkdirSync(path.join(fixture, 'lib'), {recursive: true});
    fs.mkdirSync(fixtureSeed, {recursive: true});
    fs.mkdirSync(path.dirname(fixtureArchive), {recursive: true});
    fs.mkdirSync(path.join(fixture, 'tmp'), {recursive: true});
    fs.copyFileSync(path.join(repository, 'run-study.bash'), path.join(fixture, 'run-study.bash'));
    fs.copyFileSync(path.join(repository, 'lib/jatos-common.bash'), path.join(fixture, 'lib/jatos-common.bash'));
    fs.copyFileSync(path.join(repository, 'lib/lan-address.py'), path.join(fixture, 'lib/lan-address.py'));
    for (const file of ['jatos.mv.db', 'api-token', 'VERSION']) fs.copyFileSync(path.join(sourceSeed, file), path.join(fixtureSeed, file));
    fs.copyFileSync(sourceArchive, fixtureArchive);
    const runLog = path.join(tempRoot, 'run-study.log');
    const logFd = fs.openSync(runLog, 'w');
    const runStudy = spawn(path.join(fixture, 'run-study.bash'), [fixtureArchive], {
        cwd: fixture, env: {...process.env, JATOS_HOME: installedJatos, JATOS_MACHINE_OUTPUT: '1',
            JATOS_TEMP_ADDRESS: '127.0.0.1', TMPDIR: path.join(fixture, 'tmp')},
        stdio: ['ignore', logFd, logFd]
    });
    const runnerExit = waitChild(runStudy);
    fs.closeSync(logFd);
    let browser;
    let runnerStopped = false;
    let report;
    let runSucceeded = false;
    try {
        const runInfo = await poll(() => {
            const log = fs.readFileSync(runLog, 'utf8');
            const studyUrl = log.match(/^JATOS_STUDY_URL=(.+)$/m);
            const baseUrl = log.match(/^JATOS_BASE_URL=(.+)$/m);
            const runRoot = log.match(/^JATOS_RUN_DIR=(.+)$/m);
            const studyId = log.match(/^JATOS_STUDY_ID=(.+)$/m);
            return studyUrl && baseUrl && runRoot && studyId ? {studyUrl: studyUrl[1], baseUrl: baseUrl[1], runRoot: runRoot[1], studyId: studyId[1]} : null;
        }, 5000, 'JATOS machine output was incomplete');
        const studyAssetsRoot = path.join(runInfo.runRoot, 'study-assets');
        const indexFile = await poll(() => {
            try { return locateImportedIndex(studyAssetsRoot); } catch (_) { return null; }
        }, 30000, `Could not locate imported study index under ${studyAssetsRoot}`);
        const importedStudyRoot = path.dirname(indexFile);
        const copiedDistribution = path.join(importedStudyRoot, 'facecrop');
        fs.rmSync(copiedDistribution, {recursive: true, force: true});
        fs.cpSync(distribution, copiedDistribution, {recursive: true});
        installHarnessIndex(indexFile);

        const resultRoot = path.join(runInfo.runRoot, 'result-uploads');
        const componentLog = path.join(runInfo.runRoot, 'study-logs');
        browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--js-flags=--expose-gc']});
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        const response = await page.goto(runInfo.studyUrl, {waitUntil: 'domcontentloaded', timeout: 120000});
        if (!response || response.status() >= 400) throw new Error(`Study page returned HTTP ${response && response.status()}`);
        await page.waitForFunction(() => window.__facecropHarnessReady === true, {timeout: 60000});
        const browserResult = await page.evaluate(async mountPath => {
            const info = window.__facecropStudyInfo;
            if (!info || !info.studyResultId || !info.componentResultId) throw new Error('JATOS result identity unavailable');
            const video = document.querySelector('#capture');
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
            const context = canvas.getContext('2d'); let frame = 0;
            const draw = () => { frame += 1; context.fillStyle = `hsl(${frame % 360} 55% 45%)`; context.fillRect(0, 0, 96, 96); context.fillStyle = '#fff'; context.fillRect(frame % 80, 25, 15, 15); };
            draw(); const drawingTimer = setInterval(draw, 33);
            const stream = canvas.captureStream(30); video.srcObject = stream; await video.play();
            const base = {video, assetBaseUrl: new URL(mountPath, location.href).href,
                context: {studyResultId: info.studyResultId, componentResultId: info.componentResultId, purpose: 'jatos-acceptance'}};
            const api = window.jatos;
            const originalUpload = window.__facecropOriginalUpload;
            const calls = window.__facecropWrites;
            const waitFor = async (predicate, label, timeoutMs = 120000) => {
                const deadline = performance.now() + timeoutMs;
                while (performance.now() < deadline) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
                throw new Error('Timed out waiting for ' + label + '; calls=' + JSON.stringify(calls));
            };
            const normalCapture = Facecrop.createCaptureSession({...base, captureId: 'jatos-normal', filenamePrefix: 'jatos_normal',
                transport: Facecrop.createJatosTransport(api)});
            const prepared = await normalCapture.prepare();
            if (prepared.status !== 'ready') throw new Error('Normal capture preparation failed: ' + JSON.stringify(prepared));
            await normalCapture.start();
            await waitFor(() => calls.some(call => call.filename.endsWith('.face-events.json') && call.filename.startsWith('jatos_normal_')), 'a normal real sidecar upload');
            const normalResult = await normalCapture.stop();
            if (normalResult.status !== 'complete') throw new Error('Normal real JATOS capture incomplete: ' + JSON.stringify(normalResult));
            const normalCalls = calls.filter(call => call.filename.startsWith('jatos_normal_'));
            const normalAvi = normalCalls.find(call => call.filename.endsWith('.avi.gz'));
            const normalSidecar = normalCalls.find(call => call.filename.endsWith('.face-events.json'));
            const normalManifest = normalCalls.find(call => call.filename.endsWith('_manifest.json'));
            if (!normalAvi || !normalSidecar || !normalManifest) throw new Error('Expected real JATOS AVI, sidecar and manifest writes: ' + JSON.stringify(normalCalls));
            if (!(normalCalls.indexOf(normalAvi) < normalCalls.indexOf(normalSidecar) && normalCalls.indexOf(normalSidecar) < normalCalls.indexOf(normalManifest))) {
                throw new Error('Normal write order was not AVI, sidecar, manifest: ' + JSON.stringify(normalCalls));
            }

            let responseFault = null;
            const attemptCounts = Object.create(null);
            let holdFilename = null;
            let acceptHeld;
            let releaseHeld;
            const accepted = new Promise(resolve => { acceptHeld = resolve; });
            api.uploadResultFile = async (payload, filename) => {
                const call = {filename, calledAt: performance.now()};
                calls.push(call);
                const response = await originalUpload(payload, filename);
                call.resolvedAt = performance.now();
                if (responseFault && filename.startsWith(responseFault.prefix) && responseFault.matches(filename)) {
                    const attempt = responseFault.attempts[filename] = (responseFault.attempts[filename] || 0) + 1;
                    responseFault.serverAccepted.push({filename, attempt});
                    throw new Error('acceptance harness: deliberately rejected response after JATOS stored bytes');
                }
                if (filename === holdFilename) {
                    acceptHeld({filename});
                    await new Promise(resolve => { releaseHeld = resolve; });
                }
                return response;
            };
            const runRejectedResponseCase = async kind => {
                const prefix = `jatos_reject_${kind}`;
                const captureId = `jatos-reject-${kind}`;
                const suffixMatch = kind === 'avi' ? name => name.endsWith('_patch_s000_p000.avi.gz')
                    : kind === 'sidecar' ? name => name.endsWith('_patch_s000_p000.face-events.json')
                        : name => name.endsWith('_manifest.json');
                const fault = responseFault = {prefix, matches: suffixMatch, attempts: Object.create(null), serverAccepted: []};
                const capture = Facecrop.createCaptureSession({...base, captureId, filenamePrefix: prefix,
                    transport: Facecrop.createJatosTransport(api)});
                await capture.start();
                if (kind === 'manifest') await new Promise(resolve => setTimeout(resolve, 1500));
                else await waitFor(() => Object.values(fault.attempts).some(count => count >= 3), `${kind} response rejection retries`, 120000);
                const result = await capture.stop();
                responseFault = null;
                if (result.status !== 'incomplete') throw new Error(`${kind} rejected response did not make capture incomplete: ${JSON.stringify(result)}`);
                const relevant = result.artifacts.filter(artifact => artifact.filename.startsWith(prefix));
                const outcomes = relevant.map(({filename, status, attempts}) => ({filename, status, attempts}));
                const target = relevant.find(artifact => suffixMatch(artifact.filename));
                if (!target || target.status !== 'uncertain' || target.attempts !== 3) {
                    throw new Error(`${kind} rejected response was not reported uncertain after three attempts: ${JSON.stringify(outcomes)}`);
                }
                if (kind === 'avi') {
                    const sidecar = relevant.find(artifact => artifact.filename.endsWith('.face-events.json'));
                    if (!sidecar || sidecar.status !== 'not_attempted' || sidecar.attempts !== 0) {
                        throw new Error('AVI response loss must leave its sidecar not_attempted: ' + JSON.stringify(outcomes));
                    }
                }
                return {kind, status: result.status, captureId, targetFilename: target.filename,
                    targetStatus: target.status, targetAttempts: target.attempts,
                    serverAcceptedAttempts: fault.serverAccepted.length, filenames: [...new Set(fault.serverAccepted.map(write => write.filename))],
                    outcomes, manifestStatus: result.manifest && result.manifest.status,
                    calls: calls.filter(call => call.filename.startsWith(prefix)).map(call => ({filename: call.filename,
                        responseRejectedAfterServerAcceptance: Boolean(fault.matches(call.filename)) && call.filename === target.filename}))};
            };
            const rejectedResponses = [];
            for (const kind of ['avi', 'sidecar', 'manifest']) rejectedResponses.push(await runRejectedResponseCase(kind));

            const heldFilename = 'jatos_abort_jatos-abort_patch_s000_p000.avi.gz';
            holdFilename = heldFilename;
            const abortedCapture = Facecrop.createCaptureSession({...base, captureId: 'jatos-abort', filenamePrefix: 'jatos_abort',
                transport: Facecrop.createJatosTransport(api)});
            await abortedCapture.start();
            const acceptedAvi = await waitFor(() => accepted, 'the server to accept the abort capture AVI');
            if (acceptedAvi.filename !== heldFilename) throw new Error('Held response filename mismatch: ' + acceptedAvi.filename);
            const abortStartedAt = performance.now();
            const aborted = await Promise.race([abortedCapture.abort(), new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Abort waited for the held real JATOS response')), 5000))]);
            const abortLatencyMs = performance.now() - abortStartedAt;
            const pending = aborted.artifacts.map(item => item.completion).filter(Boolean);
            if (aborted.status !== 'aborted') throw new Error('Abort status was ' + aborted.status);
            if (!releaseHeld) throw new Error('Held actual JATOS response was not installed');
            releaseHeld();
            await Promise.allSettled(pending);
            const marker = new Blob([`save_without_video\n${Date.now()}\nFacecrop JATOS acceptance\n${info.studyId}`], {type: 'text/plain'});
            await originalUpload(marker, 'config.txt');
            holdFilename = null;
            const abortCalls = calls.filter(call => call.filename.startsWith('jatos_abort_'));
            if (abortCalls.length !== 1 || abortCalls[0].filename !== heldFilename) throw new Error('Abort issued new writes after held AVI: ' + JSON.stringify(abortCalls));
            if (abortCalls.some(call => call.filename.endsWith('.face-events.json'))) throw new Error('Abort wrote a sidecar after abort');
            const facecropTrackState = stream.getVideoTracks()[0].readyState;
            stream.getTracks().forEach(track => track.stop()); clearInterval(drawingTimer);
            return {study: info, normal: {status: normalResult.status, captureId: normalResult.capture.captureId,
                filenames: normalCalls.map(call => call.filename), writes: normalCalls}, rejectedResponses, abort: {status: aborted.status,
                captureId: aborted.capture.captureId, abortLatencyMs, heldAcceptedFilename: acceptedAvi.filename,
                filenames: abortCalls.map(call => call.filename), pendingCompletionCount: pending.length},
                marker: {filename: 'config.txt', firstLine: 'save_without_video'}, facecropTrackStateBeforeHarnessCleanup: facecropTrackState};
        }, distributionMount);

        const resultFiles = await poll(() => {
            const all = walk(resultRoot);
            const rejectedNames = browserResult.rejectedResponses.flatMap(testCase => testCase.filenames);
            const required = ['config.txt', ...browserResult.normal.filenames, ...browserResult.abort.filenames, ...rejectedNames];
            return required.every(filename => all.some(file => path.basename(file) === filename)) ? all : null;
        }, 30000, 'actual JATOS result-upload files to appear on disk');
        const byName = filename => resultFiles.find(file => path.basename(file) === filename);
        const normalAviName = browserResult.normal.filenames.find(name => name.endsWith('.avi.gz'));
        const normalSidecarName = browserResult.normal.filenames.find(name => name.endsWith('.face-events.json'));
        const normalManifestName = browserResult.normal.filenames.find(name => name.endsWith('_manifest.json'));
        const abortAviName = browserResult.abort.filenames[0];
        const rejectedNames = browserResult.rejectedResponses.flatMap(testCase => testCase.filenames);
        const expected = [...new Set([normalAviName, normalSidecarName, normalManifestName, abortAviName, 'config.txt', ...rejectedNames])];
        const fileEvidence = {};
        for (const name of expected) {
            const file = byName(name);
            if (!file) throw new Error(`Missing JATOS stored result ${name}`);
            const bytes = fs.readFileSync(file);
            fileEvidence[name] = {path: path.relative(resultRoot, file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
        }
        const manifest = JSON.parse(fs.readFileSync(byName(normalManifestName), 'utf8'));
        assert.equal(manifest.schema, 'face-crop-manifest-v1');
        assert.equal(manifest.summary.status, 'complete');
        assert.equal(manifest.capture.captureId, browserResult.normal.captureId);
        const orderedParts = [...manifest.analysis.parts].sort((left, right) => left.segmentIndex - right.segmentIndex || left.partIndex - right.partIndex);
        assert.equal(orderedParts.length, browserResult.normal.filenames.filter(name => name.endsWith('.avi.gz')).length);
        const partSummaries = [];
        let previousLastTimestamp = null;
        for (const part of orderedParts) {
            assert(browserResult.normal.filenames.includes(part.filename), `Manifest AVI missing from successful upload list: ${part.filename}`);
            assert(browserResult.normal.filenames.includes(part.faceEventsFilename), `Manifest sidecar missing from successful upload list: ${part.faceEventsFilename}`);
            const avi = fs.readFileSync(byName(part.filename));
            assert.equal(zlib.gunzipSync(avi).subarray(0, 4).toString(), 'RIFF');
            const sidecar = JSON.parse(fs.readFileSync(byName(part.faceEventsFilename), 'utf8'));
            const frames = sidecar.analysis.frames;
            assert.equal(sidecar.aviFilename, part.filename);
            assert.equal(sidecar.frameCount, part.frameCount);
            assert.equal(sidecar.frameCount, frames.length);
            frames.forEach((frame, index) => {
                assert.equal(frame.frameIndex, index);
                if (index) assert(frame.presentationTimeUs > frames[index - 1].presentationTimeUs,
                    `Non-increasing timestamp in ${part.faceEventsFilename}`);
            });
            if (previousLastTimestamp !== null) {
                assert.equal(sidecar.precedingFramePresentationTimeUs, previousLastTimestamp,
                    `Part-boundary timestamp chain mismatch at ${part.faceEventsFilename}`);
                assert(frames[0].presentationTimeUs > previousLastTimestamp);
            }
            previousLastTimestamp = frames[frames.length - 1].presentationTimeUs;
            partSummaries.push({aviFilename: part.filename, sidecarFilename: part.faceEventsFilename,
                frameCount: sidecar.frameCount, firstFrameIndex: frames[0].frameIndex,
                lastFrameIndex: frames[frames.length - 1].frameIndex,
                firstPresentationTimeUs: frames[0].presentationTimeUs, lastPresentationTimeUs: previousLastTimestamp});
        }
        assert.equal(fs.readFileSync(byName('config.txt'), 'utf8').split('\n')[0], 'save_without_video');
        assert(fs.existsSync(byName(abortAviName)), 'An AVI accepted by real JATOS before abort must remain stored');
        assert(!resultFiles.some(file => path.basename(file) === abortAviName.replace(/\.avi\.gz$/, '.face-events.json')),
            'No abort-capture sidecar should be stored after abort');
        for (const testCase of browserResult.rejectedResponses) {
            assert.equal(testCase.status, 'incomplete');
            assert.equal(testCase.targetStatus, 'uncertain');
            assert.equal(testCase.targetAttempts, 3);
            assert.equal(testCase.serverAcceptedAttempts, 3, 'All rejected responses must follow a successful real JATOS store');
            for (const name of testCase.filenames) assert(byName(name), `Rejected response bytes were not retained by JATOS: ${name}`);
        }
        const aviFailure = browserResult.rejectedResponses.find(testCase => testCase.kind === 'avi');
        assert(!resultFiles.some(file => path.basename(file) === aviFailure.targetFilename.replace(/\.avi\.gz$/, '.face-events.json')),
            'An unattempted sidecar after AVI failure must not exist on the JATOS server');
        const afterInstalledState = snapshotInstalledState();
        assert.deepEqual(afterInstalledState, beforeInstalledState, 'Installed JATOS data directories changed');
        report = {status: 'passed', gate: 'real browser + disposable real JATOS server; not a production server/device test',
            jatosVersion: version, browserVersion: browser.version(), nodeVersion: process.version,
            distributionAssetHash: distHash, distributionMount, studyId: runInfo.studyId,
            archiveSha256: sha256(sourceArchive), originalIndexReplacedOnlyInFixture: true,
            normal: {...browserResult.normal, partSummaries}, rejectedResponses: browserResult.rejectedResponses,
            abort: browserResult.abort, marker: browserResult.marker,
            files: fileEvidence, validations: {realJatosUploadApi: true, aviGzipRiff: true, sidecarJson: true,
                manifestJson: true, aviBeforeSidecarBeforeManifest: true, abortedAcceptedAviRetained: true,
                noAbortSidecar: true, saveWithoutVideoMarker: true, installedJatosStateUnchanged: true,
                rejectedAviSidecarNotAttempted: true, responseLossRetainsServerBytes: true,
                allNormalPartIndexesTimestampsAndManifestLinks: true},
            remainingGaps: ['participant experience under production deployment', 'physical camera/device formats',
                'production JATOS persistence and cancellation path']};
        runSucceeded = true;
    } catch (error) {
        const log = fs.existsSync(runLog) ? fs.readFileSync(runLog, 'utf8').slice(-6000) : '';
        error.message += `\nDisposable fixture: ${tempRoot}\nrun-study log tail:\n${log}`;
        throw error;
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (runStudy.exitCode === null) runStudy.kill('SIGTERM');
        let stopped = await Promise.race([runnerExit.then(() => true), sleep(15000).then(() => false)]);
        if (!stopped) {
            runStudy.kill('SIGKILL');
            stopped = await Promise.race([runnerExit.then(() => true), sleep(5000).then(() => false)]);
        }
        runnerStopped = stopped;
        if (runnerStopped && runSucceeded) fs.rmSync(tempRoot, {recursive: true, force: true});
        else console.error(`Disposable JATOS fixture retained (runnerStopped=${runnerStopped}, runSucceeded=${runSucceeded}):`, tempRoot);
    }
    const reportPath = process.env.FACECROP_JATOS_REPORT || path.join(os.tmpdir(), `facecrop-jatos-acceptance-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({reportPath, ...report}));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
