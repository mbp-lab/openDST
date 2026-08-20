# AVI face-crop video format v1 with face-event sidecars

`patch-video-avi-gzip-bgr24-v1` stores each face-crop part as a lossless AVI
file wrapped in gzip. Each AVI upload has one required companion plain JSON
face-event sidecar. The AVI pixel encoding remains v1; the sidecar supplies the
face-selection provenance that an AVI stream cannot represent.

## Files

Each logical patch part has deterministic names:

```text
{studyResultId}_{studyPage}_{videoCounter}_{captureId}_patch_s{segmentIndex}_p{partIndex}.avi.gz
{studyResultId}_{studyPage}_{videoCounter}_{captureId}_patch_s{segmentIndex}_p{partIndex}.face-events.json
{studyResultId}_{studyPage}_{videoCounter}_{captureId}_manifest.json
```

Segment and part indexes are zero-based and padded to at least three digits.
The AVI and sidecar are required for each part; the manifest inventories the
complete capture attempt. They are uploaded serially through the same bounded,
retry-aware sink. If either cannot be uploaded, patch capture is terminally
`incomplete`; the participant study and the ordinary MP4/WebM recording still
continue.

## AVI payload

Each AVI contains one 72 by 72 video stream at a nominal 30 frames per second.
Frames are 24-bit uncompressed DIB video: the capture processor emits sRGB
BGR24 pixels, and the muxer stores the equivalent BGR24 triplets required by
the DIB AVI convention. A negative bitmap height marks the frame rows as
top-down, preserving the processor's row order.

A part has at most 539 frames, whose video payload is at most 8,382,528 bytes;
AVI headers and its frame index add a small amount of extra data before gzip
compression. The AVI frame count and index are authoritative for frame order
within that file. Decompress the `.avi.gz` file before opening the resulting AVI
in a desktop viewer such as VLC; browser-native AVI playback is not expected.

## Face-event sidecar

The JSON sidecar has `formatVersion: "face-events-json-v1"`, identifies its
companion AVI by filename and segment/part index, and has exactly one `frames`
entry for every AVI frame. Every entry includes:

- `frameIndex`: zero-based AVI frame index;
- `mediaTimeUs`: source media time in microseconds;
- `wallClockMs`: wall-clock timestamp captured at the video-frame callback;
	- `source`: source width and height for this frame;
	- `state`: `default`, `largest`, `held`, or `reacquired`;
	- `detection`: raw count, eligible count, and detector scores;
	- `selection`: selected score, bounding box, and tie-break information;
- the resolved dynamic-square `roi` used to produce that AVI frame.

The sidecar also records the resolved selection configuration: MediaPipe
confidence and suppression thresholds and the policy identifier
`largest-eligible-bounding-box-v1`. After the first face selection, missed
detections retain the last ROI indefinitely and are represented as `held` AVI
frames. Before any eligible face exists, `default` frames are emitted using the
largest centered square.

## Selection semantics

Eligible detections must have a positive finite bounding box and a score at or
above `minDetectionConfidence`. The selected detection is the largest eligible
source-pixel bounding box (`width * height`) for that detector run. Equal areas
are ordered by higher score, then smaller `originX`, then smaller `originY`,
then earlier detector-result index. This is not identity tracking: if a
bystander becomes the largest eligible face, it is selected on the next run.

When no detection is eligible after a face has been selected, the last valid ROI
is emitted indefinitely as `held`. When an eligible face later returns, the first
resulting AVI frame is `reacquired`. Before any eligible face is found, the
largest centered square is emitted as `default`.

## Runtime and deployment requirements

The browser muxer is dependency-free JavaScript. It does not load FFmpeg, use
Wasm, require `SharedArrayBuffer`, or need COOP/COEP response headers. It does
require the browser native `CompressionStream("gzip")` API for AVI uploads.
The JSON sidecar is intentionally plain text.

JATOS/Nginx upload limits must allow the complete gzip-compressed AVI size
(roughly 8.4 MB at a full part) and the additional small JSON sidecar. Per-run
file-count limits must include both artifacts for every part, in addition to
the normal study uploads.

## Time mapping

Every sidecar frame entry supplies the source `mediaTimeUs` and callback
`wallClockMs` for its corresponding AVI frame.
