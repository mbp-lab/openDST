# A: retention and persistence decision

Decision recorded 2026-10-06 before implementation. Focused implementation is complete; campaign-wide acceptance remains pending.

## Observed contract

At extraction checkpoint 4fd85bc, `FaceCropSink.enqueuePart` stores the encoded artifact in `entries[].part`. Successful completion clears `gzipBytes`, but retains `faceEvents` and every frame record. `inventory()` reads only the two filenames from the part. Results already contain compact capture/part identity, counts, byte length and outcomes. This is a source observation; the reproducible retention baseline is being recorded separately.

After AVI retry exhaustion, `uploadWithRetry` correctly reports the AVI as `uncertain` (a rejected transport promise does not prove remote absence). `uploadPart` reports the never-written sidecar as `failed`, attempts zero. This obscures the distinction between rejected writes and unattempted artifacts.

## Chosen change and alternatives

Keep a compact identity on each part entry and make inventory/observer notifications read that identity. Release the entry's payload reference once the part settles, and release queued payloads immediately on abort. A started part retains the evidence needed for its remaining write until completion. Avoid clearing caller-owned frame arrays: dropping the sink reference is sufficient and preserves evidence held intentionally by a caller. Remove closures over the full artifact from queued completion chains so discarded queued work cannot keep frames alive behind an unresolved earlier write.

Use `not_attempted` for sidecars skipped because AVI persistence did not succeed; use `discarded` when abort forbids the sidecar. Keep the logical part `failed` and host upload tracker `FAILED`, since those express incompleteness rather than remote absence. Keep rejected artifact writes `uncertain`.

Alternatives: retain the design (fails bounded payload retention); erase frame arrays in place (mutates consumer evidence); replace all ledgers with one canonical ledger now (larger compatibility surface without evidence of duplicated payloads). Retain compact results and file ledgers for now, and measure their separate growth.

## Consumers and compatibility

Affected consumers are Session results, controller manifests, host artifact observers and inventory readers. No filename, AVI bytes, sidecar JSON, frame timing, crop selection or normalization change is intended. Inventory/status consumers must accept `not_attempted`; old `failed` with attempts zero remains readable in stored manifests. This is an additive status vocabulary change; document it in metadata documentation and cover manifests/results. There is no stored-data rewrite. Rollback restores the old status and retention representation without changing uploaded files.

## Gates

Compare against the durable baseline: 200 parts of 500 records, explicit GC when available, Node version and compact-history size. Completed sink entries must retain zero frame payloads; active payloads must remain bounded by admitted work. Verify unchanged uploaded payloads and filenames, success, AVI exhaustion, sidecar exhaustion, queued abort, abort during AVI and sidecar writes, abort during retry delay, late resolve/reject, and repeated abort. No new write or retry may start after abort. Pending completion promises must remain observable and abort must return promptly.

Run the focused suite, sustained real-worker browser capture and real JATOS upload gates before claiming the implementation validated. Synthetic object retention does not establish browser/mobile memory performance. Host capture-history retention requires separate inspection.

## Implementation result (2026-10-06)

`FaceCropSink` now stores compact identity on each entry, derives inventory and observer events from that identity, and drops its part reference when upload completion settles. Queued abort drops payload references immediately; a producer waiting on backpressure and resumed by abort records a compact discarded result without starting writes or emitting a pending event. Active AVI/sidecar writes retain their needed payload until completion. AVI retry exhaustion leaves the sidecar `not_attempted`; abort that prevents sidecar start records it as `discarded`. Rejected in-flight writes remain `uncertain`, while the logical part and host tracker retain failure outcomes.

On Node `v22.16.0`, the pinned-source fixture (`--baseline`) retained 100,000 frame records after 200 × 500 synthetic records and explicit GC, with about 34.37 MiB heap growth. The current worktree run retains zero payload parts and zero frame records (200 compact part records, 400 file records), with about 0.40 MiB heap growth. The checked-in [baseline corpus](baseline.md#compatibility-corpus) includes AVI bytes, gzip payload, and the v3 sidecar; those bytes were verified against serializer modules extracted from the pinned `4fd85bc` source. The focused facecrop suite passed 77/77 tests across seven suites after adding success, exhaustion, queued/in-flight abort, retry-delay abort, late rejection, repeated-abort, and payload-release coverage. The existing tests confirm the sidecar serialization passed to the transport remains unchanged.

These checks establish the sink-level retention and outcome behavior for the synthetic fixture. Sustained browser memory/resource trends, physical-device behavior, and a real JATOS upload/cancellation path remain unverified campaign gates; host capture-history retention also remains a separate investigation.
