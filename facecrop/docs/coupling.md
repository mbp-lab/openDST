# Extraction boundaries

Facecrop has no React dependency. The public API consumes a host-owned playing video element, explicit configuration, an explicit distribution URL, and a promise-based storage transport. The JATOS adapter is optional and receives its API instance explicitly. React examples use the same API and await finalization before navigation; unmount cleanup alone cannot enforce this.

The former openDST interface accepted React-webcam plus props, read build-time environment variables, selected captures by study page, found JATOS globally, and delegated to openDST upload-state callbacks. These decisions now live in the host adapter. Capture identity and optional readable filename prefixes are supplied independently of the study's page sequence.

Classic workers, transferable VideoFrames, supported source layouts, pinned detector assets, bounded queues, and ordered asynchronous finalization remain requirements of the current processing implementation. The library validates configuration before starting resources and reports browser/runtime failures explicitly. It never acquires camera permissions, stops host tracks, changes navigation, clears caches/service workers, or intercepts console methods.

The source, assets, locked build dependencies, tests, license, and examples in this directory are self-contained. It is ready to move into another Git repository and be consumed as a pinned submodule later. It currently remains an ordinary directory; no nested Git repository or remote reference was created.
