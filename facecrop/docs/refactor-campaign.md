# Facecrop audit and refactor campaign — archived scope

Brief status: complete. Campaign status: complete; see the [final disposition](campaign/disposition.md) and [acceptance report](campaign/acceptance-report.md). This document preserves the original agreed scope and execution protocol as a historical record. Its investigative instructions and starting-point findings are not current tasks or descriptions of the final implementation. Use the linked acceptance report for final results and [backlog](backlog.md) for follow-up work.

Date: 2026-10-06.

## Objective

Make facecrop easier to understand, operate, and reuse in other web studies, including JATOS studies and React or plain-browser hosts. Reduce accidental complexity while preserving scientific evidence, explicit lifecycle behavior, and clear ownership of resources and side effects.

The extraction established a reusable boundary. This campaign examines the implementation behind that boundary and the openDST integration, rather than assuming that extraction alone resolved complexity.

Success means that configuration has a clear source of truth, resources have identifiable owners, terminal operations have predictable behavior, retained memory matches a documented policy, persistence outcomes accurately describe what is known, and consumers can build and deploy the library through a documented, validated path.

## Agreed direction

- Explore all identified areas: memory/persistence, lifecycle, host integration, configuration, accounting, compatibility, build/deployment, examples, and processing architecture.
- API and schema changes are permitted when evidence supports them. Make the decision reviewable before implementation: show the problem, alternatives, affected consumers, migration, and validation.
- Prefer focused regressions, sustained browser capture tests, and JATOS packaging/upload checks. Add device validation when a proposed change depends on device behavior.
- Preserve the current marker-based cancellation policy. “Cancel and submit data without video” submits a `save_without_video` marker; it does not promise to retract recordings already uploaded or in flight. Document this behavior. Keep withdrawal and remote deletion policy in the host.
- Keep facecrop submodule-ready as an ordinary directory. Do not create an actual submodule or choose a remote repository during this campaign.
- Preserve the local `src/Main.js` startup edit: page index 1, slide index 4. Exclude it from campaign commits.

The user has settled the broad scope and policy. Routine implementation choices do not require another question. Ask when new evidence exposes a scientific, participant-facing, compatibility, or supported-platform decision that these agreements do not resolve.

## Starting point

Work on the existing openDST branch `rppg-facecrop-lib-extraction`.

Extraction checkpoints:

| Commit | Scope |
|---|---|
| `a2c7897` | Standalone facecrop library |
| `82b3038` | openDST integration |
| `4fd85bc` | Recording lifecycle and cancellation |

Facecrop lives in `facecrop/`; the study adapter remains in `src/faceCrop/`. The workbench repository's recorded openDST Git link has not been advanced. Do not update it or push changes without an applicable instruction.

## Starting architecture and ownership

| Layer | Responsibility | Important boundary |
|---|---|---|
| Public session (`src/Session.js`, relative to facecrop) | Validate options, expose prepare/start/stop/abort/dispose/results, isolate observer errors | Explicit video, transport, assets and configuration; no camera acquisition |
| Capture controller (`src/FaceCropCapture.js`) | Native frame callbacks, worker jobs, ordering, stage accounting and finalization | Browser resources and drain order |
| Classic worker (`src/FaceCropPipeline.worker.js`) | Analysis, ordered assembly and encoding roles | Transfer ownership, ordering and off-main-thread work |
| Output sink (`src/FaceCropOutput.js`) | Backpressure, retries, artifact ledger and completion | Remote persistence is uncertain after a rejected write |
| Metadata/configuration modules | Resolved settings, scientific provenance and health | Persisted schemas consumed by analysis tools |
| openDST adapter (`../../src/faceCrop/FaceCropCapture.js`) | Study configuration, upload tracker, capture registration | Study-specific choices remain outside the library |
| WebcamCapture/Main/dialogs | Ordinary recording, capture registry, navigation and cancellation | Host owns camera, navigation and withdrawal policy |
| Build/staging scripts | Standalone distribution and CRA/JATOS deployment assets | Generated files, runtime URLs, pinned model/WASM and notices |

React is a host choice. The reusable API consumes a host-owned video element and a promise-based transport. The JATOS adapter is optional and receives its API instance explicitly.

## Evidence and its limits

Evidence comes from source inspection, delegated read-only audits, existing regression suites, build/package checks, a real-worker Chromium smoke test, and a disposable Node retention fixture. Root independently inspected the key memory, lifecycle, configuration, accounting and staging boundaries.

