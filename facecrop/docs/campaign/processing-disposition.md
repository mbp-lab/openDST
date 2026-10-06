# Processing profile and disposition

Status: exploration complete; ordered worker design and scientific processing retained. Final distribution: `c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c` (production source `fcae374`). No sampling, crop, normalization, encoding or concurrency-default change was adopted.

## Reproducible evidence

[True pinned baseline](sustained-pinned-baseline.json) uses extraction `4fd85bc6e031f33f3dd3aad6207e25b69fd8d595`, independently built in a temporary directory. Its UMD SHA-256 `5e71a5753d5051de4920e6fb93e64ef27d46fb3971ccf00e6086ccf9e2284777` and worker SHA-256 `f93e2452763c01846d8f8985371ba813962d6149e3858a687cf04198a41753ee` match the original distribution. An earlier attempted comparison mistakenly used a later HEAD and is excluded from baseline evidence. Earlier instrumentation also mismatched sidecar/AVI names; zero observations from those attempts are not retention proof.

[Final six-part report](sustained-final.json) repeats the same 96×96 canvas stream, requested 30 FPS, six full 539-frame parts per worker count, 40 ms writes, one initial sidecar rejection, echoing payload acknowledgements and explicit GC. Environment: Chromium 153.0.8010.12, Node 22.16.0, npm 10.9.2, Linux x86_64 container, AMD Ryzen 7 7800X3D, 16 visible logical CPUs, cgroup CPU quota `max 100000`. Instrumentation and container scheduling affect timing; this is not a camera throughput comparison.

Both final captures ran about 108.5 seconds, accepted 3,243/3,241 frames and produced seven ordered sidecars (six full parts plus a tail). Every frame index, timestamp, preceding-part timestamp and segment/part sequence was checked. Before/after counts while sessions remain reachable:

| Worker count | Baseline live frame arrays / acknowledgements | Final live frame arrays / acknowledgements |
|---|---|---|
| 1 | 7 / 15 | 0 / 0 |
| 2 | 7 / 15 | 0 / 0 |

Positive WeakRef observations identify original arrays, not arrays reparsed from JSON. Completed parts also had zero live arrays during continued final capture. Tracked workers and video-frame callbacks ended at zero after stop and abort; the host stream stayed live. Repeated stop and held-write abort passed. [Root-mount report](browser-root-mount-final.json) also exercises repeated start. All 14 distribution files, including all WASM variants and model weights, returned successful browser responses at both root and nested mounts.

The mock abort elapsed field includes a post-release 100 ms wait/GC and is not a direct abort latency benchmark. Promptness is proved by abort resolving before release of the held write within the five-second guard. Actual JATOS abort timing is separately recorded in [its final report](jatos-acceptance-final-result.json).

## Architecture and residual profiling

Keep separate analysis, ordered assembly and encoding roles: the measured workload sustains correct output with one/two workers and bounded ownership. No measurement supports replacing them or changing the default of one worker. Controller admissions plus buffered assembly are capped by worker count; assembly buffers by that count; encoding by one job; sink by two admitted parts. Frame/tensor cleanup and part buffers are detailed in [the acceptance report](acceptance-report.md).

Full-frame normalization allocates RGBA; detector conversion allocates RGB and an int32 tensor disposed in finally. RGBA is transferred through ordered assembly. The partial 539-frame BGR part is about 8.38 MB before encoding overhead. Buffer reuse is deferred until high-resolution allocation/transfer profiling demonstrates benefit. Adaptive sampling, ROI-only extraction and FPS limits remain separate scientific proposals, not adopted cleanups.

Worker stage/queue timings are in the raw reports. Main-thread/native/GPU/process RSS trends, simultaneous sessions, physical desktop/mobile cameras and broad browser comparisons remain deferred profiling; forced GC and fixed `performance.memory` readings do not establish total-memory performance. These limits do not invalidate the directly observed original-array/acknowledgement release. No device-sensitive processing change was made.
