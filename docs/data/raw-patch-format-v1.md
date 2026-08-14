# Raw patch format v1

## Scope and versioning

This document defines the durable `raw-patch-v1` data contract. The format is
for deterministic 72 by 72 RGB patches. An incompatible change to bytes,
descriptor semantics, hashes, or manifest schema requires a new format
version; it must not rewrite v1 interpretation.

## Frame bytes

Each accepted frame is exactly 15,552 uncompressed bytes:

```text
72 pixels wide * 72 pixels high * 3 bytes per pixel
```

Bytes are row-major RGB24 in sRGB: `R`, `G`, `B` for pixel `(0, 0)`, followed
by the remaining pixels across the row, then subsequent rows. There is no
alpha byte, padding, stride, interpolation, or frame-cadence correction.

## Parts and ordering

A part contains no more than 539 complete frames, or 8,382,528 uncompressed
bytes at the maximum. Its future upload filename is deterministic:

```text
{studyResultId}_{studyPage}_{videoCounter}_patch_s{segmentIndex}_p{partIndex}.rgb24.gz
```

Indexes are zero-based and padded to at least three digits in filenames. Parts
are ordered first by ascending `segmentIndex`, then ascending `partIndex`.
`partIndex` starts at zero again within each segment. The `.gz` representation
is a lossless transport encoding; the authoritative bytes are the decompressed
RGB24 bytes described above.

Every part records:

- `frameCount`: number of complete RGB24 frames.
- `byteLength`: uncompressed byte count, exactly `frameCount * 15552`.
- `sha256`: lowercase hexadecimal SHA-256 of the uncompressed bytes.
- `timestampsUs`: one non-negative integer source timestamp in microseconds
  per frame, in that part's byte order.

## Segments and resolved ROIs

A segment holds frames with one invariant source geometry and resolved ROI.
A new segment begins when source width, source height, or the complete ROI
descriptor changes. Each segment records `segmentIndex`, `sourceWidth`,
`sourceHeight`, the `roi`, and `blockSize`.

The v1 ROI descriptor is:

```json
{"coordinateSystem":"camera","transformType":"axis-aligned-square","samplingVersion":"block-average-v1","descriptorVersion":1,"x":0,"y":0,"size":72}
```

`x` and `y` are non-negative integers. `size` is an integer divisible by 72,
and the entire ROI must remain inside the segment source dimensions.

## Manifest

The manifest filename is deterministic:

```text
{studyResultId}_{studyPage}_{videoCounter}_patch_manifest.json
```

The JSON manifest contains these v1 fields:

```text
formatVersion
filename
frame.width
frame.height
frame.byteLength
frame.colorSpace
frame.channelOrder
segments[].segmentIndex
segments[].sourceWidth
segments[].sourceHeight
segments[].roi
segments[].blockSize
segments[].parts[].partIndex
segments[].parts[].filename
segments[].parts[].frameCount
segments[].parts[].byteLength
segments[].parts[].sha256
segments[].parts[].timestampsUs
```

The manifest is JSON-serializable and deliberately excludes the part byte
payloads themselves. The isolated JATOS sink uploads parts before the manifest;
browser capture integration and broader metadata are added by later pipeline
stages without altering this v1 byte contract.

## Postprocessing verification

For each manifest part, postprocessing must decompress the named gzip file,
verify that its uncompressed length equals `byteLength`, calculate SHA-256 of
the uncompressed bytes, and compare it to `sha256`. It must then concatenate
verified part bytes in manifest segment/part order. Split the result into
15,552-byte frames and associate each frame with the aligned `timestampsUs`
entry. A hash, length, order, or timestamp-count mismatch invalidates the
affected data.

## Provisional upload capacity

Before raw-patch capture is enabled, JATOS result-upload limits and the Nginx
request limit must allow every compressed part, the manifest, and existing
study artifacts. `jatos.resultUploads.maxFileSize` must exceed the largest
gzip part, not merely its 8,382,528-byte uncompressed maximum.

`jatos.resultUploads.limitPerStudyRun` must cover the expected number of
parts, one manifest, and companion MP4/WebM files. These are provisional
deployment requirements: actual browser gzip sizes, retry behavior, and
