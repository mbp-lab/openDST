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
