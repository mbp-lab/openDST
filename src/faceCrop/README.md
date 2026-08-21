# Face-crop capture

This directory contains the optional face-crop recording pipeline that runs beside the existing `MediaRecorder` video flow.

## Runtime flow

`FaceCropCaptureController` keeps browser-facing work deliberately small: it schedules `VideoFrame` instances, distributes them to analysis workers, forwards their transferable results to one ordered assembly worker, and performs JATOS upload/retry work. It does not run ROI selection, pixel downsampling, AVI muxing, or gzip encoding.

`REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT` controls the number of MediaPipe analysis workers and accepts only `1` or `2` (default `1`). Each configuration also starts exactly one assembly worker:

```text
main thread
  -> N analysis workers (MediaPipe detection + packed RGBX extraction)
  -> 1 assembly worker (source-order buffer, ROI, crop/downsample, segmentation, AVI + gzip)
  -> main-thread FaceCropSink (JATOS AVI upload, sidecar upload, retry)
```

Analysis results include a source sequence and transferable RGBX bytes. The assembly worker buffers at most the analysis-worker count, processes only the next sequence, and returns sealed encoded artifacts as transferable gzip byte buffers plus their sidecars. Thus `analysisWorkerCount: 1` means one detector and one assembly worker; `analysisWorkerCount: 2` means two detectors and one assembly worker.

## Files

- `FaceCropCapture.js`: capability probe, lifecycle, bounded routing, worker bridge, manifest metadata, and status reporting.
- `FaceCropPipeline.worker.js`: separate MediaPipe analysis and ordered patch-assembly roles.
- `FaceCropOutput.js`: deterministic filenames, AVI/gzip artifact encoding for the assembly worker, and the upload-only bounded JATOS sink.
- `FaceCropCapture.test.js`: configuration and lifecycle/drain contracts.
- `FaceCropPipeline.test.js`: ROI, pixel conversion, worker ownership, ordering, and segmentation contracts.
- `FaceCropOutput.test.js`: AVI byte layout, encoded-artifact upload, sidecar coupling, and retry contracts.

## Invariants

- Face-crop capture is optional and disabled by default; unsupported browser APIs must not block the main recording flow. Worker-side `Blob`, `Response`, and `CompressionStream` are required for face-crop capture; failure marks this optional path unsupported.
- The controller holds at most `analysisWorkerCount` detector/assembly tasks. The assembly worker holds at most that many out-of-order analysis results and never commits a later source sequence first.
- Analysis workers own MediaPipe and close their transferred `VideoFrame` inputs. The assembly worker owns ROI state, crop/downsample buffers, segment allocation, AVI muxing, and gzip encoding. The main thread owns no patch-image or encoder buffers.
- Face selection is deterministic: the largest eligible detection wins, followed by stable tie-breakers; a centered largest-square fallback is used before the first detection, and a valid previous ROI is held through later detector misses.
- A source-dimension change starts a new segment.
- Each AVI upload has a matching `.face-events.json` sidecar, and each capture attempt has a manifest listing its parts. Either part artifact failing makes the logical part incomplete.
- Upload failures are terminal and observable, but do not block study completion or redirect.

## Scientific contract

### Implemented behavior

- Detection uses the vendored MediaPipe Tasks Vision `blaze_face_short_range.tflite` model in `VIDEO` mode. The CPU delegate is the default; set `REACT_APP_FACE_DETECTION_DELEGATE=GPU` for a GPU comparison. The selected delegate is recorded in the capture manifest, and `minDetectionConfidence` and `minSuppressionThreshold` remain configurable.
- Eligible detections are sorted deterministically by bounding-box area, confidence, left position, top position, and original result order. The largest eligible face is selected.
- The selected box becomes a bounded square ROI. Before a face is detected, the largest square fitting the source is centered on the free axis. `faceRoiScale`, `faceRoiVerticalShiftRatio`, and the EMA time constant `faceRoiSmoothingTauMs` control detected-face size, vertical placement, and temporal smoothing. During detector misses, the last in-bounds ROI is held. Sidecar states are `default`, `largest`, `held`, and `reacquired`.
- Each accepted ROI is area-resampled from sRGB RGBA source pixels to exactly 72x72 using pixel-overlap weights, with half-up rounding, and emitted as BGR24. This is deterministic and independent of browser image-scaling APIs.
- Browser `requestVideoFrameCallback` timestamps and `presentedFrames` are recorded in the sidecar. Sidecar events also record detector state, candidate count, score, bounding box, ROI, accepted frames, and skipped callbacks. Final capture status distinguishes `unsupported`, `complete`, and `incomplete`.

### Failure modes and hardening

- Capability, MediaPipe asset/model, dimension, worker, encoding, and upload failures are surfaced in capture metadata and logs; missing detections are observable through sidecar states and counters. A held ROI currently has no time limit, so analyses must distinguish `held` from freshly detected frames.
- AVI headers declare one constant FPS per part, derived from that part's `mediaTimeUs` intervals. Capture remains callback-driven and may contain dropped or irregularly timed frames, so scientific timing must use sidecar `mediaTimeUs`.
- Before scientific deployment, validate model/runtime checksums and versions, browser/device support, camera color conversion, actual frame timing and drop behavior, ROI parameter defaults, prolonged detector misses, upload completeness, and end-to-end AVI decoding across analysis tools.
