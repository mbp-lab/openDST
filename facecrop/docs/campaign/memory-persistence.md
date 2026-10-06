# A: retention and persistence decision

Decision recorded 2026-10-06 before implementation. Implementation and final campaign acceptance are complete; scope and remaining platform limits are in [acceptance-report.md](acceptance-report.md).

## Observed contract

At extraction checkpoint 4fd85bc, `FaceCropSink.enqueuePart` stores the encoded artifact in `entries[].part`. Successful completion clears `gzipBytes`, but retains `faceEvents` and every frame record. `inventory()` reads only the two filenames from the part. Results already contain compact capture/part identity, counts, byte length and outcomes. This is a source observation; the reproducible retention baseline is being recorded separately.

After AVI retry exhaustion, `uploadWithRetry` correctly reports the AVI as `uncertain` (a rejected transport promise does not prove remote absence). `uploadPart` reports the never-written sidecar as `failed`, attempts zero. This obscures the distinction between rejected writes and unattempted artifacts.

## Chosen change and alternatives

Keep a compact identity on each part entry and make inventory/observer notifications read that identity. Release the entry's payload reference once the part settles, and release queued payloads immediately on abort. A started part retains the evidence needed for its remaining write until completion. Avoid clearing caller-owned frame arrays: dropping the sink reference is sufficient and preserves evidence held intentionally by a caller. Remove closures over the full artifact from queued completion chains so discarded queued work cannot keep frames alive behind an unresolved earlier write.

Use `not_attempted` for sidecars skipped because AVI persistence did not succeed; use `discarded` when abort forbids the sidecar. Keep the logical part `failed` and study upload tracker `FAILED`, since those express incompleteness rather than remote absence. Keep rejected artifact writes `uncertain`.

Alternatives: retain the design (fails bounded payload retention); erase frame arrays in place (mutates consumer evidence); replace all ledgers with one canonical ledger now (larger compatibility surface without evidence of duplicated payloads). Retain compact results and file ledgers for now, and measure their separate growth.

## Consumers and compatibility

Affected consumers are Session results, controller manifests, study artifact observers and inventory readers. No filename, AVI bytes, sidecar JSON, frame timing, crop selection or normalization change is intended. Inventory/status consumers must accept `not_attempted`; old `failed` with attempts zero remains readable in stored manifests. This is an additive status vocabulary change; document it in metadata documentation and cover manifests/results. There is no stored-data rewrite. Rollback restores the old status and retention representation without changing uploaded files.

## Gates

Compare against the durable baseline: 200 parts of 500 records, explicit GC when available, Node version and compact-history size. Completed sink entries must retain zero frame payloads; active payloads must remain bounded by admitted work. Verify unchanged uploaded payloads and filenames, success, AVI exhaustion, sidecar exhaustion, queued abort, abort during AVI and sidecar writes, abort during retry delay, late resolve/reject, and repeated abort. No new write or retry may start after abort. Pending completion promises must remain observable and abort must return promptly.

Run the focused suite, sustained real-worker browser capture and real JATOS upload gates before claiming the implementation validated. Synthetic object retention does not establish browser/mobile memory performance. Study capture-history retention requires separate inspection.

## Implementation result (2026-10-06)

`FaceCropSink` now stores compact identity on each entry, derives inventory and observer events from that identity, and drops its part reference when upload completion settles. Queued abort drops payload references immediately; a producer waiting on backpressure and resumed by abort records a compact discarded result without starting writes or emitting a pending event. Active AVI/sidecar writes retain their needed payload until completion. AVI retry exhaustion leaves the sidecar `not_attempted`; abort that prevents sidecar start records it as `discarded`. Rejected in-flight writes remain `uncertain`, while the logical part and study tracker retain failure outcomes.

On Node `v22.16.0`, the pinned-source fixture (`--baseline`) retained 100,000 frame records after 200 × 500 synthetic records and explicit GC, with about 34.37 MiB heap growth. The current worktree run retains zero payload parts and zero frame records (200 compact part records, 400 file records), with about 0.40 MiB heap growth. The checked-in [baseline corpus](baseline.md#compatibility-corpus) includes AVI bytes, gzip payload, and the v3 sidecar; those bytes were verified against serializer modules extracted from the pinned `4fd85bc` source. The focused facecrop suite passed 77/77 tests across seven suites after adding success, exhaustion, queued/in-flight abort, retry-delay abort, late rejection, repeated-abort, and payload-release coverage. The existing tests confirm the sidecar serialization passed to the transport remains unchanged.

These checks establish the sink-level retention and outcome behavior for the synthetic fixture. Sustained browser memory/resource trends, physical-device behavior, and a real JATOS upload/cancellation path remain unverified campaign gates; study capture-history retention also remains a separate investigation.

## A2 decision before implementation: settled transport acknowledgements

The completion audit reproduced an additional retention path with a supported promise-based transport that resolves to `{payload}`. After finalize and explicit GC, the sink's part payload was null but both fulfilled file-ledger promises still retained their returned Blob/string boxes. The transport's return value is not used in part results or manifests; retaining that fulfilled promise is past its last legitimate sink use. Clear the internal file-ledger completion reference after the actual write settles (resolve or reject). Keep already-exposed completion promises unchanged for callers and keep unresolved writes observable. Alternatives are restricting transport return values (unnecessary API change) or retaining acknowledgements (violates bounded payload policy for echoing transports). This is internal resource ownership only: no schema, filename, scientific or upload behavior change. Regression gates include echoing success, echoed late completion after abort, rejection/retry and retained unresolved promise observation, followed by final artifact browser/JATOS gates. Rollback removes the clearing statements; uploaded artifacts are unaffected.

A2 focused regression passed (20 sink tests), and independent review found no completion-observability regression. The reproducible `--echo-payload` workload now records 400 acknowledgements for 200 × 500 frames. Pinned baseline retains all 400 payload boxes and 100,000 frame records (~63.68 MiB heap growth); current code retains zero boxes/completion promises/frame records (~0.77 MiB). Both compact result/inventory projections serialize to 143,515 bytes. Exact reports: [baseline](retention-echo-baseline.json), [current](retention-echo-current.json). The larger heap delta differs from the original non-echo transport workload; compare only like workloads. Caller-owned completion promises can still intentionally retain their resolved values after the sink releases them.

Final frozen-source browser evidence is [sustained-final.json](sustained-final.json), compared with the independently verified [pinned baseline](sustained-pinned-baseline.json): seven frame arrays and 15 acknowledgements retained before, zero after for both worker counts; completed parts also release original arrays during continued capture. Actual JATOS success, rejected-response uncertainty and abort/marker outcomes are proven in [the final report](jatos-acceptance-final-result.json). Study compact-history policy is measured and recorded with B; no required adopted-change gate remains pending.
