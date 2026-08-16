# Raw patch pipeline architecture

## Upload terminal-state invariant

All result-file uploads are registered with a stable ID and begin in the
`pending` state. An upload settles exactly once as either `succeeded` or
`failed`; neither terminal state may change afterwards. Completion and
redirection are gated only by the absence of `pending` uploads. A failed upload
therefore does not block the study, and it is never represented as successful.

This invariant is shared by the existing video upload flow and future
best-effort raw-patch uploads.

## Deterministic v1 processor

`src/capture/RoiProvider.js` defines the resolved ROI contract. Its pure
`CameraRoiProvider` maps integer decoded-frame dimensions to the largest
centered square that can be divided into a 72 by 72 grid of equal source blocks.

`src/capture/RawPatchProcessor.js` is also pure. It accepts a tightly packed,
visible, unmirrored 8-bit sRGB RGBX frame plus a validated resolved ROI and
returns one deterministic RGB24 patch. It does not select an ROI, use browser
APIs, compress output, or upload data.

### Crop arithmetic and byte layout

For source dimensions `width` and `height`, the camera provider computes:

```text
N    = floor(min(width, height) / 72)
size = 72 * N
x    = floor((width - size) / 2)
y    = floor((height - size) / 2)
```

The processor requires exactly `width * height * 4` RGBX bytes and an ROI
inside those dimensions. It emits exactly `72 * 72 * 3 = 15,552` bytes in
row-major RGB24 order: every output pixel is `R`, `G`, then `B`; the source
X byte is discarded.

Camera mode uses `block-average-v1`: each output pixel is derived from its
matching `N` by `N` source block. For each channel, it applies this exact
half-up rule:

```text
floor((sum + floor(N² / 2)) / N²)
```

Face mode uses `area-average-v1`, described below. Neither path relies on
browser resampling, mirrored-coordinate conversion, or cadence correction.
Identical RGBX input bytes and the same ROI descriptor therefore produce
identical RGB24 output bytes.

### Resolved ROI descriptor

The processor accepts a descriptor with all of these required fields:

```json
{"coordinateSystem":"camera","transformType":"axis-aligned-square","samplingVersion":"block-average-v1","descriptorVersion":1,"x":0,"y":0,"size":72}
```

`x` and `y` are non-negative integers. `size` is an integer of at least 72.
The coordinate system, transform type, sampling rule, and descriptor version
are explicit rather than inferred from the provider.

Face mode uses MediaPipe's short-range BlazeFace detector and a v2
`dynamic-face-square` descriptor. The detected bounding box is expanded by
the configured scale (1.5 by default), rounded up to an integer source-pixel size, shifted upward by 15% of its
size for upper-head room, clamped to the source, and smoothed between frames using an exponential moving average with a configurable
167 ms effective window by default. Each update uses the elapsed media time, so
smoothing remains stable when capture cadence varies. The crop is then reduced to 72 by 72 with
`area-average-v1`: each output pixel is the area-weighted RGB average of its
source-pixel overlap, using integer half-up rounding. The last crop is held
for at most 15 missed frames; frames are skipped after that until a face is
detected again. This remains an axis-aligned crop: affine extraction and
rotated sampling are not performed.

## Vendored MediaPipe assets

The build runs `scripts/vendor-mediapipe-assets.js` before development and production builds. It verifies the SHA-256 of the checked-in BlazeFace model, then copies it and the four version-pinned Tasks Vision Wasm runtime files into `public/mediapipe`. The browser therefore uses same-origin assets by default; the MediaPipe URL environment variables are explicit deployment overrides.

## Browser capture lifecycle

The disabled-by-default browser integration lets `WebcamCapture` start
and stops a raw-patch session beside the existing `MediaRecorder` lifecycle;
it does not alter the participant-facing UI or recorder configuration.

Module map:
`RawPatchCaptureSession` resolves build-time configuration and adapts JATOS
plus upload tracking; `RawPatchCaptureController` probes browser APIs and
owns frame callbacks; the existing processor, segmenter, and JATOS sink retain
their independent responsibilities.

Lifecycle: the controller probes `requestVideoFrameCallback`, `VideoFrame`
RGBX/sRGB copying, and native `CompressionStream("gzip")`, then registers the next callback before processing the
current frame. In face mode, synchronous MediaPipe detection runs before the
pixel copy. Only one copy may be in flight; later callbacks are counted as
skipped. It seals deterministic 72 by 72 RGB24 frame parts and hands them to
the AVI sink when a part fills, the source geometry changes, or recording
stops.

## Bounded JATOS sink

`JatosPatchSink` is the isolated best-effort transport boundary. It accepts
sealed RGB24 parts, muxes each as an uncompressed AVI and wraps it in native
gzip before calling the injected JATOS `uploadResultFile` adapter. It has no
FFmpeg/Wasm or `SharedArrayBuffer` requirement, but does require native
`CompressionStream("gzip")`.

The sealed-part state machine is:

```text
sealed -> queued -> AVI muxing -> gzip -> uploading/retrying -> succeeded | failed
```

The upstream segmenter owns one active, unsealed part. The sink accepts at
most two sealed parts, including a part currently being muxed or uploaded.
Accepted RGB24 bytes transfer to the sink and are released after muxing and gzip compression. A
third sealed part is an overflow signal; the capture controller stops patch
capture as incomplete rather than affect the participant recording. Uploaded files are `.avi.gz`; decompression produces a self-contained AVI, and there is no separate manifest upload.
