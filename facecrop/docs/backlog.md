# Follow-up work

- Add a configurable analysis FPS limit and evaluate adaptive throttling.
- Profile sustained CPU, memory, battery, dropped frames, and thermal behavior on target mobile browsers.
- Extend native-frame browser tests to Android/iOS camera orientation and color-space behavior.
- Benchmark full-frame buffer reuse and ROI-only extraction without changing scientific sampling.
- Expand browser support beyond the current accepted source layouts.

Stage accounting, capture history, the output boundary, and standalone worker loading are implemented in this extraction. Host cache and service-worker policy remains outside this library.
