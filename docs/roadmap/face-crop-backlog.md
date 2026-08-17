# Face-crop roadmap

## Current readiness

The raw-patch pipeline is a production candidate for controlled pilots, but it
is not yet approved for broad unattended deployment. Keep
`REACT_APP_FACE_CROP_RECORDING_MODE` set to `off` by default until the release
gates in `../testing/raw-patch-release-checklist.md` pass for the target
environment.

Completed foundations:

- dedicated worker for detection, extraction, and segmentation;
- transferable frame and sealed-part ownership;
- bounded asynchronous sink admission with serialized encoding and upload;
- deterministic AVI parts and face-event sidecars;
- capability checks, cleanup, retries, and terminal failure reporting.

## P0: production release gates

- Run sustained capture on representative low-end desktop, Android, and iOS
  devices. Record processing latency, accepted/skipped frames, peak memory, CPU,
  thermal behavior, UI responsiveness, and upload backlog.
- Complete deployed JATOS/Nginx end-to-end tests, including slow uploads,
  transient and permanent failures, duplicate filenames, and configured size and
  file-count limits.
- Define and validate timing semantics. AVI currently declares a nominal 30 fps
  even when processing backpressure skips source frames; either explicitly
  resample to 30 fps or encode timing that preserves elapsed media time.
- Stress lifecycle behavior: rapid start/stop, stop during initialization or an
  in-flight frame, component unmount, source-dimension changes, and repeated
  recordings.
- Harden the sink against unexpected promise rejection and concurrent
  finalization while an admission is waiting for capacity.

## P1: measured runtime optimization

Apply these only with before/after device measurements and output-equivalence
tests:

- Reuse full-frame RGBX storage by source dimensions to reduce allocation and
  garbage-collection pressure.
- Cache area-average axis weights by ROI size.
- Evaluate running face detection less frequently while retaining/interpolating
  the ROI between detector runs; define an accuracy threshold before adopting it.
- Reduce AVI muxing copies with a single preallocated output buffer or a streaming
  implementation.

## P2: data and recorder improvements

- Reduce face-event JSON size by recording detection-state transitions and missed
  frame ranges without losing time mapping.
- Review upload filenames and deployed duplicate-file behavior.
- Bound the companion `MediaRecorder` memory footprint and reset
  `recordedChunks` at the beginning of every recording.
