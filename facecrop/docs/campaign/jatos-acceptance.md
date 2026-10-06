# Real JATOS browser acceptance

Status: passed on 2026-10-06 against final distribution `c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c`. Exact final output is preserved in [jatos-acceptance-final-result.json](jatos-acceptance-final-result.json). The harness is `tests/browser-jatos.cjs` and uses Playwright/Chromium outside the library dependencies.

The harness creates a fresh fixture under `/tmp`, copies `run-study.bash`, its two required helper files, the provisioned seed for the installed JATOS version, and the disposable `facecropping_test.jzip`. It starts JATOS through the copied runner and waits for `JATOS_STUDY_URL`. It imports into that fixture only, replaces that imported study's `index.html`, and copies the current facecrop distribution into the fixture's nested study asset mount. JATOS paths point at the fixture's `runtime-data`; the harness snapshots installed JATOS data directories and requires them to remain unchanged. It stops the runner and removes the temporary fixture after a successful check. If cleanup cannot be confirmed, it retains and reports the fixture path for inspection.

The browser creates a synthetic canvas camera stream, calls the actual `createCaptureSession` and `createJatosTransport(window.jatos)`, and checks normal AVI/sidecar/manifest uploads in the JATOS result-upload tree, including gzip/RIFF and JSON content plus write order. A second capture holds the response to an AVI upload only after the real JATOS upload promise resolves. The harness aborts while the library sees that response as pending, releases it afterward, checks the already accepted AVI remains, verifies no face-events sidecar or further capture write is stored, and submits a real `config.txt` beginning with `save_without_video` through JATOS.

Run after the standalone build/stage using the disposable JATOS seed and external browser installation:

```sh
PLAYWRIGHT_MODULE=/tmp/facecrop-browser/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/tmp/facecrop-browser/browsers \
LD_LIBRARY_PATH=/tmp/facecrop-browser/runtime/lib/x86_64-linux-gnu:/tmp/facecrop-browser/runtime/usr/lib/x86_64-linux-gnu \
FACECROP_EXPECTED_DIST_HASH=c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c \
node facecrop/tests/browser-jatos.cjs
```

Executed result: JATOS 3.11.1, Playwright Chromium 153.0.8010.12, Node v22.16.0. The final run stored and validated normal AVI gzip/RIFF, sidecar JSON and manifest in `study-result_1/comp-result_1`; actual upload order was AVI, sidecar, then manifest. Both stored sidecars were linked to manifest parts and checked for frame indexes, within-part timestamp order and cross-part timestamp continuity. The two parts held 539 and 5 frames.

The harness then uploaded AVI, sidecar, and manifest files through real JATOS, waited for each real API call to resolve, and deliberately rejected its response. Each capture returned `incomplete` and marked the affected output `uncertain` after three accepted server writes. AVI response loss left the sidecar `not_attempted`; its AVI bytes remained stored. The sidecar response-loss bytes also remained stored. The manifest response-loss capture returned manifest status `uncertain` even though the accepted manifest bytes remained on the server. A separate real AVI upload was accepted before its response was held; abort returned in 0.4 ms, retained that AVI, and issued no sidecar write. The `save_without_video` `config.txt` marker persisted, and the installed JATOS data snapshot was unchanged. The final report records archive and output hashes.

This is a real browser-to-local-JATOS path with actual JATOS persistence, but it remains a local seeded instance and synthetic stream. It does not establish production JATOS behavior, participant experience, or physical camera/device compatibility. Those gates remain unverified; this acceptance does not claim them.
