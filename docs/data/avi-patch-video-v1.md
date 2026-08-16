# AVI patch-video format v1

`patch-video-avi-gzip-bgr24-v1` stores each raw-patch part as a lossless AVI file wrapped in gzip for upload. It replaces the former raw-BGR24 gzip-plus-manifest artifact set.

Each AVI contains one 72 by 72 video stream at a nominal 30 frames per second.
Frames are 24-bit uncompressed DIB video: the capture processor emits sRGB
BGR24 pixels, and the muxer stores the equivalent BGR24 triplets required by
the DIB AVI convention. A negative bitmap height marks the frame rows as
top-down, preserving the processor's row order.

Files use this deterministic name:

```text
{studyResultId}_{studyPage}_{videoCounter}_patch_s{segmentIndex}_p{partIndex}.avi.gz
```

Segment and part indexes are zero-based and padded to at least three digits.
A part has at most 539 frames, whose video payload is at most 8,382,528 bytes;
AVI headers and its frame index add a small amount of extra data before gzip compression. The AVI frame
count and index are the authoritative ordering information. No JSON manifest,
per-frame source timestamp list, or separate hash is uploaded.

The browser muxer is dependency-free JavaScript. It does not load FFmpeg, use
Wasm, require `SharedArrayBuffer`, or need COOP/COEP response headers. It does
require the browser native `CompressionStream("gzip")` API.

Postprocessing should read the AVI stream in frame order, decode its
uncompressed BGR24 samples to RGB if raw pixels are needed, and treat the
nominal 30 fps time base as the timing representation. Decompress the `.avi.gz` file before opening the resulting AVI in a desktop
media viewer such as VLC; browser-native playback support for AVI is not expected.

JATOS/Nginx upload limits must exceed the complete gzip-compressed AVI size (at most roughly 8.4 MB at a
full part), in addition to the project's normal result-file limits.
