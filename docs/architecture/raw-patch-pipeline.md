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

Each output pixel is derived from its matching `N` by `N` source block. For
each channel, v1 applies this exact half-up rule:

```text
floor((sum + floor(N² / 2)) / N²)
```

No interpolation, resampling, mirrored-coordinate conversion, or cadence
correction occurs in the processor. Identical RGBX input bytes and the same
ROI descriptor therefore produce identical RGB24 output bytes.

### Resolved ROI descriptor

The v1 processor accepts a descriptor with all of these required fields:

```json
{"coordinateSystem":"camera","transformType":"axis-aligned-square","samplingVersion":"block-average-v1","descriptorVersion":1,"x":0,"y":0,"size":72}
```

`x` and `y` are non-negative integers. `size` is an integer of at least 72
and divisible by 72. The coordinate system, transform type, sampling rule,
and descriptor version are explicit rather than inferred from the provider.

A future face-aligned provider may introduce `affine-square`, but v1 rejects
that transform type. Its future descriptor must define a fixed-point
quantized transform, sampling rule, and boundary policy, and must receive a
new crop/pipeline version. Face detection, affine extraction, and rotated
sampling are not part of this stage.

## Bounded JATOS sink

`JatosPatchSink` is the isolated best-effort transport boundary. It accepts
sealed parts, uses native `CompressionStream("gzip")`, and calls the injected
JATOS `uploadResultFile` adapter with complete compressed payloads.

The sealed-part state machine is:

```text
sealed -> queued -> compressing -> uploading/retrying -> succeeded | failed
```

The upstream segmenter owns one active, unsealed part. The sink accepts at
most two sealed parts, including a part currently being compressed or
uploaded. Accepted raw bytes transfer to the sink and are released after
compression. A third sealed part is an overflow signal for the future capture
controller, which must stop patch capture as incomplete rather than affect
