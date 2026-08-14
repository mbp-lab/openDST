# Raw patch pipeline architecture

## Upload terminal-state invariant

All result-file uploads are registered with a stable ID and begin in the
`pending` state. An upload settles exactly once as either `succeeded` or
`failed`; neither terminal state may change afterwards. Completion and
redirection are gated only by the absence of `pending` uploads. A failed upload
therefore does not block the study, and it is never represented as successful.

This invariant is shared by the existing video upload flow and future
best-effort raw-patch uploads.
