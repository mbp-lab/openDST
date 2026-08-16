# Raw patch release checklist

This checklist is the reproducible release gate for raw-patch capture. Do not
change `REACT_APP_FACE_CROP_RECORDING_MODE` from `off` until every applicable item is
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
- Confirm `calibration` captures only the introduction feedback recording, for its full duration until stopped
  recording; speech-task calibration must remain excluded.
- Confirm `all` covers every recorder session without changing the existing
  MP4/WebM behavior or participant-facing UI.
- Confirm MediaPipe initialization failures report `unsupported` and do not affect video recording.
- Confirm missing `requestVideoFrameCallback`, `VideoFrame` RGBX/sRGB copying,
  or `CompressionStream("gzip")` reports `unsupported` without blocking study
  progress.
- Confirm decoded dimensions below 72 or above 1920×1080 report `incomplete`
  without affecting `MediaRecorder`.

Record accepted frames, skipped callbacks, processing latency, peak memory,
UI responsiveness, source dimensions, and the final `rawPatchCapture` status.

## Byte, queue, and recorder checks

- Decompress every uploaded part and verify its byte length and SHA-256 against
  its matching `.face-events.json` sidecar; verify one provenance entry per AVI
  frame, both media-time and wall-clock timestamps, and 15,552 bytes per decoded
  frame.
- Verify the 539-frame boundary creates the next part with the expected
  segment/part indexes and deterministic names.
- Force frame backpressure and confirm callbacks are counted as skipped rather
  than duplicated or cadence-corrected.
- Hold two sealed uploads in the sink, then confirm the next sealed part stops
  only patch capture as `incomplete` while MP4/WebM recording continues.
- Confirm each AVI part and its JSON sidecar settle together; force a sidecar
  failure and verify terminal raw-patch status is `incomplete`.
- Repeat the normal recording flow with raw patches `off` and compare the
  resulting MP4/WebM recording behavior to the pre-feature baseline.

## Deployed JATOS and Nginx checks

- Verify one successful compressed AVI upload and its matching JSON sidecar upload.
- Force transient failures and confirm exactly three bounded attempts followed
  by one terminal upload state.
- Force permanent AVI-part and JSON-sidecar failures; verify study continuation
  and terminal participant metadata.
- Test a retry after an uncertain request with the same deterministic filename;
  record the deployed JATOS version's duplicate-file behavior.
- Measure the largest gzip part for each target browser and set
  `jatos.resultUploads.maxFileSize` and Nginx `client_max_body_size` above it.
- Set `jatos.resultUploads.limitPerStudyRun` above the expected raw-patch part
  count, AVI sidecars, and companion MP4/WebM files; verify enforcement at and
  beyond the configured limit.
- Record actual JATOS/Nginx settings, server version, failure symptoms, and
  mitigation steps in this document before enabling `calibration` or `all`.

## Time-mapping checks

- Confirm that after the first eligible face, extended no-detection intervals
  continue emitting `held` frames with the retained ROI and matching timestamps.
- Confirm that no crop is emitted before the first eligible face.
