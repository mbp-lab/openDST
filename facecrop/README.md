# Facecrop browser library

## Purpose

Facecrop adds an optional, on-device video capture path for studies that need face-region footage for remote photoplethysmography (rPPG) analysis. It detects and crops the face in the browser, downsamples frames to 72×72, and saves them as gzip-compressed AVI with lossless pixel encoding and timestamped crop metadata.

Use it when your analysis needs more image fidelity than the study's ordinary lossy MP4/WebM recording preserves. Facecrop produces an additional analysis recording; it does not replace the study's regular video. Cropping and downsampling still discard spatial detail, and capture can skip frames under load, so check the supplied timestamps and test performance on your target devices before enabling it.

The library has no React or study-framework dependency. It accepts an application-owned video element, explicit configuration and asset URL, and a promise-based transport. See [integration boundaries](docs/coupling.md) for the responsibilities that remain with the consuming study.

## Build and test

From this directory, run:

```sh
npm ci
npm run build
npm run verify:dist
npm test
```

The supported project toolchain is Node 22.x with npm 10.x. These files have been exercised on Node 22.16.0 and npm 10.9.2; other major versions are not currently claimed.

Reusable staging and rollback are implemented in `scripts/stage-distribution.cjs`. Each consuming application supplies its own generated-entry directory, public asset root, URL prefix and work directory.

To stage an already-built distribution into a consuming application, supply explicit destinations:

```js
const {stageDistribution} = require('./scripts/stage-distribution.cjs');
stageDistribution('/path/to/facecrop/dist', {
  generatedDirectory: '/path/to/application/generated',
  publicRoot: '/path/to/application/public/assets/facecrop',
  publicSubpath: '/assets/facecrop/',
  workRoot: '/path/to/application'
});
```

The generated files are `facecrop.js` and `facecropAssets.json`; the latter supplies the matching runtime URL. `workRoot` must exist and support renaming staged files into the destinations.

The consuming application can call `stageDistribution` with its own destinations after building. Staging verifies the distribution, preserves the previous usable output if validation fails, and retains prior content-hashed asset directories so already-open pages can finish fetching runtime assets. Remove old versions only after they are no longer referenced.

A real Chromium acceptance run also checks classic worker loading, TFJS WASM/model fetches, completed artifact writes, and abort behavior. Playwright and its Chromium binary stay outside the package's normal lockfile and install:

```sh
npm install --prefix /tmp/facecrop-browser --no-save --package-lock=false playwright
PLAYWRIGHT_MODULE=/tmp/facecrop-browser/node_modules/playwright /tmp/facecrop-browser/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/facecrop-browser/node_modules/playwright npm run test:browser
```

The lockfile pins the Webpack 4 build tool, test tools, TFJS 4.22.0, the TFJS WASM backend 4.22.0, and BlazeFace 0.1.0. `npm run build` writes `dist/facecrop.js` (UMD), `dist/facecrop.worker.js` (classic worker), the versioned `dist/tfjs/4.22.0/` runtime/WASM/model assets, third-party license notices, and `dist/asset-manifest.json`. `npm run verify:dist` checks the complete required file set and recomputes the manifest's SHA-256 directory hash. Publish the complete `dist/` contents under a path ending in that directory value, such as `/assets/facecrop/<assetDirectory>/`, and keep that URL stable. Use HTTPS or localhost for camera and `VideoFrame` APIs.

The worker is intentionally classic: it loads TensorFlow.js, the WASM backend, and BlazeFace with `importScripts`. Keep `facecrop.worker.js` and `tfjs/` at the same distribution root. The library accepts the absolute directory URL as `assetBaseUrl`, so it can be deployed under a versioned or nested path without a build-time `PUBLIC_URL`.

## Browser API

Load the UMD bundle and pass application-owned video, transport, and study context explicitly:

```html
<script src="/assets/facecrop/<assetDirectory>/facecrop.js"></script>
<script type="module">
  const capture = Facecrop.createCaptureSession({
    video: document.querySelector('video'),
    captureId: 'session-123',
    filenamePrefix: 'speech',
    context: { studyPage: 'speechTask' },
    assetBaseUrl: new URL('/assets/facecrop/<assetDirectory>/', location.href).href,
    transport: {
      write: ({filename, payload}) => saveStudyArtifact(filename, payload)
    },
    onEvent: event => console.log(event),
    config: { roi: { scale: 1.5 }, detector: { minConfidence: 0.5 } }
  });
  await capture.prepare();
  await capture.start();
  // Later, after the application finishes recording:
  const result = await capture.stop();
</script>
```

`transport.write` must return a promise that resolves after persistence. `prepare` probes capture support without saving. `start` begins capture, `stop` drains workers and persists the manifest, `abort` cancels and does not create a manifest, and `dispose` cleans up an unstarted session. Operations return structured results; check `status`, `reasonCode`, `statistics`, and per-artifact outcomes. `createJatosTransport(jatosApi)` adapts a supplied JATOS API object without reading globals.

Configuration is strict. Supported groups are `roi` (`smoothingTauMs`, `scale`, `verticalShiftRatio`), `detector` (`minConfidence`), `pipeline` (`analysisWorkerCount`), `persistence` (`maxAttempts`, `retryDelayMs`), and `diagnostics`. Unknown fields and invalid values throw during session creation.

The library source is licensed under GPL-3.0-only. TensorFlow.js, its WASM backend, BlazeFace, and the bundled BlazeFace model use Apache-2.0; the distribution includes their license text and notice.

## Integration examples

- [React example](examples/react/FacecropRecorder.jsx) imports the built UMD library and passes application-owned video, transport, and context.
- [Plain browser/JATOS example](examples/plain-browser/index.html) uses the explicit JATOS adapter and the hash path from `asset-manifest.json`.

See [metadata interpretation and migration](docs/metadata.md) and [integration boundaries](docs/coupling.md).

Contributor references: [processing contract](docs/processing.md) and [follow-up work](docs/backlog.md).

## Configuration defaults and limits

| Setting | Default | Accepted values |
|---|---|---|
| `roi.smoothingTauMs` | 100 | Integer 0–10000; 0 disables smoothing |
| `roi.scale` | 1.5 | Number 1–3 |
| `roi.verticalShiftRatio` | 0.15 | Number −1–1; positive moves the crop upward |
| `detector.minConfidence` | 0.5 | Number 0–1 |
| `pipeline.analysisWorkerCount` | 1 | Integer 1–2 |
| `persistence.maxAttempts` | 3 | Integer 1–10 |
| `persistence.retryDelayMs` | 100 | Integer 0–60000; retry wait is this value × attempt number |
| `diagnostics` | false | Boolean; opt-in verbose troubleshooting evidence |

Use numeric values, not strings. Missing fields receive defaults; supplied invalid values fail validation. The library always generates a unique capture ID unless the application supplies one. A custom ID must be unique across recordings. `filenamePrefix` and custom IDs accept letters, digits, underscores, and hyphens; context identifiers are stored separately as JSON.

## Capture lifecycle and persistence

Completed frame and encoded payloads are released by the sink after processing and transport settle. The returned result and caller-held context remain application-owned. `abort()` prevents new writes but cannot retract a write already in flight or prove that a rejected write was not stored. The consuming study owns camera tracks, recording lifecycle, navigation, participant withdrawal and any remote deletion policy.
