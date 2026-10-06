# Campaign acceptance report

Campaign acceptance complete. The campaign accepted production source at `fcae374`; its validated built distribution was `c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c`. This report preserves that historical acceptance evidence. Subsequent tooling and naming changes are recorded in [integration boundaries](../coupling.md); they do not retroactively change the artifact tested here.

## Evidence scope

Campaign-time focused suites: 94 standalone tests in eight suites, 24 frontend tests in six suites (Node 22.16.0 / npm 10.9.2). These cover output/scientific invariants, persistence success/exhaustion/abort, stage failures and invalid counts, default/custom settings, study lifecycle races, frame-transfer failures, and distribution verification/rollback. The source maps and notes below describe their boundaries rather than claiming physical-device or production-server validation.

- [Baseline and corpus](baseline.md): pinned extraction source, workload, race matrix, AVI/sidecar byte corpus. [Echo baseline](retention-echo-baseline.json) and [current](retention-echo-current.json) distinguish compact history from full frame/acknowledgement retention.
- [A decision/results](memory-persistence.md): completed/queued payload release, truthful unattempted/uncertain statuses, settled transport acknowledgement release.
- [B owner/race map](../campaign-lifecycle.md): explicit component coordinator, transfer ownership, latest status per capture and intentionally retained compact study history.
- [C flow/disposition](config-accounting.md): canonical study defaults, strict public validation, normal-only reconciliation with count-domain validation; abort is partial.
- [D contract/results](../build-deployment-decision.md): private complete browser distribution, explicit setup/stage, exact file/hash verification and failure recovery.
- [E profile/disposition](processing-disposition.md): worker design retained; full-frame copies and scientific sampling are unchanged.
- Final browser evidence: [pinned baseline](sustained-pinned-baseline.json), [six-part final](sustained-final.json), [root mount/repeated start](browser-root-mount-final.json). Positive original-frame observations, acknowledgement release, ordering, complete asset loading and tracked-resource cleanup pass.
- Final server/package evidence: [actual JATOS](jatos-acceptance-final-result.json), [package verification](packaging-acceptance-result.json), [all 27 runner checks](runner-final-summary.txt). Success, stored bytes despite rejected responses, and marker cancellation pass on the frozen artifact. Superseded intermediate browser/JATOS reports were removed; baseline comparisons and final evidence remain.
- Standalone build with `NODE_OPTIONS` unset reproduced the exact final hash. The worker binary SHA remains identical to the pinned extraction worker, strengthening unchanged scientific processing evidence.

## Resource ownership and retained policy

| Resource | Owner and bound | Release / history policy |
|---|---|---|
| Camera / MediaRecorder / navigation | Study | Library never stops camera tracks or navigates; component stops recorder before awaiting facecrop persistence |
| Frame callbacks | Controller; one outstanding callback | Cancel on terminal request, fallback on unmount |
| VideoFrame | Main request until successful transfer; analysis worker after transfer | Close on pre-transfer rejection/queued failure; worker closes in finally or realm terminates |
| Full RGBA frame / detector RGB tensor | Analysis then ordered assembly | At most 1–2 admitted analysis/buffered results; tensor disposed in finally; transfer moves backing buffer |
| Assembly results | Assembly worker; configured worker-count cap | Ordered sequence commits; clear on close |
| Partial crop part | Assembly; 539 × 72 × 72 × 3 bytes (~8.38 MB), plus frame evidence | Seal/transfer at boundary; current partial buffer released on close |
| Encoding work | Controller/encoder; one pending part | Transfer bytes; drop completed job |
| Encoded payloads / sidecar frames | Sink; at most two admitted parts | Release queued abort immediately, active writes on actual settlement; completed records contain compact outcomes only |
| Transport acknowledgement promise | Sink while actual write unresolved | Clear settled reference; caller-owned promise snapshots intentionally remain caller-owned |
| Artifact outcomes / capture history | Sink and study | Grows with part/capture count; retains compact evidence, one latest row per capture ID, not frame payloads or every status snapshot |

This is an object/ownership policy, not a total browser-memory ceiling. TFJS model/intermediate allocations, native/GPU memory, garbage-collector scheduling and transport implementations have additional costs. Arbitrary study context and diagnostic/rejection values remain caller-controlled evidence. No broad mobile-memory claim is made.

## Retained/deferred designs

