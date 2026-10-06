# Facecrop browser library

This directory is a standalone, submodule-ready browser library. It is an ordinary directory inside the existing `openDST` Git submodule; it does not initialize another Git repository.

## Build and test

From this directory, run:

```sh
npm ci
npm run build
npm run verify:dist
npm test
```

The supported project toolchain recorded for this checkout is Node 22.x with npm 10.x. These files have been exercised on Node 22.16.0 and npm 10.9.2; other major versions are not currently claimed. On a fresh openDST checkout, install both locked dependency trees and explicitly stage the validated browser distribution before starting, testing, or building the CRA host:

```sh
npm ci
npm --prefix facecrop ci
npm run facecrop:stage
```

`facecrop:stage` builds and verifies the standalone output and then stages its generated CRA entry, public URL metadata, and content-hashed runtime directory. It never installs dependencies. Ordinary `npm start`, `npm test`, and `npm run build` do not build or stage facecrop. If you change facecrop sources, rerun the explicit stage command first. Failed build or staging validation preserves the previous usable output. Prior hash directories are retained so already-open pages can finish fetching their runtime assets; remove old versions only as a separate deployment cleanup after they are no longer referenced.

A real Chromium acceptance run also checks classic worker loading, TFJS WASM/model fetches, completed artifact writes, and abort behavior. Playwright and its Chromium binary stay outside the package's normal lockfile and install:

```sh
npm install --prefix /tmp/facecrop-browser --no-save --package-lock=false playwright
PLAYWRIGHT_MODULE=/tmp/facecrop-browser/node_modules/playwright /tmp/facecrop-browser/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/facecrop-browser/node_modules/playwright npm run test:browser
```

The lockfile pins the Webpack 4 build tool, test tools, TFJS 4.22.0, the TFJS WASM backend 4.22.0, and BlazeFace 0.1.0. `npm run build` writes `dist/facecrop.js` (UMD), `dist/facecrop.worker.js` (classic worker), the versioned `dist/tfjs/4.22.0/` runtime/WASM/model assets, third-party license notices, and `dist/asset-manifest.json`. `npm run verify:dist` checks the complete required file set and recomputes the manifest's SHA-256 directory hash. Publish the complete `dist/` contents under a path ending in that directory value, such as `/assets/facecrop/<assetDirectory>/`, and keep that URL stable. The openDST CRA integration stages the same distribution under `/facecrop/<assetDirectory>/` and derives the runtime URL from `PUBLIC_URL`. Use HTTPS or localhost for camera and `VideoFrame` APIs.

The worker is intentionally classic: it loads TensorFlow.js, the WASM backend, and BlazeFace with `importScripts`. Keep `facecrop.worker.js` and `tfjs/` at the same distribution root. The library accepts the absolute directory URL as `assetBaseUrl`, so it can be deployed under a versioned or nested path without a build-time `PUBLIC_URL`.

## Browser API

Load the UMD bundle and pass host-owned video, transport, and study context explicitly:

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
  // Later, after the host finishes recording:
  const result = await capture.stop();
</script>
```

`transport.write` must return a promise that resolves after persistence. `prepare` probes capture support without saving. `start` begins capture, `stop` drains workers and persists the manifest, `abort` cancels and does not create a manifest, and `dispose` cleans up an unstarted session. Operations return structured results; check `status`, `reasonCode`, `statistics`, and per-artifact outcomes. `createJatosTransport(jatosApi)` adapts a supplied JATOS API object without reading globals.

Configuration is strict. Supported groups are `roi` (`smoothingTauMs`, `scale`, `verticalShiftRatio`), `detector` (`minConfidence`), `pipeline` (`analysisWorkerCount`), `persistence` (`maxAttempts`, `retryDelayMs`), and `diagnostics`. Unknown fields and invalid values throw during session creation.

The library source is licensed under GPL-3.0-only. TensorFlow.js, its WASM backend, BlazeFace, and the bundled BlazeFace model use Apache-2.0; the distribution includes their license text and notice.

## Integration examples

- [React example](examples/react/FacecropRecorder.jsx) imports the built UMD library and passes host-owned video, transport, and context.
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

Use numeric values, not strings. Missing fields receive defaults; supplied invalid values fail validation. The library always generates a unique capture ID unless the host supplies one. A custom ID must be unique across recordings. `filenamePrefix` and custom IDs accept letters, digits, underscores, and hyphens; context identifiers are stored separately as JSON.

## Refactor validation and retention policy

The campaign's [acceptance report](docs/campaign/acceptance-report.md) records exact browser/JATOS workloads and remaining platform limits. After building, external Playwright can run `node tests/browser-sustained.cjs` (set `FACECROP_SUSTAINED_PARTS=6`, `FACECROP_REQUIRE_FRAME_OBSERVATION=1`, `FACECROP_ASSERT_FRAME_RELEASE=1`, and `FACECROP_ASSERT_TRANSPORT_ACK_RELEASE=1` for the full retention gates). `node tests/browser-jatos.cjs` requires the documented disposable local JATOS seed/workbench archive; it never modifies a participant study.

Completed frame/encoded payloads and settled transport acknowledgements are released by the sink. Compact artifact history grows with part count; the openDST host retains one latest compact status per capture ID. Caller-held completion promises/context remain caller-owned. Abort prevents new facecrop writes, preserves observable in-flight completions, and cannot prove remote absence after rejection. In openDST, “Cancel and submit data without video” submits `save_without_video`; it does not retract recordings already uploaded or in flight. The host owns camera tracks, navigation, withdrawal and deletion policy.