| Finding | Evidence | Interpretation and limit |
|---|---|---|
| Completed uploads retain per-frame evidence | Sink `entries` retain `part.faceEvents.analysis.frames`; only compressed bytes and the pending queue are cleared | Full frame history grows with capture duration; the bounded pending queue does not bound all retained memory |
| Retention persists after finalization | Fixture: 200 completed parts, 100,000 frame records, no pending uploads or compressed buffers, about 34.4 MiB heap growth | Synthetic Node measurement, not a browser/mobile memory estimate |
| Lifecycle state overlaps | Session/controller/adapter each coordinate promises; WebcamCapture rewrites host handle stop/abort methods; Main tracks active captures | Some layers express necessary ownership; eliminate duplication only after tracing races |
| Persistence representations overlap | Part entries/results, file ledgers, inventories, manifest outcomes and session results | Several are references/views, not proven duplicate JSON allocations |
| Unattempted sidecar status is ambiguous | AVI exhaustion prevents sidecar write but labels the sidecar `failed` | Distinguish an unattempted artifact from a rejected write; rejected transport remains `uncertain` |
| Configuration/policy is translated repeatedly | Public defaults and translation, controller metadata reconstruction, worker selection policy | Maintenance drift risk; not evidence that current scientific behavior is wrong |
| Accounting transitions are distributed | Submission, processing, assembly, encoding and persistence update separate counters | Reconciliation assumes valid counts; abort/discard semantics need explicit treatment |
| Host commands have implicit build/install effects | prestart/prebuild/pretest build and stage facecrop; version mismatch can invoke nested npm ci | Ordinary test/start commands can mutate assets and require installation/network access |
| Staging verification is incomplete | Two JS outputs and hash syntax are checked, not the complete runtime tree/hash agreement | A plausible but inconsistent distribution can pass staging checks |
| Deployment examples duplicate inputs | Plain-browser example repeats the asset hash and assumes a study mount | Avoidable setup friction and URL mismatch risk |

Previously validated: 71 standalone tests, 17 frontend tests, production builds, 27 isolated JATOS runner checks, and Chromium capture using actual workers/WASM/model with abort during an unresolved upload. The browser smoke test used a native canvas stream and a test transport.

These checks do not establish sustained resource behavior, physical camera behavior, Android/iOS support, or a complete browser-to-real-JATOS upload/cancellation path. Existing unrelated HTTPS test failures are outside this campaign; do not report the entire repository as passing.

### Evidence source map

Paths below are relative to this document. The findings describe the extraction checkpoints above; recheck them against the working tree before acting.

| Area | Authoritative source and existing checks |
|---|---|
| Retention, retries, inventories | [Output sink](../src/FaceCropOutput.js), [sink tests](../tests/FaceCropOutput.test.js) |
| Public lifecycle and controller | [Session](../src/Session.js), [controller](../src/FaceCropCapture.js), [session tests](../tests/Session.test.js), [controller tests](../tests/FaceCropCapture.test.js) |
| Host lifecycle/cancellation | [Host adapter](../../src/faceCrop/FaceCropCapture.js), [WebcamCapture](../../src/components/WebcamCapture.js), [Main](../../src/Main.js), [CancelDialog](../../src/components/CancelDialog.js), [Redirection](../../src/components/Redirection.js) |
| Host race checks | [Webcam lifecycle tests](../../src/components/WebcamCapture.lifecycle.test.js), [Main tests](../../src/Main.faceCrop.test.js), [adapter tests](../../src/faceCrop/FaceCropHost.test.js) |
| Settings and accounting | [Configuration](../src/Configuration.js), [Accounting](../src/Accounting.js), [accounting tests](../tests/Accounting.test.js) |
| Scientific contracts | [Metadata](../src/Metadata.js), [metadata documentation](metadata.md), [processing documentation](processing.md), [normalization](../src/FrameNormalization.js), [worker tests](../tests/FaceCropPipeline.test.js) |
| Build and deployment | [Standalone builder](../scripts/build.cjs), [host staging](../../scripts/vendor-face-detector-assets.js), [standalone package](../package.json), [host package](../../package.json) |
| Consumer examples and browser check | [Plain-browser example](../examples/plain-browser/index.html), [React example](../examples/react/FacecropRecorder.jsx), [Chromium smoke test](../tests/browser-smoke.cjs) |
| Existing boundaries and deferred profiling | [Coupling documentation](coupling.md), [backlog](backlog.md) |

The original audit reports, retention script/results and validation logs were session artifacts under `/tmp/facecrop-campaign-*` and `/tmp/facecrop-*tests.log`. They are not durable repository fixtures. The reproducible baseline and final results are now preserved in [campaign/baseline.md](campaign/baseline.md) and the acceptance report; temporary session files are not required.

