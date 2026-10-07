# Configuration and accounting evidence (workstream C)

Status: C1/C2 implemented with focused validation; no controller transition changes. The flow and transition observations below describe extraction checkpoint 4fd85bc; the implementation sections record current changes. The persisted metadata is scientific provenance, so any change to effective values, equations, status meanings or output identity requires a compatibility decision and baseline comparison.

## Configuration flow and sources

1. `createCaptureSession` validates `options.config` through `validateConfiguration`. `Configuration.js` is the library public default/validation source: ROI smoothing 100 ms, scale 1.5, vertical shift 0.15; detector confidence 0.5; one analysis worker; persistence 3 attempts / 100 ms linear retry base; diagnostics false. It rejects unknown keys, coercion and out-of-range values, freezes resolved groups, and returns the public object on `session.config`.
2. `controllerConfiguration` translates public names into the flat internal controller contract (`faceRoiSmoothingTauMs`, `faceDetectionMinConfidence`, `maxAttempts`, etc.). Controller uses it to size analysis workers, bound in-flight analysis, configure sink retries, and construct worker initialization payloads.
3. Worker runtime receives explicit flattened settings. `FaceRoiProvider` and detector constructors still carry matching defaults (100, 1.5, 0.15, 0.5) as fallback values for direct/internal use. Runtime session path supplies the validated values.
4. openDST adapter separately parses environment strings and repeats public ranges/defaults in `src/faceCrop/FaceCropStudyAdapter.js`, then invokes library validation. It currently hardcodes persistence defaults (3/100) because no study env settings exist. This is study policy translation, but repeated defaults/ranges can drift.
5. `FaceCropCaptureController.configurationMetadata()` reconstructs persisted values and hardcodes detector/runtime/model versions, pipeline policy `largest-eligible-bounding-box-v1`, output sampling policy and other effective behavior. `buildCaptureManifest()` in `Metadata.js` overlays implementation/backend/model/runtime identifiers a second time. Worker loading separately pins TFJS path at `4.22.0`; builder/vendor scripts also define these deployed asset versions. These are duplicated representations with different roles: effective setting, scientific algorithm identity, and build/runtime identity. They should be consolidated only after mapping all persisted and deployed contracts.

Concrete config candidates: export/share one defaults/ranges schema for the study adapter where bundling permits; distinguish study environment parsing from library validation; make manifest construction consume a canonical effective-provenance object rather than reassembling values; keep worker fallback defaults only if internal direct worker construction is supported and tested. Do not change any default, confidence, worker limit, or scientific policy as cleanup.

## Accounting transitions and limits

`accounting` initializes all stage frame counts at zero. `processAnalysisFrame` increments `submittedFrames` after a `VideoFrame` is created and immediately before worker submission. Ordered assembly commits increment `processedFrames`; rejected worker/assembly work increments `failedProcessingFrames`. An accepted assembly commit increments `acceptedFrames`; each sealed part increments `sealedFrames`. Encoder success increments `encodedFrames`; encoder rejection increments `failedEncodingFrames`. At normal sink finalization, controller derives `persistedFrames` from parts whose whole AVI+sidecar status succeeded, and `failedPersistenceFrames` from every other finalized part status, including uncertain outcomes. `callbackGaps` copies observed `presentedFrames` discontinuities. Queue wait times are durations, not frame counts.

Normal-finalization reconciliation checks:

- `submittedFrames = processedFrames + failedProcessingFrames`
- `acceptedFrames = sealedFrames`
- `sealedFrames = encodedFrames + failedEncodingFrames`
- `encodedFrames = persistedFrames + failedPersistenceFrames`

`consistent` means only that stage counts balance, not that every stage succeeded or that a face was detected. `callbackGaps` are deliberately not assigned to an inferred cause.

Abort is a different accounting path. Aborted in-flight frame tasks increment `discardedFrames`; sink abort can mark queued artifacts discarded, and a part may already have incremented `sealedFrames` before the `aborted` check prevents encoding. Abort skips normal `finalize()` and thus does not run reconciliation or derive final persistence counters. This means the current equations are explicitly a normal-finalization integrity check, not an all-terminal invariant. Some discarded/started write facts live in the sink inventory/result and study tracker, not these frame equations. Do not force abort counts into the current equations without defining whether each unit is a submitted frame, a sealed part's frame count, or an artifact outcome.

Concrete accounting candidates: make the normal-only reconciliation scope explicit in schema/docs and report whether reconciliation was performed; add a terminal-path disposition summary for abort only if it can account separately for outstanding processing, sealed-but-unencoded work, queued artifacts and started writes without double counting; expose per-equation checks on normal incomplete finalization as today. The first is documentation/schema clarity; the latter is a contract change needing fixture evidence.

## Compatibility and legacy names

