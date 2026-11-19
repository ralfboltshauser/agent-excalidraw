# Implementation log

## M0 — 2026-11-19

Implementation authorized against the existing visual direction and 32-flow specification. Created a standalone repository rather than modifying the unrelated parent project.

M0 design artifacts are ready for review; no claim of user visual acceptance is inferred. Future milestone handoffs retain pass/fail/not-run evidence.

## M1 — in progress

Pinned the published Excalidraw SDK and began the renderer-owned live document integration. File/CLI modules were developed in parallel behind typed interfaces to permit actual end-to-end proof. This development concurrency does not mean later gates have passed.

Changes discovered during integration review: final load admission must validate the prior renderer revision; notifications and delayed recovery need document/epoch identity; file/export commands require explicit agent document/epoch; nonactive trash must preserve active dirty state; image exports cannot overwrite existing source paths.

Platform lanes are separate: local macOS walkthroughs are possible here; native Windows/Linux CI must actually run before cross-platform acceptance. Public release signing and installer tests remain release blockers.

### Native M1/M2/M4 proof, macOS arm64

Five real Electron integration journeys passed: first-launch/library/settings/agents/help/export UI; CLI semantic creation, stable IDs, staleness, arrow movement, native one-step Undo/Redo, PNG/SVG and save/reopen; real mouse drag with busy/stale refusal; outside-file conflict/save-copy; SIGKILL/relaunch/recovery-copy. Actual screenshots and file artifacts were inspected. This does not pass the full platform or installer gates.

The keyboard failure was traced to the pinned SDK: changing `handleKeyboardGlobally` after mount removed local handling without installing its document listener. Keep it false and retain editor-local focus handling; native Electron Undo/Redo routes to the pinned editor action. Regression tests cover V/R and Cmd+Z/Shift+Cmd+Z.

The first clean CI install failed because the npm-generated lock omitted optional WASM peer entries required by npm10 on runners. Regenerate the lock in an empty directory and verify a clean npm10 install, rather than using the existing node_modules as proof.

Node CLI dependencies are bundled into one executable script. Standalone CLI/MCP initialization, all20 tools, authenticated calls and version-matched guide passed in an isolated directory without node_modules. Build dependencies are development-only; the native package and npm consumer need no redundant drawing-engine node_modules tree.

### Further integration findings

Stop now interrupts pending font preparation and rejects previously queued session mutations; Resume admits newly considered work. Document load admission checks the previous renderer identity/revision before reset, and main publishes the new epoch only after acceptance.

Manual image import uses the SDK's supported file-input adapter. Playwright intercepts Chromium File System Access pickers with AbortError; this was an automation limitation, not proof of a broken native picker. Choosing the fallback before SDK import keeps file dialogs under a consistent adapter and prevents editor document-save paths from bypassing the native host. Manual image import/placement has two observed SDK history boundaries; the one-step requirement applies to agent batches.

Native file serialization removes deleted shapes and unused image resources. Read-only sources refuse replacement even when their directory would permit atomic rename. Errors after publication report WRITE_OUTCOME_UNKNOWN instead of asserting the original is unchanged.

Font audit found a legacy 1.05 fallback with different license provenance. It is replaced by a reproducible OFL-derived Agent Sans fallback, with original copyright retained and internal names changed. Printable ASCII advances and vertical metrics match; two other shared codepoints differ. Package inspection and actual fallback renders are release checks.

### Expanded native baseline

A clean build (143 bundled library notices), full typecheck and all nine real Electron end-to-end journeys passed together. Added actual PNG file-picker import, local binary persistence, native image Undo/Redo, reopen and render; pending real font preparation interrupted by Stop; queued edit cancellation; stale renderer load refusal; and navigation before creating any drawing. Screenshots were inspected. This is macOS arm64 evidence, not a signed download or other-OS pass.

### Packaged and consumer checks

Actual282MB macOS arm64 package passed the same nine real journeys. ASAR inspection confirmed zero node_modules entries, the verified OFL fallback hash, and retained dependency/font notices. The npm CLI tarball is679KB compressed and installs as one dependency-free package (~3.7MB). An independent consumer completed the full diagram loop using only installed public commands/guide; isolated skill-root setup was undiscoverable and will be corrected before M5 acceptance.

The all-OS run now reaches native tests after the lock correction. Windows passed7/9; fixture short-path canonicalization and hard-crash process-tree cleanup need native recheck. Ubuntu's official Electron sandbox helper requires its standard root owner and4755 mode. Configure that helper in ephemeral CI and retain sandboxing, rather than passing --no-sandbox. Native installer/public trust checks remain open.