To reproduce the retention observation, enqueue 200 parts of 500 realistic frame records through the sink with an immediately resolving transport, finalize, then inspect retained records, pending work and compressed buffers. Record before/after heap with explicit GC when available, identifying the Node version and synthetic workload. The encoded bytes in the original fixture were synthetic; it was an object-retention experiment, not an AVI validity or throughput test.

## Workstreams

### A. Memory retention and persistence outcomes — first priority

Investigate retained objects through enqueue, successful upload, retry exhaustion, abort before write, abort during write, finalization and host capture history.

First candidate: retain compact part identity/outcomes and release completed frame metadata. Keep uploaded sidecars unchanged. Inventory must no longer require full `entry.part` objects. An in-flight write must retain what it needs until its actual completion; abort must still expose completion promises and return promptly.

Then examine whether result arrays, file ledgers and inventories can be derived from a canonical record without losing observable history. Clarify the status of sidecars that were never attempted. Do not infer remote absence from a rejected promise.

Acceptance:

- Completed frame records and compressed buffers become unreachable after their last legitimate use.
- Full frame payload retention is bounded by active work, rather than completed capture duration.
- Compact artifact history may grow with part count; measure and document that separately.
- Uploaded frame evidence, timing, filenames and payload formats remain equivalent unless an approved migration says otherwise.
- Success, exhaustion, queued abort and in-flight abort have truthful inventory/result outcomes.
- No new writes/retries begin after abort; unresolved writes remain observable.

### B. Lifecycle and host integration — second priority

Map one owner for camera tracks, MediaRecorder, frame callbacks, workers, queued parts, terminal promises, capture registration and navigation. Write transition/race traces before changing code.

Investigate replacing mutation of session handle methods with explicit host cleanup coordination. Remove duplicate promise/state layers only when their responsibilities can be represented clearly elsewhere.

Cover preparation failure, repeated start/stop, abort superseding stop, navigation before unmount, cancellation-induced unmount, prepare-only disposal, failed recording setup and late transport completion. Include the adjacent ordinary-recorder chunk/filename reuse concern in the audit; propose any fix separately with evidence.

Acceptance:

- Normal page transitions await required finalization.
- Ordinary recording stops at the intended boundary, independent of slow facecrop uploads.
- Abort stays prompt; stop preserves useful partial data.
- No double upload, stale callback, leaked worker or missed registry removal.
- Library operations never stop host-owned camera tracks or navigate.
- React unmount cleanup is a fallback, not a substitute for awaited finalization.
- Cancellation preserves the agreed marker policy and accurately describes it.

### C. Configuration, accounting and internal compatibility

Trace every public setting from validation through runtime use to persisted metadata. Consolidate policy constants and resource caps where that reduces drift. Prefer canonical resolved configuration over repeated translations, while keeping useful separation between public settings and private implementation details.

Map accounting transitions and test the equations against real failure/discard paths. Consider a canonical ledger or transition helpers only if they make attribution and review simpler. Normal-finalization reconciliation remains the current contract; do not silently redefine aborted-capture validity.

Remove legacy internal kwargs or adapters only after checking production consumers, examples, tests and filenames. Internal legacy arguments are not automatically public compatibility obligations, but pinned scientific filenames and stored evidence require deliberate treatment.

Acceptance:

- Unknown keys, invalid bounds and implicit coercion remain rejected.
- Default/custom effective settings match runtime behavior and metadata.
- Frame counters remain nonnegative integers with meaningful failure attribution.
- Counts reconcile for supported terminal paths; partial abort results are clearly described.
- Public and stored compatibility impacts are inventoried before changes.

### D. Build, packaging, deployment and examples

Make installation, compilation and staging explicit and discoverable. Evaluate retaining convenient automation versus introducing a documented setup/stage command; ordinary commands must not conceal network installs or destructive replacement of deployment assets.

Define and verify a distribution contract: UMD entry, classic worker, WASM, detector model, manifest and license notices. Recompute hashes with the same documented exclusion rules as the builder. Validate before replacing the existing staged tree.

Clarify the supported reusable artifact. Current integration consumes a built browser distribution; the package is private. npm distribution is an option to evaluate, not an assumed requirement. Verify a clean consumer before claiming a supported pack/install contract.

Reduce examples to one deployment input where practical. State the supported Node/npm toolchain and test it; do not expand this into an unmotivated legacy CRA upgrade.

Acceptance:

