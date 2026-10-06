# Facecrop campaign baseline

Recorded 2026-10-06 from the `openDST` checkout before campaign production edits.

## Source and environment

- `openDST` HEAD: `4fd85bc6e031f33f3dd3aad6207e25b69fd8d595` (the extraction lifecycle checkpoint).
- Workbench HEAD was not advanced. The openDST worktree already had the user's `src/Main.js` startup change (page index 1, slide index 4); it is outside this baseline and must be preserved.
- Node `v22.16.0`; npm `10.9.2`.
- Locked facecrop package: `@opendst/facecrop` 0.1.0, Jest 24.9.0. Tool versions identify the measured environment; they do not establish the supported Node/npm floor.

## Retention reproduction

Run from `openDST/` after installing the facecrop lockfile dependencies. The first command loads the sink, metadata and upload-status modules from the pinned extraction commit using `git show`; the second measures the current worktree:

```sh
node --expose-gc facecrop/scripts/retention-baseline.cjs --baseline
node --expose-gc facecrop/scripts/retention-baseline.cjs
```

Both runs construct 200 sink parts with 500 frame records each. Every frame carries presentation time, wall clock, source dimensions, detection, selection/bounding box and ROI metadata matching the face-event shape. The transport resolves immediately; encoded bytes are one-byte synthetic placeholders. On Node `v22.16.0` with explicit GC, the pinned pre-refactor run retained 200 payload parts, 100,000 reachable frame records and 400 file-ledger entries, with zero pending uploads, zero retained compressed buffers, and about 34.37 MiB heap growth. The current worktree run retains zero payload parts and zero frame records, with 200 compact part entries and 400 file-ledger entries, zero pending uploads, zero compressed buffers, and about 0.40 MiB heap growth. Heap growth varies with runtime and is diagnostic, not a browser/mobile estimate; structural retained-record count is the primary result. This fixture measures object retention, not AVI validity, upload throughput, or camera resources.

## Baseline commands and observed evidence

Run sequentially from `openDST/` to avoid shared generated assets:

```sh
npm --prefix facecrop ci
npm --prefix facecrop test
npm --prefix facecrop run build
npm ci
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

The retained baseline logs report 71/71 standalone facecrop tests passing across six suites, 17/17 frontend tests, successful standalone and production builds, 27 isolated JATOS runner checks, and a Chromium real-worker/WASM/model smoke run (`browser 153.0.8010.12`, 19 frames, 3 files). The browser test used a canvas stream and mocked transport. After workstream A, the standalone suite passes 77 tests across seven suites, including regressions for bounded retention, truthful skipped-sidecar status, queued abort, AVI/sidecar in-flight rejection, retry-delay abort, repeated abort, and unchanged sidecar serialization. These are historical or focused results, not campaign-wide acceptance. The JATOS runner may skip when prerequisites are absent, so inspect its summary.

Browser smoke prerequisites and invocation are documented in [README](../../README.md). It is an external Playwright setup and is not installed by the facecrop package:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright npm --prefix facecrop run test:browser
```

Workbench packaging/runner checks from the workbench root (when a valid study manifest, dependencies and local JATOS are provisioned):

```sh
./build-study.bash
./tests/test-run-study.bash /absolute/path/to/generated-study.jzip
```

## Compatibility corpus

The checked-in [output regression suite](../../tests/FaceCropOutput.test.js) pins output behavior: indexed top-down BGR24 AVI headers and frame/index bytes, timestamp-derived frame rate, deterministic AVI/sidecar filenames, segment boundaries, compact manifest shape, and paired upload result outcomes. A deterministic two-frame output from the extraction serializers is preserved in [the corpus manifest](output-corpus/manifest.json), with uncompressed AVI bytes, the gzip upload payload and matching v3 sidecar, each carrying a SHA-256 digest. The bytes were regenerated from modules extracted with `git show 4fd85bc6e031f33f3dd3aad6207e25b69fd8d595:facecrop/src/...` and compared byte-for-byte with the corpus. It uses synthetic pixels and metadata with production shape. [Metadata documentation](../metadata.md) and [processing documentation](../processing.md) describe persisted fields and scientific interpretation.

## Existing race and terminal-path matrix

| Scenario | Existing check | Current baseline coverage |
|---|---|---|
| Work bounded while uploads stall; finalize drains admitted work | `FaceCropOutput.test.js`: “owns at most one active and one queued part, then finalizes after parts settle” | Sink backpressure/order and successful drain |
| AVI failure/retry exhaustion | `FaceCropOutput.test.js`: “retries a part three times and reports one terminal failure” | Three rejected attempts; sidecar not attempted |
| AVI succeeds, sidecar fails | `FaceCropOutput.test.js`: “marks the logical part incomplete when its JSON sidecar fails” | Sidecar retries and incomplete part result |
| Abort while queue is full and first write unresolved | `FaceCropOutput.test.js`: “abort releases enqueue backpressure and inventories pending completion without waiting for a write” | Prompt abort, queued discard, unresolved completion exposed |
| Abort supersedes pending preparation | `Session.test.js`: “abort supersedes stop while preparation is pending” | Preparation/stop ordering |
| Abort cancels preparation callback and preserves host track ownership | `Session.test.js`: “abort cancels a pending preparation callback and never owns tracks” | No camera ownership by library |
| Detector and assembly work must drain before manifest finalization | `FaceCropCapture.test.js`: “drains detector and assembly work before manifest finalization” | Processing drain ordering |
| Stop/abort/navigation/unmount/camera races in host | `WebcamCapture.lifecycle.test.js`, `Main.faceCrop.test.js`, `FaceCropHost.test.js` | See host suite; not a complete physical-camera or real-JATOS race matrix |

Still uncovered: repeated stop/start against a live browser capture, slow real JATOS upload during navigation, and sustained browser resource trends. These remain campaign gates rather than claims established by the short smoke test.
