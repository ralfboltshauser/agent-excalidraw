# Implementation log

## M0 — 2026-11-19

Implementation authorized against the existing visual direction and 32-flow specification. Created a standalone repository rather than modifying the unrelated parent project.

M0 design artifacts are ready for review; no claim of user visual acceptance is inferred. Future milestone handoffs retain pass/fail/not-run evidence.

## M1 — in progress

Pinned the published Excalidraw SDK and began the renderer-owned live document integration. File/CLI modules were developed in parallel behind typed interfaces to permit actual end-to-end proof. This development concurrency does not mean later gates have passed.

Changes discovered during integration review: final load admission must validate the prior renderer revision; notifications and delayed recovery need document/epoch identity; file/export commands require explicit agent document/epoch; nonactive trash must preserve active dirty state; image exports cannot overwrite existing source paths.

Platform lanes are separate: local macOS walkthroughs are possible here; native Windows/Linux CI must actually run before cross-platform acceptance. Public release signing and installer tests remain release blockers.
