# Extraction boundaries

Facecrop has no React dependency. The public API consumes an application-owned playing video element, explicit configuration, an explicit distribution URL, and a promise-based storage transport. The JATOS adapter is optional and receives its API instance explicitly. React examples use the same API and await finalization before navigation; unmount cleanup alone cannot enforce this.

The former openDST interface accepted React-webcam plus props, read build-time environment variables, selected captures by study page, found JATOS globally, and delegated to openDST upload-state callbacks. These decisions now live in the application adapter. Capture identity and optional readable filename prefixes are supplied independently of the study's page sequence.

Classic workers, transferable VideoFrames, supported source layouts, pinned detector assets, bounded queues, and ordered asynchronous finalization remain requirements of the current processing implementation. The library validates configuration before starting resources and reports browser/runtime failures explicitly. It never acquires camera permissions, stops application-owned camera tracks, changes navigation, clears caches/service workers, or intercepts console methods.

The source, assets, locked build dependencies, tests, license, and examples in this directory are self-contained. It is ready to move into another Git repository and be consumed as a pinned submodule later. It currently remains an ordinary directory; no nested Git repository or remote reference was created.

## Standalone tooling boundary

Distribution verification and staging recovery live in `scripts/` inside this module. `stageDistribution` accepts explicit generated-entry, public-asset, URL-prefix and temporary-work destinations; the openDST wrapper supplies CRA paths. The ordinary module test suite imports no application scripts.

Optional real-JATOS acceptance uses an explicitly supplied workbench fixture root, archive and seed. Historical retention comparisons require an explicit baseline source directory or Git repository. Neither tool infers a parent repository from this module's filesystem position. These external fixtures are not required for standalone installation, unit tests or builds.

Split-readiness verification (2026-10-06): copied only this module into a fresh temporary directory outside the workbench, excluding `node_modules` and `dist`. Offline locked `npm ci`, all 95 tests across eight suites, and a build with `NODE_OPTIONS` unset passed. The distribution hash remained `c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c`. Real JATOS 3.11.1/Chromium 153 acceptance passed from that isolated copy with explicit fixture paths, including stored outputs, rejected-response uncertainty, abort, marker persistence and unchanged installed JATOS state. Current and explicitly supplied baseline retention fixtures passed. The study stage command and all 24 study tests across six suites passed. No nested repository or submodule was created by these changes.

Subsequent naming cleanup uses `stage-facecrop.js` and `FaceCropStudyAdapter.js`, with study-specific symbols and application terminology for generic consumers. The video-argument validation message changed accordingly; the resulting distribution hash is `131852fd301b22853ae18f1a25c7c5eec95ddf3b983a3b1bb27c3b0afa287110`. The capture processing behavior is unchanged. All 95 module tests and 24 study tests passed, and the renamed stage command built and verified the distribution.