- Documented clean-checkout setup succeeds and failures give actionable instructions.
- Missing/corrupt assets fail verification before usable staged assets are removed.
- Repeated builds/staging produce matching runtime hashes and files.
- Nested JATOS mounts and non-root host public URLs resolve every runtime asset.
- React and plain-browser examples describe awaited finalization and camera ownership correctly.
- Supported distribution mechanism and package metadata agree.

### E. Processing and browser resource architecture

Profile analysis, ordered assembly, encoding, queue waits, main-thread work and memory over sustained captures. Examine full-frame copying/buffer reuse and resource caps. Treat adaptive throttling, ROI-only extraction and analysis FPS limits as separate scientific proposals because they can change sampling or evidence.

The worker split has a purpose: off-main-thread work, transferable ownership and ordered output with multiple analysis workers. Keep it unless measurement supports a simpler architecture with equal or better correctness and resource behavior.

Acceptance:

- Frame indexes and presentation timestamps remain ordered and correct across part boundaries.
- Scientific crop selection, normalization and output encoding remain equivalent for unchanged configuration.
- Queues and transferable resources have explicit bounds and cleanup.
- Performance claims include workload, browser, hardware, duration and measurement limits.
- Device-dependent changes receive camera/orientation/color-space validation on relevant devices.

## Decision and implementation protocol

For each candidate, record:

1. Concrete problem and reproducible evidence; distinguish observation from inference.
2. Current owner/contract and affected code/consumers.
3. Smallest useful change and alternatives, including leaving the design intact.
4. API/schema/filename/scientific/participant-facing impact.
5. Acceptance gates, fixtures, expected improvement and residual uncertainty.
6. Migration and rollback plan when compatibility changes.
7. Decision, implementation result and validation evidence.

Keep proposals and results together in this campaign documentation or linked decision notes. Do not bundle unrelated changes merely because the same file is involved. Preserve working semantic checkpoints and commit separate concerns after validation. Approval of the campaign is not evidence that a particular architectural rewrite is worthwhile.

## Validation plan

Use three layers:

- **Focused regressions:** scientific output invariants, stage accounting, truthful persistence outcomes, configuration sanity checks and meaningful lifecycle races. Add tests for changed boundaries, not assertions that merely mirror implementation.
- **Sustained browser tests:** real workers/WASM/model, multiple parts, one/two analysis workers, slow/rejected transports, stop/abort races and repeated captures. Measure retained frame records, live resources and memory trend; heap measurements alone are insufficient. Choose duration/part count that demonstrates steady-state behavior, and record them rather than presenting a short smoke test as sustained validation.
- **JATOS integration:** deterministic archive contents and nested asset loading, plus a real browser/JATOS upload path for AVI, sidecar and manifest outcomes. Verify marker-based cancellation. Isolated runner checks and mocked transport tests remain useful but cannot replace this path.

Physical desktop/mobile camera checks are conditional gates for device-sensitive changes. If an environment cannot exercise a required gate, report the exact gap and leave the corresponding claim unverified. Do not silently replace real-server/device evidence with mocks.

Compare against baseline before measuring improvement. Preserve a baseline output corpus for metadata/AVI compatibility and a baseline race matrix. Repeat broad checks only after relevant changes or unresolved failures.

### Baseline commands and prerequisites

These commands remain reproduction entry points; final gate coverage is recorded in the acceptance report. Run sequentially where generated assets are shared. Install locked dependencies explicitly. The campaign removed implicit host hooks; run `npm run facecrop:stage` before host commands on a clean checkout or after library changes.

From the openDST repository root:

```sh
npm ci
npm --prefix facecrop ci
npm --prefix facecrop test
npm --prefix facecrop run build
npm run facecrop:stage
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

The host commands require its installed lockfile dependencies (`npm ci` from openDST). The standalone build should also be checked without an inherited `NODE_OPTIONS` setting. The supported toolchain is Node 22/npm 10; the validated versions are Node 22.16.0/npm 10.9.2. Other major versions are not claimed supported.

For the existing browser smoke test, build first, then use the external Playwright/Chromium setup documented in the [library README](../README.md):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright npm --prefix facecrop run test:browser
```

The browser and any required system libraries must be available. Set `PLAYWRIGHT_BROWSERS_PATH` when using a custom browser installation. Do not add Playwright to the library's locked runtime just to run this external acceptance harness. This command remains a short canvas-stream/mock-transport test; the stronger final harnesses are now `tests/browser-sustained.cjs` and `tests/browser-jatos.cjs`, with durable results linked in the acceptance report.

From the workbench root, packaging and the existing isolated runner checks use:

