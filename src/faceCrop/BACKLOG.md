# Face-crop backlog

Keep stable design contracts in `README.md`; this file tracks open work only.

## High priority

- [ ] Add a configurable, mobile-friendly analysis FPS limit and evaluate adaptive throttling.
- [ ] Profile sustained CPU, memory, battery, dropped frames, and thermal behavior on Chrome Android and Safari iOS.
- [ ] Record effective FPS, end-to-end latency, backpressure time, and distinct frame-skip reasons in capture manifests.
- [ ] Add real-browser tests for BlazeFace/TFJS WASM initialization, `VideoFrame` transfer/copy, worker loading, and finalization.

## Follow-up

- [ ] Reduce full-frame RGBA allocation/copy overhead; benchmark buffer reuse and ROI-only extraction with a compatibility fallback.
- [ ] Make route changes and page lifecycle events wait for or explicitly report interrupted finalization.
- [ ] Split worker RPC, scheduling, metrics, and JATOS integration out of `FaceCropCapture.js` where this simplifies lifecycle testing.
- [ ] Preserve per-capture status history in `Main` instead of retaining only the latest capture.
- [ ] Fix the zero-output diagnostic to read `metadata.statistics.acceptedFrames`.
- [ ] Update `README.md` to show the separate encoding worker.
