# Face-crop capture architecture

## Upload terminal-state invariant

All result-file uploads are registered with a stable ID and begin in the
`pending` state. An upload settles exactly once as either `succeeded` or
`failed`; neither terminal state may change afterwards. Completion and
redirection are gated only by the absence of `pending` uploads. A failed upload
therefore does not block the study, and it is never represented as successful.

This invariant is shared by the existing video upload flow and future
best-effort face-crop uploads.

## Deterministic v1 processor

`src/faceCrop/FaceCropPipeline.worker.js` contains `FaceRoiProvider`, which converts MediaPipe face bounding boxes into validated, axis-aligned square ROIs, and `FaceCropProcessor`, which accepts a tightly packed, visible, unmirrored 8-bit sRGB RGBX frame plus one of those ROIs and returns one deterministic BGR24 patch. It does not select an ROI, use browser APIs, compress output, or upload data.

### Crop arithmetic and byte layout

The processor requires exactly `width * height * 4` RGBX bytes and an ROI inside those dimensions. It emits exactly `72 * 72 * 3 = 15,552` bytes in row-major BGR24 order: every output pixel is `B`, `G`, then `R`; the source X byte is discarded.

The face ROI uses `area-average-v1`: each output pixel is the area-weighted RGB average of its source-pixel overlap, using integer half-up rounding. It does not rely on browser resampling, mirrored-coordinate conversion, or cadence correction. Identical RGBX input bytes and the same ROI descriptor therefore produce identical BGR24 output bytes.

### Resolved ROI descriptor

The processor accepts a descriptor with all of these required fields:

```json
{"coordinateSystem":"face","transformType":"dynamic-face-square","samplingVersion":"area-average-v1","descriptorVersion":2,"x":0,"y":0,"size":72}
```

`x` and `y` are non-negative integers. `size` is an integer of at least 72. The coordinate system, transform type, sampling rule, and descriptor version are explicit rather than inferred from the provider.

### Face ROI mapping

The face provider uses the MediaPipe short-range BlazeFace detector with the v2 `dynamic-face-square` descriptor. It filters detections at the resolved MediaPipe confidence threshold (0.5 by default) and selects the eligible face with the largest unmodified source-pixel bounding-box area on every detector run. Equal areas are resolved deterministically by confidence, then top-left position, then result index; the provider intentionally does not identify or track a person. The selected box is expanded by the configured scale (1.5 by default), rounded up to an integer source-pixel size, and shifted vertically by the configured signed ratio (0.15 by default; positive values shift upward and negative values downward). The crop is clamped to the source and smoothed between frames using an exponential moving average with a configurable 100 ms time constant by default. Each update uses elapsed media time, so smoothing remains stable when capture cadence varies. Once a face has been selected, no-face detector results retain that last crop indefinitely so every later accepted AVI frame remains a source-image crop. The crop is then reduced to 72 by 72 with
`area-average-v1`: each output pixel is the area-weighted RGB average of its
source-pixel overlap, using integer half-up rounding. This remains an axis-aligned crop: affine extraction and
rotated sampling are not performed.

The provider emits an in-bounds ROI for every processed frame: `default`
before any eligible face, `largest` when a face is selected, `held` during
misses after a prior selection, and `reacquired` on the first selected frame
after misses.

## Vendored MediaPipe assets

The build runs `scripts/vendor-mediapipe-assets.js` before development and production builds. It verifies the SHA-256 of the checked-in BlazeFace model, then copies it and the four version-pinned Tasks Vision Wasm runtime files into `public/mediapipe`. The browser therefore uses same-origin assets by default; the MediaPipe URL environment variables are explicit deployment overrides.

## Browser capture lifecycle

The disabled-by-default browser integration lets `WebcamCapture` start and stop a face-crop capture session beside the existing `MediaRecorder` lifecycle; it does not alter the participant-facing UI or recorder configuration.

`FaceCropCaptureController` probes browser APIs and owns frame callbacks, bounded routing, JATOS upload/retry, manifests, and status. Each callback creates a transferable `VideoFrame` for one of the configured analysis workers. An analysis worker performs MediaPipe detection and packed RGBX extraction, closes the frame, and returns a source sequence with transferable RGBX bytes. One dedicated assembly worker accepts those results, buffers at most the configured analysis-worker count, processes only the next source sequence, and owns ROI selection, deterministic downsampling, segmentation, AVI muxing, and gzip encoding. It returns sealed gzip artifacts and sidecars to the main thread, which creates only a `Blob` wrapper for JATOS upload.

`REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT=1` means one analysis worker plus one assembly worker; `2` means two analysis workers plus one assembly worker. There is no main-thread crop/encoding fallback. The assembly worker requires worker-side `Blob`, `Response`, and `CompressionStream("gzip")`; absence of any marks optional face-crop capture unsupported without affecting ordinary recording. Stopping cancels callbacks, drains routed detector/assembly work, finishes assembly, queues sealed artifacts, finalizes uploads, then writes the manifest.

## Bounded JATOS sink

`FaceCropSink` is the isolated best-effort transport boundary. It accepts already encoded gzip AVI artifacts from the assembly worker and performs AVI-before-sidecar JATOS uploads with bounded retries and upload tracking. It neither crops pixels nor muxes/encodes output.

The artifact state machine is:

```text
assembly encoded -> queued -> uploading/retrying -> succeeded | failed
```

The sink admits at most two sealed artifacts, including an artifact currently uploading. When both slots are occupied, admitting the next artifact waits for capacity, bounding transfer memory without coupling the main thread to crop or encoder work. Each uploaded `.avi.gz` has a required plain-JSON `.face-events.json` sidecar with per-frame selection provenance. Both artifacts are retried through the bounded sink; failure of either makes face-crop capture incomplete. Decompression of the AVI artifact still produces a self-contained AVI, and there is no tar archive or separate manifest upload.

## Frame timing

Each AVI part has a companion face-event sidecar. The sidecar maps every AVI frame index to source media time and the wall-clock timestamp recorded at the video-frame callback.