```sh
./build-study.bash
./tests/test-run-study.bash /absolute/path/to/generated-study.jzip
```

Packaging requires a valid local study manifest, installed tooling and a writable archive destination selected by `JATOS_HOME`; it installs/builds the frontend and writes logs/archive output. The runner requires an installed JATOS and a provisioned matching seed. It creates a disposable fixture, but can exit successfully with `SKIPPED` if prerequisites are missing. Inspect its summary: an exit code alone does not prove its checks ran. Do not modify a real participant study or treat runner success as browser-upload evidence.

### Campaign artifacts and gate coverage

| Deliverable | Required contents | Current status |
|---|---|---|
| Baseline record | Commit/worktree identity, environment, commands, output corpus, retention workload and race matrix | Recorded with pinned-source/browser evidence and AVI/sidecar corpus; see [baseline](campaign/baseline.md) |
| A proposal/result | Retention ownership, compact ledger contract, persistence-status decision, before/after retention evidence | Implemented and validated; [decision/results](campaign/memory-persistence.md) |
| B proposal/result | Resource owner table, state/transition map, host race traces and cancellation documentation | Implemented/retained with owner, race and history evidence; [results](campaign-lifecycle.md) |
| C proposal/result | Config flow, policy/constants inventory, accounting transitions and compatibility impact | Implemented canonical host defaults/count checks; retained scientific/normal-only contracts; [results](campaign/config-accounting.md) |
| D proposal/result | Distribution contract, setup/stage behavior, hash verification, examples and toolchain support | Implemented and validated clean consumer, recovery and packaging; [results](build-deployment-decision.md) |
| E profiling/disposition | Reproducible workload, resource measurements, worker-design decision and any scientific proposal | Six-part baseline/final profiling and explicit retained/deferred decisions; [results](campaign/processing-disposition.md) |
| Acceptance report | Focused tests, sustained browser results, actual JATOS upload evidence, device checks where required, remaining gaps | Final focused, sustained, actual JATOS and packaging/runner evidence; [report](campaign/acceptance-report.md) |
| Final disposition register | Every finding mapped to implemented, retained or deferred, with rationale, gates and commits | Every finding mapped with rationale, evidence and commits; [register](campaign/disposition.md) |

Mark a gate passed only with evidence matching its scope. Track missing tools or environments separately from test failures. A deferral may complete an exploration item, but it must not be used to declare an implemented change validated when its required acceptance gate remains unmet.

## Delegation and sequencing

Use bounded `gpt-6-luna` medium tasks for evidence gathering and narrow implementation where practical. Keep token-heavy file reading in those agents. Root owns scope, user decisions, shared-file coordination and critical acceptance review. Use an independent reviewer for high-risk changes when feasible.

Parallelizable work:

| Task | Agent boundary | Dependency |
|---|---|---|
| Memory/persistence proposal | Sink, metadata contracts, retention fixture | Baseline contract review |
| Lifecycle proposal | Session/controller/host transition map | Cancellation policy, now settled |
| Build/deployment proposal | Build/staging scripts, package/examples | Independent of memory/lifecycle |
| Config/accounting proposal | Settings flow and transition ledger | Coordinate controller ownership with lifecycle work |
| Independent review | Diff plus acceptance evidence | Implementation checkpoint |

Do not allow concurrent agents to edit shared controller/host files. Parallelize read-only maps and independent build work; serialize overlapping implementations. Keep each task's output concise: evidence, proposal, gates, unresolved decisions and file ownership.

Suggested sequence:

1. Capture baselines and review concrete proposals.
2. Implement/review memory release and persistence truthfulness.
3. Implement/review lifecycle ownership changes.
4. Advance build/deployment independently where files do not overlap.
5. Consolidate configuration/accounting using the stabilized lifecycle.
6. Profile processing and decide whether any structural change is justified.
7. Run cross-workstream browser/JATOS gates and finalize documentation.

## Completion criteria

The campaign is complete when every scoped area has an evidence-backed disposition: implemented improvement, retained design with rationale, or explicitly deferred item with a reason and unresolved gate. Exploration does not require rewriting every area.

This criterion has been met. The final disposition and acceptance report record the evidence and explicit deferrals; there are no pending campaign acceptance entries.

Implemented changes must satisfy their acceptance gates, have reviewable compatibility decisions and migrations where needed, and be captured in semantic commits. Documentation must state remaining limitations, supported deployment behavior and cancellation policy. Preserve the user's startup edit, avoid creating a facecrop submodule, and leave workbench Git-link updates and publication outside this authorization.