Retain ordered analysis/assembly/encoding roles because current tests/profile show correct bounded transfer/order and no measured case for a rewrite. Full-frame RGBA→RGB conversion and tensor allocation remain; buffer reuse needs high-resolution profiling and transfer-safe design before adoption. ROI-only extraction, adaptive FPS and throttling are separate scientific changes and are not adopted.

Retain legacy internal filename fallbacks for stored/test compatibility; public sessions/examples use capture IDs and prefixes. No public/schema filename migration is required. Broader metadata-policy deduplication/canonical accounting ledger is deferred: current defaults and normal equations are validated, and there is no evidence that rewriting those layers improves scientific attribution.

Ordinary recorder chunk/filename reuse is a separately documented study risk, deferred pending supported repeated-counter behavior and compatibility evidence. No claim that it was fixed. npm publication is deferred; the supported artifact is the private browser tree, validated through CRA/JATOS consumption.

Physical desktop/mobile camera and production-server behavior, simultaneous sessions/high-resolution pressure, native/process RSS and broader browser performance comparison remain explicit follow-up profiling. None of this campaign's adopted changes alters camera format/orientation/color-space/crop/sampling, so conditional device-sensitive-change gates are not invoked.

## Requirement audit

| Acceptance requirement | Authoritative evidence and disposition |
|---|---|
| A: completed frame/buffer release, bounded active payload, compact history measured | Node 200×500 baseline/current; browser positive-array/acknowledgement before/after with live sessions; 6×539-frame workload per worker count; compact serialized projections and ownership caps |
| A: payload/timing/name equivalence and truthful success/exhaustion/abort inventories | Pinned AVI/sidecar corpus and unchanged worker binary; output regressions, sidecar timestamp/index checks, real stored JATOS outcomes |
| A: no further writes/retries after abort, unresolved completion observable | Queued/backpressure/retry-delay/late resolve/reject regressions; held-write browser/JATOS scenarios; caller snapshots preserved |
| B: awaited page finalization and recorder boundary independent of uploads | Main navigation/repeated-wait/late-unmount tests; coordinator recorder-stop-before-drain and rejection cleanup tests |
| B: prompt abort/useful partial stop, no duplicate/stale/leaked work or missed registry removal | Session/study/controller race tests; repeated browser start/stop/abort; ordered tail parts, zero tracked workers/callbacks; registry removal and prepare-only disposal |
| B: library camera/navigation boundary and marker policy | Borrowed-track tests; actual stream remains live after stop/abort; explicit study coordinator; actual accepted AVI remains plus stored save_without_video marker |
| C: strict validation, effective default/custom settings, meaningful integer counters | Public/study config tests and custom worker/sink/metadata initialization; invalid-domain and actual processing/encoding/persistence-failure transitions |
| C: supported terminal reconciliation and compatibility inventory | Normal-only reconciliation passes; abort deliberately partial; additive outcome/count migration documented; production public/example callers use capture IDs, legacy internal naming retained |
| D: clean setup and actionable explicit failure paths | Disposable locked installs and CRA consumer build; missing dependency guidance; ordinary hooks removed; workbench packaging explicitly installs/stages |
| D: complete runtime contract, safe corruption failure and repeated hashes | Exact 14-file/shared verifier, corruption/missing/schema/symlink checks, failed build/promotion/double-rollback fixtures, deterministic final hash and packaged-byte comparisons |
| D: root/nested asset resolution and correct examples/distribution/toolchain | All files fetched in Chromium at both mounts; actual JATOS nested loading; private browser-tree choice, one example URL input, React awaited callback/unmount fallback, Node 22.16/npm10.9 clean consumer |
| E: ordered timing/scientific equivalence and bounded cleanup | Multi-part original frame/cadence validation with one/two workers; unchanged worker bytes/corpus; explicit queue/transfer/resource owners and final cleanup |
| E: honest performance and device gates | Workload/hardware/browser/duration and forced-GC limits recorded; broader native/main-thread/high-resolution/device profiling deferred with retained architecture; no device-sensitive change adopted |
| Protocol/deliverables/worktree constraints | Linked baseline, A–E decision/results, final register/report, semantic commits; startup edit preserved, ordinary facecrop directory, recorded workbench Git link unchanged, no push/publication |

This audit supports campaign completion under its explicit implemented/retained/deferred criterion. Deferred exploration items have reasons and remaining gates; they are not used to claim an unvalidated implemented change passed. The whole workbench test suite is not claimed green; unrelated HTTPS tests remain outside this campaign.
