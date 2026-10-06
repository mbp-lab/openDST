# Reading facecrop output

Each capture produces gzip-compressed 72×72 BGR24 AVI parts, one JSON sidecar per part, and a final manifest. Start with the manifest's `summary`, then follow `analysis.parts` to the video and frame metadata. A sidecar's `analysis.frames` maps each AVI frame to its presentation timestamp and the face/crop evidence used to produce it.

The schemas are `face-crop-manifest-v1` and `face-crop-events-v3`. The AVI format remains `patch-video-avi-gzip-bgr24-v1`. Consumers must check the schema rather than assuming older JSON field paths.

## Analysis

Use `presentationTimeUs` for timing, in microseconds on the browser's monotonic presentation clock. It is not an epoch timestamp. `wallClockMs` is the browser's callback-receipt time in epoch milliseconds; it is not a sensor timestamp. Frames can be skipped under load, so AVI's nominal frame rate does not replace the per-frame timestamps. `precedingFramePresentationTimeUs` carries cadence across part boundaries.

Each frame retains its zero-based index, source dimensions, detection evidence, selected box and confidence, and the square ROI actually used. The states mean:

- `default`: no usable detection yet; use a centered square.
- `largest`: use the largest eligible face detection.
- `held`: retain the last valid crop during a detection gap.
- `reacquired`: a usable detection follows a gap.

Face selection does not track identity. A held crop has no expiry. Detection quality must be interpreted separately from capture integrity; a valid frame can use a default or held crop.

## Validity and health

The manifest's `validity` records effective configuration, detector/runtime versions, source and normalization decisions, and per-part persistence outcomes. Its `health` preserves frame counts, detection/miss counts, processing/encoding timing summaries, and warmup summaries without enabling verbose diagnostics.

`health.accounting` counts submitted, processed, sealed, encoded, and persisted frames. Processing/encoding/persistence failures and discarded work are distinct. At normal finalization, `reconciliation.checks` verifies the stage equations. `consistent` means these counts reconcile; it does not mean every operation succeeded. Always also check `summary.status` and artifact outcomes.

The additive `reconciliation.checks.counts` flag reports whether accepted-frame and stage counters are nonnegative safe integers; `checks` and `consistent` are only populated for normal finalization, while aborted captures leave reconciliation absent (not performed).

`callbackGaps` counts browser presentation-counter gaps between observed callbacks. It does not identify camera loss, browser scheduling, or CPU pressure as the cause. Queue-wait totals measure time blocked on analysis or encoding capacity. These metrics do not describe all hardware frames or establish physiological signal quality.

A video part counts as persisted only when its AVI and sidecar writes both resolve. If any required output or the final manifest fails to persist, the returned session result is incomplete. The stored manifest cannot attest to its own subsequent write outcome; check the result's `manifest` and `artifacts` for that.

## Diagnostics and failure results

Verbose `diagnostics` is omitted by default. Enabling it preserves probe/browser details useful for troubleshooting. Scientific provenance and health summaries are always retained.

`prepare()` persists nothing. `stop()` flushes useful partial data and writes a manifest. `abort()` creates no further output; artifacts already written or in flight can remain. Discarded artifacts were never written; pending artifacts expose `completion` promises through the JavaScript result. A rejected write is `uncertain` because the server may have saved data before the response was lost. The host is responsible for deletion and participant withdrawal policy.

An AVI part is uploaded before its face-events sidecar. If AVI retries exhaust without abort, the sidecar is `not_attempted` with zero attempts; this differs from `discarded`, which means abort prevented the write from starting. The logical part remains `failed`, and the host upload tracker marks the sidecar failed so the capture is visibly incomplete. A rejected AVI write remains `uncertain`, since the server may have stored it despite the rejected response. Readers should accept `not_attempted` as an additive artifact outcome; older stored manifests may still use `failed` with zero attempts for this case.

## Migrating older metadata

| Previous path | New path |
|---|---|
| Manifest `status`, `reason` | `summary.status`, `summary.reason` |
| Manifest `output`, `parts` | `analysis.output`, `analysis.parts` |
| Manifest `statistics` | `validity.health` |
| Manifest `configuration`, `source` | `validity.configuration`, `validity.source` |
| Manifest configuration normalization | `validity.frameNormalization` |
| Full `capability` probe dumps | Compact `validity.capability`; verbose `diagnostics.capability` when enabled |
| Sidecar `frames` | `analysis.frames` |
| Sidecar `selectionConfiguration` | `validity.selectionConfiguration` |

Obsolete delegate/suppression requests are removed because they did not alter the WASM detector. Study recording modes remain host policy and are not scientific configuration.
