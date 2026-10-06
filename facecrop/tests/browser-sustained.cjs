/* Sustained real-browser lifecycle/resource exercise. External Playwright; requires built dist assets. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const distribution = path.resolve(process.env.FACECROP_DISTRIBUTION || path.join(__dirname, '../dist'));
const mount = process.env.FACECROP_BROWSER_MOUNT || '/study_assets/other-study/facecrop/';
const {expectedFiles} = require('../scripts/verify-distribution.cjs');
const types = {'.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream'};
const PART_FRAMES = 539;
const SUSTAINED_PARTS = Number(process.env.FACECROP_SUSTAINED_PARTS || 3);
const TIMEOUT_MS = Number(process.env.FACECROP_SUSTAINED_TIMEOUT_MS || 600000);

async function main() {
    assert(mount.startsWith('/') && mount.endsWith('/'), 'FACECROP_BROWSER_MOUNT must be an absolute path ending in /');
    assert(fs.existsSync(path.join(distribution, 'facecrop.js')), 'Build facecrop before running this harness');
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push(request.url);
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><video muted playsinline></video><script src="' + mount + 'facecrop.js"></script>');
            return;
        }
        const relative = decodeURIComponent(request.url.split('?')[0].slice(mount.length));
        const file = path.resolve(distribution, relative);
        if (!request.url.startsWith(mount) || !file.startsWith(distribution + path.sep) || !fs.existsSync(file)) {
            response.writeHead(404); response.end(); return;
        }
        response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
        fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    const reports = [];
    try {
        browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--js-flags=--expose-gc']});
        const page = await browser.newPage();
        page.setDefaultTimeout(TIMEOUT_MS + 30000);
        await page.addInitScript(() => {
            const stringify = JSON.stringify;
            window.__facecropFrameEvidence = [];
            JSON.stringify = function (value, ...args) {
                const frames = value && (Array.isArray(value.frames) ? value.frames :
                    value.analysis && Array.isArray(value.analysis.frames) ? value.analysis.frames : null);
                if (typeof WeakRef === 'function' && value && value.schema === 'face-crop-events-v3' &&
                    typeof value.aviFilename === 'string' && frames) {
                    window.__facecropFrameEvidence.push({filename: value.aviFilename,
                        frameCount: frames.length, frames: new WeakRef(frames)});
                }
                return stringify.call(this, value, ...args);
            };
            const nativeWorker = window.Worker;
            const resource = window.__facecropResources = {workersCreated: 0, workersLive: 0, frameCallbacksCreated: 0,
                frameCallbacksLive: 0, peakWorkersLive: 0, peakFrameCallbacksLive: 0};
            window.Worker = function (...args) {
                const worker = Reflect.construct(nativeWorker, args, new.target || nativeWorker);
                resource.workersCreated += 1; resource.workersLive += 1;
                resource.peakWorkersLive = Math.max(resource.peakWorkersLive, resource.workersLive);
                const terminate = worker.terminate.bind(worker); let closed = false;
                worker.terminate = () => { if (!closed) { closed = true; resource.workersLive -= 1; } return terminate(); };
                return worker;
            };
            window.Worker.prototype = nativeWorker.prototype;
            Object.setPrototypeOf(window.Worker, nativeWorker);
            const proto = HTMLVideoElement.prototype;
            const request = proto.requestVideoFrameCallback;
            const cancel = proto.cancelVideoFrameCallback;
            const activeCallbacks = new Set();
            proto.requestVideoFrameCallback = function (callback) {
                let id;
                id = request.call(this, (...args) => { activeCallbacks.delete(id); resource.frameCallbacksLive -= 1; callback(...args); });
                activeCallbacks.add(id); resource.frameCallbacksCreated += 1; resource.frameCallbacksLive += 1;
                resource.peakFrameCallbacksLive = Math.max(resource.peakFrameCallbacksLive, resource.frameCallbacksLive);
                return id;
            };
            proto.cancelVideoFrameCallback = function (id) {
                if (activeCallbacks.delete(id)) resource.frameCallbacksLive -= 1;
                return cancel.call(this, id);
            };
        });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        const runtimeAssetChecks = await page.evaluate(async ({mountPath, files}) => {
            const base = new URL(mountPath, location.href);
            const results = [];
            for (const file of files) {
                const response = await fetch(new URL(file, base));
                if (!response.ok) throw new Error(`Runtime asset request failed (${response.status}): ${file}`);
                const body = await response.arrayBuffer();
                results.push({file, status: response.status, bytes: body.byteLength});
            }
            return results;
        }, {mountPath: mount, files: expectedFiles()});
        const result = await page.evaluate(async ({mountPath, targetParts, timeoutMs}) => {
            const video = document.querySelector('video');
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
            const context = canvas.getContext('2d');
            let frame = 0;
            const draw = () => {
                frame += 1;
                context.fillStyle = `hsl(${frame % 360} 45% 50%)`; context.fillRect(0, 0, 96, 96);
                context.fillStyle = '#fff'; context.fillRect(frame % 80, 30, 12, 12);
            };
            draw(); const drawTimer = setInterval(draw, 33);
            const stream = canvas.captureStream(30); video.srcObject = stream; await video.play();
            const common = {video, assetBaseUrl: new URL(mountPath, location.href).href,
                config: {pipeline: {analysisWorkerCount: 1}}, filenamePrefix: 'sustained', context: {harness: 'sustained'}};
            const metrics = (name, captureId, writes, weakPayloads, totalBytes, attempts, startTime, stopResult,
                repeatSamePromise, extra = {}) => {
                const resource = window.__facecropResources;
                return {name, captureId, elapsedMs: performance.now() - startTime,
                    status: stopResult && stopResult.status, reason: stopResult && stopResult.reason,
                    statistics: stopResult && stopResult.statistics,
                    distinctParts: new Set(writes.filter(x => x.filename.endsWith('.avi.gz')).map(x => x.filename)).size,
                    writes: writes.length, bytes: totalBytes.value, attempts: {...attempts},
                    pendingArtifacts: stopResult && (stopResult.artifacts || []).filter(x => x.status === 'pending').length,
                    workerLiveAtTerminal: resource.workersLive, frameCallbacksAtTerminal: resource.frameCallbacksLive,
                    workerCreatedTotal: resource.workersCreated, peakWorkersLive: resource.peakWorkersLive,
                    frameCallbacksCreatedTotal: resource.frameCallbacksCreated, peakFrameCallbacksLive: resource.peakFrameCallbacksLive,
                    heap: performance.memory ? {usedJSHeapSize: performance.memory.usedJSHeapSize,
                        totalJSHeapSize: performance.memory.totalJSHeapSize} : null,
                    repeatSamePromise, ...extra};
            };
            const delayedTransport = ({delayMs, transientRejectFirst = false, holdFirst = false} = {}) => {
                const writes = [], completedSidecars = [], sidecarEvidence = [], attempts = Object.create(null),
                    weakPayloads = [], acknowledgementRefs = [], totalBytes = {value: 0};
                let resolveHeld;
                const firstWrite = new Promise(resolve => { resolveHeld = resolve; });
                let held = false;
                return {writes, attempts, weakPayloads, totalBytes, firstWrite, release: () => resolveHeld(), transport: {write: async ({filename, payload}) => {
                    const number = attempts[filename] = (attempts[filename] || 0) + 1;
                    if (holdFirst && !held) { held = true; resolveHeld(); await new Promise(resolve => { delayedTransport.releaseHeld = resolve; }); }
                    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                    const weak = typeof WeakRef === 'function' && payload !== null && (typeof payload === 'object' || typeof payload === 'function') ? new WeakRef(payload) : null;
                    if (weak) weakPayloads.push(weak);
                    const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.size;
                    totalBytes.value += bytes;
                    writes.push({filename, bytes, number});
                    if (transientRejectFirst && number === 1 && filename.endsWith('.face-events.json')) throw new Error('intentional one-time transport fault');
                    if (filename.endsWith('.face-events.json')) {
                        const sidecar = JSON.parse(payload);
                        const frames = Array.isArray(sidecar.frames) ? sidecar.frames :
                            sidecar.analysis && Array.isArray(sidecar.analysis.frames) ? sidecar.analysis.frames : null;
                        if (sidecar.schema !== 'face-crop-events-v3' || !frames || frames.length !== sidecar.frameCount ||
                            sidecar.aviFilename.replace(/\.avi\.gz$/, '.face-events.json') !== filename) {
                            throw new Error('Invalid face-events v3 output: ' + filename);
                        }
                        const lastOutput = sidecarEvidence[sidecarEvidence.length - 1];
                        if (lastOutput && sidecar.segmentIndex < lastOutput.segmentIndex) {
                            throw new Error('Sidecar segment order regressed at ' + filename);
                        }
                        const previous = sidecarEvidence.filter(part => part.segmentIndex === sidecar.segmentIndex).slice(-1)[0];
                        if (previous && (sidecar.partIndex !== previous.partIndex + 1 ||
                            sidecar.precedingFramePresentationTimeUs !== previous.lastPresentationTimeUs)) {
                            throw new Error('Sidecar order/cadence did not continue at ' + filename);
                        }
                        if (!previous && sidecar.partIndex !== 0) throw new Error('Part sequence did not start at zero: ' + filename);
                        let priorTime = sidecar.precedingFramePresentationTimeUs;
                        frames.forEach((record, index) => {
                            if (!record || record.frameIndex !== index || !Number.isSafeInteger(record.presentationTimeUs) ||
                                (priorTime !== null && priorTime !== undefined && record.presentationTimeUs <= priorTime)) {
                                throw new Error('Sidecar frame indexes/timestamps invalid: ' + filename + ' frame ' + index);
                            }
                            priorTime = record.presentationTimeUs;
                        });
                        const compact = {filename, segmentIndex: sidecar.segmentIndex, partIndex: sidecar.partIndex,
                            frameCount: frames.length, firstFrameIndex: frames[0].frameIndex,
                            lastFrameIndex: frames[frames.length - 1].frameIndex,
                            precedingFramePresentationTimeUs: sidecar.precedingFramePresentationTimeUs,
                            firstPresentationTimeUs: frames[0].presentationTimeUs,
                            lastPresentationTimeUs: frames[frames.length - 1].presentationTimeUs};
                        sidecarEvidence.push(compact);
                        completedSidecars.push(filename);
                    }
                    const acknowledgement = {filename, payload};
                    if (typeof WeakRef === 'function') acknowledgementRefs.push({filename,
                        kind: filename.endsWith('.avi.gz') ? 'avi' : filename.endsWith('.face-events.json') ? 'sidecar' : 'manifest',
                        ref: new WeakRef(acknowledgement)});
                    return acknowledgement;
                }}, completedSidecars, sidecarEvidence, acknowledgementRefs};
            };
            const runSustained = async workerCount => {
                const io = delayedTransport({delayMs: 40, transientRejectFirst: true});
                const captureId = `sustained-worker-${workerCount}`;
                let terminalStatusSnapshot;
                const capture = Facecrop.createCaptureSession({...common, captureId,
                    onEvent: event => { if (event.type === 'status') terminalStatusSnapshot = event; },
                    filenamePrefix: `sustained_w${workerCount}`, config: {pipeline: {analysisWorkerCount: workerCount}}, transport: io.transport});
                const startTime = performance.now();
                const prepared = await capture.prepare();
                if (prepared.status !== 'ready') throw new Error('prepare failed for worker count ' + workerCount + ': ' + JSON.stringify(prepared));
                const starting = capture.start();
                await Promise.all([starting, capture.start()]);
                const deadline = startTime + timeoutMs;
                const evidenceSamples = [];
                const sampledSidecars = new Set();
                while (new Set(io.writes.filter(x => x.filename.endsWith('.avi.gz')).map(x => x.filename)).size < targetParts) {
                    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${targetParts} parts at workerCount=${workerCount}; writes=${io.writes.length}; result=${JSON.stringify(capture.getResult().statistics)}`);
                    await new Promise(resolve => setTimeout(resolve, 250));
                    for (const filename of io.completedSidecars) {
                        if (sampledSidecars.has(filename)) continue;
                        sampledSidecars.add(filename);
                        if (window.gc) { window.gc(); await new Promise(resolve => setTimeout(resolve, 0)); window.gc(); }
                        const aviFilename = filename.replace(/\.face-events\.json$/, '.avi.gz');
                        const records = window.__facecropFrameEvidence.filter(record => record.filename === aviFilename);
                        evidenceSamples.push({filename, frameCount: records.reduce((total, record) => total + record.frameCount, 0),
                            observedArrays: records.length,
                            liveArraysAfterGc: records.filter(record => record.frames.deref() !== undefined).length,
                            duringCapture: true});
                    }
                }
                const firstStop = capture.stop(); const secondStop = capture.stop();
                const stopped = await firstStop;
                if (secondStop !== firstStop) throw new Error('Repeated stop returned a different terminal promise');
                await new Promise(resolve => setTimeout(resolve, 0));
                if (window.gc) { window.gc(); await new Promise(resolve => setTimeout(resolve, 0)); window.gc(); }
                const livePayloads = io.weakPayloads.filter(ref => ref.deref() !== undefined).length;
                const acknowledgements = io.acknowledgementRefs.map(record => ({filename: record.filename,
                    kind: record.kind, aliveAfterGc: record.ref.deref() !== undefined}));
                const terminalFrameEvidence = window.__facecropFrameEvidence.map(record => ({filename: record.filename,
                    frameCount: record.frameCount, liveAfterGc: record.frames.deref() !== undefined}));
                const report = metrics('sustained', captureId, io.writes, io.weakPayloads, io.totalBytes, io.attempts,
                    startTime, stopped, secondStop === firstStop, {workerCount, requestedParts: targetParts,
                        minimumFramesForRequestedParts: targetParts * 539, terminalStatusSnapshot,
                        terminalArtifactOutcomes: stopped.artifacts.map(({completion, ...artifact}) => artifact),
                        retriedFaceEvents: Object.values(io.attempts).some(count => count > 1),
                        liveTransportPayloadWeakRefsAfterGc: livePayloads, payloadWeakRefCount: io.weakPayloads.length,
                        completedFrameEvidenceSamplesDuringCapture: evidenceSamples,
                        sidecarFrameEvidence: io.sidecarEvidence,
                        terminalFrameEvidenceArrays: terminalFrameEvidence,
                        liveAnalysisFrameArraysAtTerminal: terminalFrameEvidence.filter(record => record.liveAfterGc).length,
                        transportAcknowledgementRefs: acknowledgements,
                        liveTransportAcknowledgementRefsAfterGc: acknowledgements.filter(record => record.aliveAfterGc).length});
                if (report.status !== 'complete') throw new Error('sustained capture did not complete: ' + JSON.stringify(report));
                if (report.distinctParts < targetParts) throw new Error('capture produced too few distinct AVI parts: ' + JSON.stringify(report));
                if (report.workerLiveAtTerminal !== 0 || report.frameCallbacksAtTerminal !== 0) throw new Error('resources remain live after stop: ' + JSON.stringify(report));
                return report;
            };
            const runAbort = async workerCount => {
                const io = delayedTransport({delayMs: 10, holdFirst: true});
                const captureId = `abort-worker-${workerCount}`;
                const capture = Facecrop.createCaptureSession({...common, captureId,
                    filenamePrefix: `abort_w${workerCount}`, config: {pipeline: {analysisWorkerCount: workerCount}}, transport: io.transport});
                const startTime = performance.now(); await capture.start();
                await Promise.race([io.firstWrite, new Promise((_, reject) => setTimeout(() => reject(new Error('No upload reached transport before abort deadline')), timeoutMs))]);
                const abortRequestedAt = performance.now();
                const firstAbort = capture.abort(); const secondAbort = capture.abort();
                const aborted = await Promise.race([firstAbort, new Promise((_, reject) => setTimeout(() => reject(new Error('abort waited on held upload')), 5000))]);
                if (secondAbort !== firstAbort) throw new Error('Repeated abort returned a different terminal promise');
                const countAtAbort = io.writes.length;
                if (delayedTransport.releaseHeld) delayedTransport.releaseHeld();
                await Promise.allSettled(aborted.artifacts.map(item => item.completion).filter(Boolean));
                await new Promise(resolve => setTimeout(resolve, 100));
                if (window.gc) { window.gc(); await new Promise(resolve => setTimeout(resolve, 0)); window.gc(); }
                const acknowledgements = io.acknowledgementRefs.map(record => ({filename: record.filename,
                    kind: record.kind, aliveAfterGc: record.ref.deref() !== undefined}));
                const report = metrics('abort', captureId, io.writes, io.weakPayloads, io.totalBytes, io.attempts,
                    startTime, aborted, secondAbort === firstAbort, {workerCount, writesAtAbort: countAtAbort,
                        writesAfterRelease: io.writes.length, abortRequestLatencyMs: performance.now() - abortRequestedAt,
                        pendingCompletionCount: aborted.artifacts.filter(item => item.completion).length,
                        transportAcknowledgementRefs: acknowledgements,
                        liveTransportAcknowledgementRefsAfterGc: acknowledgements.filter(record => record.aliveAfterGc).length});
                if (report.status !== 'aborted') throw new Error('abort status mismatch: ' + JSON.stringify(report));
                if (io.writes.length !== 1) throw new Error('abort allowed another write after the first started upload: ' + JSON.stringify(report));
                if (report.workerLiveAtTerminal !== 0 || report.frameCallbacksAtTerminal !== 0) throw new Error('resources remain live after abort: ' + JSON.stringify(report));
                return report;
            };
            try {
                const sustained = [];
                for (const count of [1, 2]) sustained.push(await runSustained(count));
                const aborted = [];
                for (const count of [1, 2]) aborted.push(await runAbort(count));
                return {sustained, aborted, streamTrackStateAfter: stream.getVideoTracks()[0].readyState};
            } finally { clearInterval(drawTimer); stream.getTracks().forEach(track => track.stop()); }
        }, {mountPath: mount, targetParts: SUSTAINED_PARTS, timeoutMs: TIMEOUT_MS});
        for (const report of [...result.sustained, ...result.aborted]) {
            assert.equal(report.workerLiveAtTerminal, 0);
            assert.equal(report.frameCallbacksAtTerminal, 0);
        }
        for (const report of result.sustained) {
            assert(report.sidecarFrameEvidence.length >= SUSTAINED_PARTS,
                `Too few validated sidecars for workerCount=${report.workerCount}`);
            if (process.env.FACECROP_REQUIRE_FRAME_OBSERVATION === '1') {
                assert(report.completedFrameEvidenceSamplesDuringCapture.length > 0 &&
                    report.completedFrameEvidenceSamplesDuringCapture.every(sample =>
                        sample.observedArrays === 1 && sample.frameCount > 0),
                `No sidecar frame arrays were observed during capture for workerCount=${report.workerCount}`);
                assert(report.terminalFrameEvidenceArrays.length >= report.sidecarFrameEvidence.length,
                    `Terminal frame-array observations are missing for workerCount=${report.workerCount}`);
                const terminalNames = new Set(report.terminalFrameEvidenceArrays.map(item => item.filename));
                report.sidecarFrameEvidence.forEach(sidecar => assert(terminalNames.has(
                    sidecar.filename.replace(/\.face-events\.json$/, '.avi.gz')),
                `No terminal frame-array observation for ${sidecar.filename}`));
            }
            if (process.env.FACECROP_ASSERT_FRAME_RELEASE === '1') {
                assert.equal(report.liveAnalysisFrameArraysAtTerminal, 0,
                    `Frame evidence remains reachable after capture for workerCount=${report.workerCount}`);
            }
            if (process.env.FACECROP_ASSERT_TRANSPORT_ACK_RELEASE === '1') {
                assert.equal(report.liveTransportAcknowledgementRefsAfterGc, 0,
                    `Transport acknowledgements still retain payloads for workerCount=${report.workerCount}`);
            }
        }
        assert.equal(result.streamTrackStateAfter, 'live', 'facecrop stopped application-owned camera stream');
        assert(requests.some(url => url.endsWith('facecrop.worker.js')));
        assert(requests.some(url => url.includes('.wasm')));
        assert(requests.some(url => url.endsWith('/model/model.json')));
        const output = {browser: browser.version(), requestedPartsPerWorkerCount: SUSTAINED_PARTS,
            minFramesPerSustainedRun: SUSTAINED_PARTS * PART_FRAMES,
            mount, runtimeAssetChecks, frameReleaseAssertion: process.env.FACECROP_ASSERT_FRAME_RELEASE === '1',
            actualPartCounts: result.sustained.map(x => x.distinctParts), realWorkers: true, wasm: true,
            deviceCamera: false, instrumentationLimits: ['Chromium headless canvas stream, not a physical camera',
                'WeakRef collection and performance.memory are diagnostic signals, not complete native/GPU memory accounting'], result};
        console.log(JSON.stringify(output));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
