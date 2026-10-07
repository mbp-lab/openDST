# Integration boundaries

Facecrop is responsible for processing frames from a supplied video element, managing its workers, producing video parts and metadata, and writing artifacts through the supplied transport. The application chooses when to create a session and supplies its capture identity, configuration, asset URL, study context and storage transport.

The application owns camera permission and tracks, the video element, recording and navigation lifecycle, participant withdrawal, and any remote deletion policy. Facecrop does not acquire or stop camera tracks, navigate the study, or retract writes that have already started. Await `stop()` before leaving a recording when its artifacts must be finalized. Use `abort()` when no further facecrop writes should begin; already in-flight writes may still persist.

`transport.write({filename, payload})` must return a promise that resolves after persistence. The optional JATOS adapter accepts a JATOS API object explicitly and does not read a global. The React and plain-browser examples use the same public session API.

The library validates configuration before starting resources and reports unsupported browser APIs and runtime failures through its result and event interfaces. It uses classic workers, transferable `VideoFrame` objects, pinned detector assets, bounded queues and ordered finalization. The application must host the complete generated distribution at the configured `assetBaseUrl`; worker, TensorFlow.js, WASM and model assets must remain reachable from that URL. Use HTTPS or localhost for camera and `VideoFrame` APIs.

Distribution staging is application-specific. `scripts/stage-distribution.cjs` accepts explicit generated-entry, public-asset, URL-prefix and temporary-work destinations. A consumer may use this helper or implement equivalent deployment steps for its own build system.
