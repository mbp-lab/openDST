# Raw patch release checklist

This checklist is the reproducible release gate for raw-patch capture. Do not
change `REACT_APP_RAW_PATCH_CAPTURE` from `off` until every applicable item is
recorded as passed for the target deployment.

## Recorded results

| Date | Environment | Check | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-08-14 | Workspace CI | `CI=true npm test -- --watchAll=false` | Passed | 4 suites, 10 tests. |
| 2026-08-14 | Workspace CI | `npm run build` | Passed | Production bundle compiled. |
| Not run | Deployed JATOS/Nginx | End-to-end raw-patch upload | Pending | No deployment endpoint was available in this workspace. |
| Not run | Physical browser/device | WebCodecs/gzip capture | Pending | Requires capable desktop and iOS/Android devices. |

## Browser and device matrix

For each target browser/device, record browser version, OS version, camera
resolution, the selected raw-patch mode, and the final participant metadata
status. Test at least one capable desktop browser plus representative capable
iOS and Android phones.

- Confirm `off` creates no raw-patch session or files.
- Confirm `calibration` captures only the 30-second introduction feedback
  recording; speech-task calibration must remain excluded.
- Confirm `all` covers every recorder session without changing the existing
  MP4/WebM behavior or participant-facing UI.
- Confirm `face` reports `unsupported`, creates no fallback camera ROI, and
  does not affect video recording.
- Confirm missing `requestVideoFrameCallback`, `VideoFrame` RGBX/sRGB copying,
  or `CompressionStream("gzip")` reports `unsupported` without blocking study
  progress.
- Confirm decoded dimensions below 72 or above 1920×1080 report `incomplete`
  without affecting `MediaRecorder`.

Record accepted frames, skipped callbacks, processing latency, peak memory,
UI responsiveness, source dimensions, and the final `rawPatchCapture` status.

## Byte, queue, and recorder checks

- Decompress every uploaded part and verify its byte length and SHA-256 against
  the manifest; concatenate parts in manifest order and verify 15,552 bytes per
  frame.
- Verify the 539-frame boundary creates the next part with the expected
  segment/part indexes and deterministic names.
- Force frame backpressure and confirm callbacks are counted as skipped rather
  than duplicated or cadence-corrected.
- Hold two sealed uploads in the sink, then confirm the next sealed part stops
  only patch capture as `incomplete` while MP4/WebM recording continues.
- Confirm the final part is sealed and all part attempts settle before the
  manifest upload begins.
- Repeat the normal recording flow with raw patches `off` and compare the
  resulting MP4/WebM recording behavior to the pre-feature baseline.

## Deployed JATOS and Nginx checks

- Verify one successful compressed part upload and manifest upload.
- Force transient failures and confirm exactly three bounded attempts followed
  by one terminal upload state.
- Force permanent part and manifest failures; verify study continuation and
  terminal participant metadata.
- Test a retry after an uncertain request with the same deterministic filename;
  record the deployed JATOS version's duplicate-file behavior.
- Measure the largest gzip part for each target browser and set
  `jatos.resultUploads.maxFileSize` and Nginx `client_max_body_size` above it.
- Set `jatos.resultUploads.limitPerStudyRun` above the expected raw-patch part
  count, manifest, and companion MP4/WebM files; verify enforcement at and
  beyond the configured limit.
- Record actual JATOS/Nginx settings, server version, failure symptoms, and
  mitigation steps in this document before enabling `calibration` or `all`.
