# Follow-up work

- Evaluate configurable analysis FPS limits and adaptive throttling as separate scientific proposals; validate sampling and evidence effects before adoption.
- Profile sustained CPU, memory, battery, dropped frames, and thermal behavior on target mobile browsers.
- Extend native-frame browser tests to Android/iOS camera orientation and color-space behavior.
- Benchmark full-frame buffer reuse at high resolutions and with simultaneous sessions. Treat ROI-only extraction as a separate scientific proposal.
- Expand browser support beyond the current accepted source layouts.
- Validate browser upload/cancellation behavior against production JATOS deployments.
- Profile native/GPU/process memory beyond the measured JavaScript retention fixtures.
- Resolve ordinary-recorder chunk and filename reuse for repeated recording with the same counter; establish supported study behavior and compatibility before changing it.

The [completed campaign acceptance report](campaign/acceptance-report.md) records final evidence and limitations. These follow-ups are outside its accepted implementation scope.

Stage accounting, capture history, the output boundary, and standalone worker loading are implemented in this extraction. Study cache and service-worker policy remains outside this library.
