# Face-crop capture

This directory contains the optional face-crop recording pipeline that runs beside the existing `MediaRecorder` video flow.

## Runtime flow

```text
WebcamCapture
  -> FaceCropCaptureController
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

`FaceCropCaptureController` owns browser APIs, frame scheduling, lifecycle, and participant metadata. `PipelineWorker` is the ordered request bridge between the main thread and the worker. The worker owns MediaPipe, ROI selection, RGBX-to-BGR24 conversion, provenance, and part segmentation. `FaceCropSink` owns bounded transport, retries, upload tracking, and the coupling between each AVI part and its JSON sidecar.

## Files

- `FaceCropCapture.js`: optional capability probe, session start/stop, worker bridge, and status metadata.
- `FaceCropPipeline.worker.js`: MediaPipe initialization, deterministic ROI selection, area resampling, frame provenance, and segmentation.
- `FaceCropOutput.js`: deterministic filenames, uncompressed AVI construction, gzip encoding, bounded upload queue, and retries.
- `FaceCropCapture.test.js`: configuration and lifecycle contracts.
- `FaceCropPipeline.test.js`: ROI, pixel conversion, and worker frame ownership contracts.
- `FaceCropOutput.test.js`: AVI byte layout, segmentation, queue limits, sidecar coupling, and retry contracts.

## Invariants

- Face-crop capture is optional and disabled by default; unsupported browser APIs must not block the main recording flow.
- One worker request is in flight at a time, preserving frame order and bounding memory use.
- Face selection is deterministic: the largest eligible detection wins, followed by stable tie-breakers; a valid previous ROI is held through detector misses.
- A source-dimension change starts a new segment.
- Each AVI upload has a matching `.face-events.json` sidecar. Either artifact failing makes the logical part incomplete.
- Upload failures are terminal and observable, but do not block study completion or redirect.

## Scientific contract

### Implemented behavior

- Detection uses the vendored MediaPipe Tasks Vision `blaze_face_short_range.tflite` model in `VIDEO` mode with the CPU delegate. `minDetectionConfidence` and `minSuppressionThreshold` are configurable; the first controls eligibility, while the second is passed to MediaPipe's detector.
- Eligible detections are sorted deterministically by bounding-box area, confidence, left position, top position, and original result order. The largest eligible face is selected.
- The selected box becomes a bounded square ROI. `faceRoiScale`, `faceRoiVerticalShiftRatio`, and the EMA time constant `faceRoiSmoothingTauMs` control size, vertical placement, and temporal smoothing. During detector misses, the last in-bounds ROI is held; otherwise the frame is skipped.
- Each accepted ROI is area-resampled from sRGB RGBX source pixels to exactly 72x72 using pixel-overlap weights, with half-up rounding, and emitted as BGR24. This is deterministic and independent of browser image-scaling APIs.
- Browser `requestVideoFrameCallback` timestamps and `presentedFrames` are recorded in the sidecar. Sidecar events also record detector state, candidate count, score, bounding box, ROI, accepted frames, and skipped callbacks. Final capture status distinguishes `unsupported`, `complete`, and `incomplete`.

### Failure modes and hardening

- Capability, MediaPipe asset/model, dimension, worker, encoding, and upload failures are surfaced in capture metadata and logs; missing detections are observable through sidecar states and counters. A held ROI currently has no time limit, so analyses must distinguish `held` from freshly detected frames.
- AVI headers currently declare a fixed 30 FPS. Capture is callback-driven and may contain dropped or irregularly timed frames, so scientific timing must use sidecar `mediaTimeUs` until the AVI frame-rate contract is validated or changed.
- Before scientific deployment, validate model/runtime checksums and versions, browser/device support, camera color conversion, actual frame timing and drop behavior, ROI parameter defaults, prolonged detector misses, upload completeness, and end-to-end AVI decoding across analysis tools.
