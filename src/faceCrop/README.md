# Face-crop capture

This directory contains the optional face-crop recording pipeline that runs beside the existing `MediaRecorder` video flow.

## Runtime flow

```text
WebcamCapture
   -> FaceCropCaptureController (prepare on webcam readiness, capture on start)
  -> PipelineWorker
  -> FaceCropPipeline (worker)
     -> MediaPipe face detection
     -> FaceRoiProvider
     -> FaceCropProcessor
     -> FaceCropSegmenter
  -> FaceCropSink
     -> AVI + gzip encoding
     -> AVI and face-events sidecar uploads
```

`FaceCropCaptureController` owns browser APIs, frame scheduling, lifecycle, and participant metadata. `PipelineWorker` is the ordered request bridge. With one worker, that worker performs the full pipeline. With two workers, each worker performs MediaPipe detection and RGBA extraction, while the controller commits their results in source order using the same ROI, conversion, provenance, and segmentation logic. `FaceCropSink` owns bounded transport, retries, upload tracking, and the coupling between each AVI part and its JSON sidecar.

## Files

- `FaceCropCapture.js`: optional capability probe, session start/stop, worker bridge, and status metadata.
- `FaceCropPipeline.worker.js`: MediaPipe initialization, deterministic ROI selection, area resampling, frame provenance, and segmentation.
- `FaceCropOutput.js`: deterministic filenames, uncompressed AVI construction, gzip encoding, bounded upload queue, and retries.
- `FaceCropCapture.test.js`: configuration and lifecycle contracts.
- `FaceCropPipeline.test.js`: ROI, pixel conversion, and worker frame ownership contracts.
- `FaceCropOutput.test.js`: AVI byte layout, segmentation, queue limits, sidecar coupling, and retry contracts.

## Invariants

- Face-crop capture is optional and disabled by default; unsupported browser APIs must not block the main recording flow.
- At most one request is in flight per worker and at most two frames are held across in-flight and reordered results, preserving commit order and bounding memory use.
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
