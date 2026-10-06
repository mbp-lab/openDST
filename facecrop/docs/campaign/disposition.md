# Final disposition register

The original scope is preserved. Every finding below has an implemented, retained or deferred disposition. Final executable evidence is tied to distribution `c1b2cee002a4c2d0050ea3c153eb95b8bdf00cf685254ccd1a34f421fe82e53c`; production source is frozen at `fcae374`. Validation/documentation commits do not change that binary.

| Finding | Disposition and rationale | Evidence / checkpoint |
|---|---|---|
| Completed frame metadata / buffers retained | Implemented compact entry identity, release on completion/queued abort, and release settled acknowledgements | A notes; Node and discriminating browser before/after; `225b8a0`, `fcae374` |
| Unattempted sidecar labeled failed | Implemented additive `not_attempted`; abort `discarded`; rejected writes remain `uncertain` | Sink tests and actual JATOS accepted-then-rejected AVI/sidecar/manifest; metadata migration |
| Overlapping persistence representations | Retained compact views: result objects are shared references; no proven duplicate full payload remains | 143,515-byte compact projection for 200 parts; A ownership notes |
| Study method mutation and lifecycle layers | Implemented explicit coordinator and untransferred-frame cleanup; retained distinct camera/transport/navigation owners | B owner/race notes, unit/browser gates; `f84472d`, `e298605` |
| Study capture history | Retained latest compact row per capture, intentionally growing with capture/part count | Actual browser snapshot replay, 1,000 updates/201 rows; study-history measurement |
| Ordinary recorder chunks / repeated filename | Deferred separate study behavior/schema decision; same-counter support not established | B finding, unchanged filenames/chunks; unresolved repeated-recording gate explicitly recorded |
| Repeated configuration defaults | Implemented study use of canonical library defaults; strict validation retained | Default/custom runtime+metadata regressions; `f8e257b` |
| Duplicated private scientific/build constants | Retained current explicit pins; larger consolidation deferred without demonstrated drift/benefit | C inventory and unchanged worker binary/scientific corpus |
| Distributed accounting | Added nonnegative-safe-integer check; retained normal-finalization equations and partial abort semantics | Real controller failure transitions and sustained/JATOS outcomes; `f8e257b` |
| Internal legacy kwargs / filenames | Retained low-cost compatibility; public sessions/examples already use prefixes/capture IDs | C caller inventory and output naming tests; no stored-data rewrite |
| Hidden installation/build/staging | Implemented explicit setup/stage; packaging explicitly calls it | Clean locked installs, CRA build, workbench package/runner; `74ee026`, workbench `2b0b0dd` |
| Incomplete runtime/hash verification and destructive replacement | Implemented shared exact-tree verifier, temporary builds and recoverable promotion; old hashes retained | Six failure/corruption/recovery regressions; repeated build hashes; `74ee026` |
| Distribution / examples / toolchain | Private complete browser distribution retained; single browser deployment input; Node 22/npm 10 documented and exact versions tested | Clean CRA consumer, root/nested asset loading, package metadata and archive byte comparison |
| npm package release / actual submodule | Deferred publication; ordinary directory retained as authorized | No remote selected, no facecrop submodule, private package unchanged |
| Processing roles / full-frame copies | Retained with resource/profile rationale; copy reuse deferred pending high-resolution evidence | E source map, stage/queue timings, six-part browser gates |
| Adaptive FPS / ROI-only extraction | Deferred scientific proposals; no sampling/output change | No migration needed; conditional device-sensitive gates not invoked |
| JATOS upload / cancellation | Passed real disposable JATOS API and stored-file evidence, marker policy preserved | Final JATOS report and 27-check runner; no production participant study touched |
| Physical device / production server / native memory claims | Deferred broader platform/profiling work, explicitly outside claims made here | No adopted device-sensitive change; limitations in final report |

Compatibility: unchanged AVI/sidecar bytes, scientific selection, normalization, timing authority and filenames. Additive `not_attempted` and `reconciliation.checks.counts` are documented; older stored records remain readable. Rollback plans are recorded with each candidate.

The user's page 1 / slide 4 startup edit is preserved and excluded from commits. The workbench recorded openDST Git link remains `e167647dcf36310346743bb67099400d036e6cdf`; publication/push and remote deletion are outside authorization. The complete evidence and remaining limits are in [acceptance-report.md](acceptance-report.md).
