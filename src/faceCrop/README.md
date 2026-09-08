# Face-crop implementation notes

This directory contains the optional face-crop recording pipeline that runs
beside the existing `MediaRecorder` video flow. User-facing configuration,
output, and deployment guidance belongs in `DOCUMENTATION.md`; this file records
the internal design contract for contributors.

## Runtime flow

`FaceCropCaptureController` schedules `VideoFrame` instances, distributes them
to analysis workers, forwards their transferable results to one ordered assembly
worker, and coordinates JATOS uploads and retries:

```text
main thread
  -> N analysis workers (MediaPipe detection + packed RGBA extraction)
  -> 1 assembly worker (source ordering, ROI, downsampling, AVI + gzip)
  -> main-thread FaceCropSink (JATOS AVI and sidecar uploads, retries)
```

`REACT_APP_FACE_CROP_ANALYSIS_WORKER_COUNT` accepts `1` or `2` (default `1`).
The assembly worker buffers at most that many out-of-order results and returns
sealed gzip byte buffers and their JSON sidecars. ROI selection, downsampling,
AVI muxing, and gzip encoding do not run on the main thread.

## Files

- `FaceCropCapture.js`: capability probing, lifecycle, worker routing, upload
  coordination, manifest metadata, and status reporting.
- `FaceCropPipeline.worker.js`: MediaPipe analysis and ordered patch assembly.
- `FaceCropOutput.js`: deterministic filenames, AVI encoding, gzip support, and
  the bounded JATOS upload sink.
- The corresponding `*.test.js` files define lifecycle, ordering, pixel-layout,
  segmentation, sidecar, and retry contracts.

## Invariants

- Face-crop capture is optional and disabled by default. Unsupported APIs or a
  pipeline failure must not block ordinary recording or study completion.
- Analysis workers own and close transferred `VideoFrame` inputs. The assembly
  worker owns ROI state, patch buffers, segmentation, AVI muxing, and encoding.
- Work and out-of-order results are bounded by the configured analysis-worker
  count; source sequences are always committed in order.
- Face selection is deterministic: the largest eligible detection wins, followed
  by stable tie-breakers. Before the first detection, the largest centered square
  is used; during later misses, the last valid ROI is retained.
- A source-dimension change starts a new segment.
- Every AVI part has a matching `.face-events.json` sidecar, and every capture has
  a manifest. A failed part or sidecar makes the capture incomplete, while upload
  failures remain terminal and observable.

## Scientific contract

- Detection uses the vendored MediaPipe Tasks Vision
  `blaze_face_short_range.tflite` model in `VIDEO` mode. The selected delegate and
  detection thresholds are recorded in the manifest.
- Selected bounding boxes become bounded square ROIs using the configured scale,
  vertical shift, and time-based exponential smoothing. Sidecar selection states
  are `default`, `largest`, `held`, and `reacquired`.
- Each ROI is deterministically area-resampled from sRGB RGBA source pixels to
  72 x 72 BGR24 using pixel-overlap weights and half-up rounding.
- Sidecars map AVI frame indexes to source `mediaTimeUs`, callback `wallClockMs`,
  detector state, selected bounding box, and resolved ROI.
- AVI headers use one frame rate per part derived from `mediaTimeUs`. Capture is
  callback-driven and may skip frames, so scientific timing must use the sidecar
  timestamps rather than inferred AVI cadence.
- A held ROI has no time limit. Analyses must distinguish `held` frames from
  frames backed by a fresh detection.
