/* Real Chromium acceptance: classic workers, TFJS WASM/model, transferred frames, persistence and abort. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const distribution = path.resolve(__dirname, '../dist');
const mount = '/study_assets/other-study/facecrop/';
const types = {'.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream'};

async function main() {
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
    try {
        browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        const result = await page.evaluate(async mountPath => {
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
            const drawing = canvas.getContext('2d');
            const draw = () => { drawing.fillStyle = '#6080a0'; drawing.fillRect(0, 0, 96, 96); };
            draw();
            const interval = setInterval(draw, 30);
            const video = document.querySelector('video');
            const stream = canvas.captureStream(30); video.srcObject = stream; await video.play();
            const writes = [];
            const api = {uploadResultFile: async (payload, filename) => {
                writes.push({filename, data: typeof payload === 'string' ? payload :
                    Array.from(new Uint8Array(await payload.arrayBuffer()))});
            }};
            const common = {video, assetBaseUrl: new URL(mountPath, location.href).href,
                filenamePrefix: 'p42_speech_trial2', context: {participant: 'p42', task: 'speech', trial: 2}};
            try {
                const capture = Facecrop.createCaptureSession({...common, transport: Facecrop.createJatosTransport(api)});
                const prepared = await capture.prepare();
                if (prepared.status !== 'ready') throw new Error('Preparation failed: ' + JSON.stringify(prepared));
                if (writes.length) throw new Error('Preparation persisted artifacts');
                await capture.start();
                await new Promise(resolve => setTimeout(resolve, 650));
                const completed = await capture.stop();
                if (completed.status !== 'complete') throw new Error('Capture failed: ' + JSON.stringify(completed));
                const trackAfterStop = stream.getVideoTracks()[0].readyState;
                let beginWrite, releaseWrite;
                const firstWrite = new Promise(resolve => { beginWrite = resolve; });
                const pendingWrite = new Promise(resolve => { releaseWrite = resolve; });
                const abortedWrites = [];
                const aborted = Facecrop.createCaptureSession({...common, transport: {write: ({filename}) => {
                    abortedWrites.push(filename); beginWrite(); return pendingWrite;
                }}});
                await aborted.start();
                await new Promise(resolve => setTimeout(resolve, 300));
                const stopping = aborted.stop();
                await firstWrite;
                const outcome = await Promise.race([aborted.abort(), new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Abort waited for unresolved upload')), 2000))]);
                const beforeRelease = abortedWrites.length;
                const pending = outcome.artifacts.filter(artifact => artifact.completion).map(artifact => artifact.completion);
                if (!pending.length) throw new Error('Abort lost started write completion');
                releaseWrite(); await Promise.allSettled(pending); await stopping;
                if (abortedWrites.length !== beforeRelease) throw new Error('Abort started another write');
                return {completed, writes, trackAfterStop, aborted: {status: outcome.status,
                    beforeRelease, afterRelease: abortedWrites.length, pending: pending.length}};
            } finally { clearInterval(interval); stream.getTracks().forEach(track => track.stop()); }
        }, mount);
        assert.equal(result.completed.status, 'complete');
        assert.equal(result.trackAfterStop, 'live', 'library stopped application camera tracks');
        assert.equal(result.aborted.status, 'aborted');
        const avi = result.writes.find(write => write.filename.endsWith('.avi.gz'));
        const sidecar = JSON.parse(result.writes.find(write => write.filename.endsWith('.face-events.json')).data);
        const manifest = JSON.parse(result.writes.find(write => write.filename.endsWith('_manifest.json')).data);
        assert(avi.filename.startsWith('p42_speech_trial2_'));
        assert.equal(zlib.gunzipSync(Buffer.from(avi.data)).subarray(0, 4).toString(), 'RIFF');
        assert(sidecar.analysis.frames.length >= 2);
        assert.equal(sidecar.frameCount, sidecar.analysis.frames.length);
        sidecar.analysis.frames.forEach((frame, index, frames) => {
            assert.equal(frame.frameIndex, index);
            if (index) assert(frame.presentationTimeUs > frames[index - 1].presentationTimeUs);
        });
        assert.equal(manifest.summary.status, 'complete');
        assert.equal(manifest.capture.context.participant, 'p42');
        assert(!manifest.diagnostics, 'verbose debugging leaked into default output');
        assert(requests.some(url => url.endsWith('facecrop.worker.js')));
        assert(requests.some(url => url.includes('.wasm')));
        assert(requests.some(url => url.endsWith('/model/model.json')));
        console.log(JSON.stringify({browser: browser.version(), frames: sidecar.frameCount,
            files: result.writes.length, aborted: result.aborted, realWorkers: true, wasm: true}));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