Public sessions use capture IDs. Patch filename shape is `<prefix>_<captureId>_patch_sNNN_pNNN.avi.gz`, sidecars replace the suffix, and manifests use `<prefix>_<captureId>_manifest.json`. Capture ID makes repeated facecrop artifacts distinct even if a readable prefix repeats.

`createPatchVideoFilename()` retains internal compatibility branches when `filenamePrefix` is absent: with legacy study identity it emits `<studyResultId>_<studyPage>_<videoCounter>_<captureId>_patch_sNNN_pNNN.avi.gz` (or without capture ID when absent); with capture ID alone it emits `<captureId>_patch...`. The comment says public sessions use `filenamePrefix`; these are internal/test compatibility, not a documented consumer API. Existing output tests pin at least the identity-only branch and public prefixed shape. Removing or changing the fallback could break internal fixtures or an undocumented direct controller caller; inventory callers/tests before deprecation. Keep manifests and sidecars matched to their AVI names.

Persisted contracts include manifest v1, face-events v3, AVI format `patch-video-avi-gzip-bgr24-v1`, configuration/provenance fields, and accounting field names. Existing metadata docs provide migration paths from older field placement. Any accounting-schema alteration should be versioned or additive and accompanied by consumer search and representative corpus comparison. In particular, do not conflate `failedPersistenceFrames` (a finalized part not known successful, including uncertain) with proof that remote bytes are absent.

## Disposition and gates

Retain strict public configuration validation and current defaults/scientific policy; they make the resolved run reproducible and reject silent coercion. Retain stage equations for normal finalization, explicitly scoped to that path. Retain legacy filename generation until direct callers and old test fixtures are inventoried; it is low-cost compatibility but should be labeled internal.

Before implementing consolidation, capture baseline manifests for default and non-default config, worker count 1/2, successful and failed persistence, and compare byte/metadata contracts. Gate any accounting or schema change on focused transition fixtures for processing failure, encoding failure, upload failure/uncertainty, and abort at each stage; verify analysis consumers tolerate additive/versioned changes. No scientific configuration or persisted schema change is proposed by this evidence note.

### C1 decision before implementation: study defaults

Use `validateConfiguration()` as the study adapter's source of default ROI, detector, worker and persistence settings. Retain study string parsing and its actionable environment-variable errors; final library validation still rejects invalid values. This removes duplicated fallback values without changing public API, metadata, scientific defaults or study environment variables. Alternatives are a separately exported schema (larger API) and leaving duplicated literals (drift remains). Existing adapter default/custom configuration tests and standalone validation tests are the focused gate. Rollback reinstates the literals. Runtime/metadata policy consolidation and a canonical accounting ledger remain deferred until the broader terminal-path fixtures and corpus support a concrete improvement.

### C2 decision before implementation: validate count domain

`reconcileAccounting` can call negative or fractional counts consistent when the arithmetic equations balance (for example submitted and processed both -1, all other counts zero). Require all stage frame counts and acceptedFrames to be nonnegative safe integers as an additive `checks.counts` gate. The existing equations and normal-only scope remain unchanged; no counter transitions or abort validity are redefined. Source consumer search found the controller uses only reconciliation status; no code indexes an exact four-check tuple. Stored readers should tolerate the additive check; old records omit it. Alternatives are throwing on invalid counts (loses useful integrity diagnostics) and assuming valid inputs (can produce false scientific validity). Tests cover invalid domains and existing valid failure counts. Rollback removes the additional check; existing data remains readable.

### C implementation evidence so far

C1 is implemented in the openDST adapter; library defaults now supply every study fallback including persistence. The focused study test compares defaults and partial custom environment values with library resolution. C2 is implemented in `Accounting.js` with invalid-domain fixtures; existing balanced failure paths still pass. On Node 22.16.0, the current standalone suite passed 83 tests across seven suites and the focused study lifecycle/configuration suites passed 14 tests across three suites. This is a working checkpoint, not the final acceptance report: the standalone total includes concurrent A/D regressions, whose final results are recorded in their own notes. Normal-only accounting and abort partial-result semantics are retained; broader failure-path runtime fixtures were still outstanding at this checkpoint and are covered by the final results below.

Controller failure-path fixtures now drive real submission, assembly/encoding and sink transitions with substituted worker/transport boundaries. Processing rejection, encoding rejection and three rejected AVI writes each finish incomplete with balanced nonnegative stage counts and the expected failure attribution; rejected AVI persistence remains uncertain and its sidecar unattempted. These add stronger evidence than hand-constructed algebra alone. At that checkpoint the full standalone suite had 87 tests across seven suites; frontend: 20 tests across six suites. Production study build succeeds beneath `/study_assets/facecropping_test/` using explicitly staged assets. B/C independent review found no production regression; historical wording was clarified.

Historical final campaign acceptance: 94 standalone tests and 24 frontend tests pass; actual default runtime and custom initialization settings retain the same metadata/scientific policy. The final hash, actual JATOS outcomes and all requirement evidence are in [acceptance-report.md](acceptance-report.md).
