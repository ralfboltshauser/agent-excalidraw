# Agent Excalidraw — product design and user flows

Design baseline, 2026-11-19. This is the proposed product contract, not evidence of a working app. It supersedes Mac-only UX assumptions in earlier reports. Implementation acceptance gates live in [milestones.md](milestones.md). The accompanying interactive prototype demonstrates selected paths; native installation, drawing, files and agent execution are simulated there.

## Product direction

**A quiet place to think visually, with your agent beside you.**

The audience is a person who draws and an agent that can work on the same drawing. The primary object is a real drawing file. There are no accounts, invented cloud workspaces, internal project databases or in-app model subscriptions to learn.

The aesthetic is precise application chrome around expressive Excalidraw marks. Borrow Arc's retreating sidebar, Linear's density and command-driven navigation, and T3 Code's visible work context. These are design references, not features to reproduce wholesale. Excalidraw supplies the canvas vocabulary: ink, bound arrows, handwritten labels and restrained violet selection. Do not make every button look hand-drawn. Keep the actual editor recognizable.

One signature: **the drawing title is a small paper label** with a restrained ink underline when active. Clicking it reveals the actual path, rename, move and reveal. It joins the beautiful surface to the file on disk instead of adding another ornamental brand device.

### Visual system

* Light shell: fog `#F7F8FA`; paper `#FFFFFF`; ink `#1B1D27`; secondary text `#696B7A`; quiet line `#E6E8EE`; Excalidraw violet `#6965DB`.
* Dark shell: graphite `#17181E`; elevated surface `#22232C`; canvas `#1E1F26`; readable ink `#ECECF1`; muted text `#A0A2B0`; violet `#A29DFA`. These are proposed seed tokens, not a contrast-audited finished theme.
* Semantic tokens are authoritative; verify foreground/background combinations before shipping. The shell follows system appearance by default. Shell appearance never changes a file's persisted canvas background silently.
* UI: bundled neutral sans or an OS-matched system stack, 13–14px ordinary UI, 12px secondary metadata, 16px field text. Canvas: Excalidraw's bundled font families. Handwriting belongs to drawings and one restrained welcome phrase, not long instructions or error text.
* Use a 4px spacing base; 8–12px control gaps; 16–24px section gaps. Compact controls have at least 32px desktop hit areas, increased to 44px on coarse pointers. Real focus rings remain visible.
* One primary action per surface. Error messages replace vague failure with a next step. Persistent save failures never disappear in a toast.
* No ambient motion, loading theatrics or animated diagram playback by default. Canvas input never waits for shell decoration. Theme changes are immediate. Any later motion must preserve reduced-motion behavior.

### The shell

1. **Library.** A compact left rail and a searchable list, with an optional thumbnail grid. Start in list view: name, small preview when useful, location and last opened. A large welcome illustration is only for the true empty state.
2. **Editor.** Thin native-aware title bar; title/location control at the left; status and Agents at the right. The library rail is collapsible. Stock drawing tools float over the canvas. No permanent inspector/chat/activity column supplied by this app.
3. **Quick switch.** Search drawings and actions in one focused surface; `>` restricts to actions. Results include locations to distinguish equal names. It returns focus to the prior tool/selection on dismissal.
4. **Document menu.** Path, save state/time, rename, move, duplicate, reveal. Common file actions are not buried in Settings.
5. **Agents sheet.** Setup, current activity and recent operation summaries. It is a tool connection surface, not a chatbot. Close it and the canvas gets its space back.
6. **Settings.** Appearance, Files & recovery, Agents, Keyboard, About. No empty account/billing pages.

The library can be shown while the active editor remains mounted. Returning to it preserves canvas selection, zoom and undo. Switching to a different document invokes the unsaved-change guard. V1 has one mounted active document per app session; retained tabs/multiple editor windows are a later gate, not fake controls in the first release.

## Platform contract

The public product supports **macOS, Windows and Linux**, with the same core document and agent workflows. A release manifest declares tested OS versions, distributions, architectures and installer variants. Initial proposed architectures: macOS arm64/x64, Windows x64, Linux x64. Windows/Linux ARM builds are supported only when their native acceptance evidence exists; do not silently label emulation as native support.

* macOS: signed/notarized `.dmg`, move to Applications, native app/menu conventions, Cmd shortcuts, Finder reveal.
* Windows: signed per-user `.exe` installer, Start menu entry, Explorer reveal, Ctrl shortcuts; no admin requirement for ordinary app install. PATH/terminal changes are optional, user-scoped and explained.
* Linux: tested `.deb` for the declared Ubuntu LTS baseline; optional AppImage only with an equally usable documented launch path. Respect window-manager chrome, file-manager reveal and XDG paths. Do not claim support for every distribution because an AppImage exists.
* GUI installation bundles the editor/runtime. Manual drawing requires no Node, terminal, Docker, developer toolchain or MCP configuration.
* The agent CLI is an npm package initially; a supported Node prerequisite is acceptable for coding-agent users. Node is not quietly required by the manual desktop path. Missing prerequisites get one actionable instruction.
* Local IPC uses Unix sockets on macOS/Linux and a user-restricted named pipe on Windows. Verify OS permissions/ACLs; do not substitute an unauthenticated TCP listener.
* OS-specific file operations, shortcuts, launch, credentials, trash and permissions live behind platform adapters. Interface text uses “Show in Finder”, “Show in Explorer” or “Show in file manager”.

Default drawing location is `<home>/Excalidraw`, including `%USERPROFILE%\Excalidraw` on Windows. Configuration/recovery/cache locations use the platform's application-data conventions, not hand-coded Mac paths everywhere. The default avoids intentionally choosing Documents/Desktop/Git folders; it cannot guarantee no external backup/sync software.

## Product vocabulary and invariants

* **Drawing** means a `.excalidraw` document. **Folder** means an actual filesystem folder. **Library** is the app's index of known drawings, not storage or backup. **Shape library** is Excalidraw's reusable shapes, a separate concept.
* **New** creates a new file. **Open** uses an existing file in place. **Duplicate** creates a separate document/identity. **Move** changes the current file location. **Export** creates another artifact without changing the drawing's save target.
* “Saved” means the current acknowledged document revision was written successfully. “Recovery available” means a private recovery snapshot exists; it is not a saved-file claim.
* “Tool installed” means the CLI was verified. “Skill installed” means discovery files were verified. “Last used” means a real successful agent call occurred. Copying a command does not make an agent connected.
* An agent's drawing edits use the same live editor. The UI never silently changes the document the agent is bound to when the user changes focus.
* New/open, failed save, disconnected folder, missing file and unknown format never cause silent overwrite, silent relocation, or a blank replacement.
* Local file storage is separate from model privacy. Copy: **“Agents run in your existing tools. Content they read is handled by that tool's provider.”** Never label an agent-assisted workflow “never leaves this device” unless a genuinely local model/host makes that true.

## Complete flow inventory

Every flow below has a trigger, destination, failure/escape and acceptance result. The milestone column identifies the first implementation gate that must demonstrate it; later platform/release gates repeat the real paths.

| ID | Journey | First gate |
|---|---|---|
| F01 | Install and launch the desktop app | M1 alpha, M7 public |
| F02 | Start from a skill/CLI before the app exists | M5 |
| F03 | First launch and first useful action | M3 |
| F04 | Return after normal quit | M3 |
| F05 | Create a drawing manually | M2–M3 |
| F06 | Create a drawing through an agent | M4 |
| F07 | Rename, save and see the real location | M2–M3 |
| F08 | Reopen a recent/pinned drawing | M3 |
| F09 | Open through picker, file association or drop | M2–M3 |
| F10 | Search and switch drawings | M3 |
| F11 | Add/remove a folder in the library | M3 |
| F12 | Star, remove from recents and forget references | M3 |
| F13 | Move/rename a live document | M3 |
| F14 | Duplicate and Save As | M3 |
| F15 | Move a drawing to OS Trash/Recycle Bin | M3 |
| F16 | Export image, SVG or editable artifact | M6 |
| F17 | Set up the CLI and skill | M5 |
| F18 | Add optional MCP | M5 |
| F19 | Human and agent co-edit | M1 proof, M4 product |
| F20 | Stop an agent and revert a batch | M4 |
| F21 | Close, switch or quit with work in progress | M2 |
| F22 | Recover after a crash | M2 |
| F23 | External file change/conflict | M2 |
| F24 | Read-only, corrupt or newer-format document | M2 |
| F25 | Missing file, offline drive or moved folder | M3 |
| F26 | Save fails: permission, disk space or unavailable path | M2 |
| F27 | Learn tools, shortcuts and commands in context | M3, M6 |
| F28 | Settings, keyboard, appearance and accessibility | M6 |
| F29 | Update, mismatch and rollback | M7 |
| F30 | Uninstall, disconnect agents and clear local artifacts | M7 |
| F31 | Large library/document, offline and slow operations | M1 baseline, M6–M7 |
| F32 | Unsupported agent host or different execution machine | M5 |

## Installation and first value

### F01 — Desktop installation

**Entry:** download page or a tagged GitHub Release. The page suggests the detected OS and shows a clearly visible “Other downloads” link with architecture, minimum OS and file size. Labels are explicit, such as “Download for Windows”. Checksum/provenance details are secondary links.

**Happy path:** download → ordinary native install → launch → welcome. No updater check, account prompt, analytics preference wall, agent picker or filesystem permission grant before first value. Missing OS prerequisites are diagnosed before the editor screen, with Retry and a concrete supported-install alternative. Existing installation upgrades preserve drawings/settings and never delete/reinitialize the library.

**Escape/failure:** interrupted download retries safely; unsupported OS/architecture says what is supported; unsigned development artifacts are labeled as development builds. Do not teach users to disable platform security globally. First launch with no internet still reaches an editable canvas because required runtime/assets are installed already.

**Pass:** on a clean supported OS account, a person can install and reach a blank editable drawing without opening a terminal or visiting documentation. Record signing prompts honestly; signing is not a guarantee that every OS reputation system shows zero prompts.

### F02 — Agent-first installation

**Entry:** agent discovers the skill, or a developer runs the published CLI install command. No app is running.

**Flow:** discovery stub checks the CLI → installs a compatible CLI if missing through the documented package path → `agent-excalidraw install` obtains the pinned signed desktop runtime → verifies version/architecture → launches a purpose-named drawing → returns its real path. Progress states: “Installing app”, “Opening drawing”, “Ready”. Every step is idempotent. No build on warm launch.

If Node is unavailable, say so and offer the desktop download route or a specific Node setup step; do not create a mysterious half-install. If download fails, preserve the prior app and return Retry with the actual cause. MCP is not installed as a side effect. Re-running the bootstrap must reuse a healthy installation.

### F03 — First launch

One welcome surface, not a carousel. Wordmark; a small hand-drawn visual; **“A little space for your next idea.”** Supporting text: “Draw here. Keep the files wherever you want.” Primary **New drawing**; secondary **Open drawing…**; quiet **Use with an agent** link. Default folder appears as one editable location row, not a required form.

New drawing enters F05 immediately. Open invokes the native picker. Agent setup opens F17 with “Do this later”. A user who opens a file association bypasses welcome and sees that file; introductory hints remain available in Help. Recovery takes priority over welcome only when real recoverable work exists.

The first empty canvas shows a dismissible, non-document hint: **“Start with a shape, or bring your agent.”** Three concise cues: selection, pan and save using actual platform/editor shortcuts. Drawing or pressing Escape dismisses it. It is never exported or counted as scene content.

### F04 — Returning

Normal launch opens the Library with the last drawing in a “Continue” row, not a compulsory auto-open. An optional “Reopen last drawing” setting can bypass this. Recent entries show name, location and last opened; pinned entries sit above recents without creating another folder model. Current work remains mounted when going to Library and back.

There is no repeated tutorial or update modal. Recovery, failed path availability or a pending explicit update appears as a contextual item. “Continue” never creates a missing file silently.

## Creating, finding and maintaining drawings

### F05 — New manually

**Entry:** New drawing button, native File menu, quick switch action or Mod+N. From the Library, inherit the selected real folder; otherwise use the default root.

Open a blank canvas immediately, allocating `Untitled.excalidraw`, then `Untitled 2.excalidraw`, exclusively. Its title/path are real from creation; initial empty-file creation may complete before interaction. If allocation fails, show the new-document sheet with the intended location and **Choose another folder**, preserving the name. No scene should appear writable while its target is unknowingly invalid.

Click the title to rename inline or use the document menu. A purpose-name field is optional, never a multi-field creation wizard. Do not steal canvas tool shortcuts to rename. An untouched created blank drawing is a real file and remains in the library; there is no undisclosed draft garbage collector deleting it on close. Users can trash unwanted blanks explicitly.

**Pass:** New drawing to ready canvas takes one action; Mod+S thereafter writes the same file with no destination prompt. Creation with a specific name/path is available from the expanded New drawing sheet and CLI.

### F06 — New through an agent

The agent supplies purpose/project or an explicit path. `path suggest` proposes the private-root project namespace. Creation exclusively allocates and returns ID, incarnation, path and revision. Title shows “Onboarding flow”; the document menu exposes the full path. The agent creates a coherent batch, renders, inspects and saves at task completion.

App launch never steals desktop focus repeatedly. The initial requested drawing can be brought forward; subsequent operations update the canvas without repeatedly activating the app. An agent-created file appears in the library even if the user was on another application. If a different dirty drawing is active, the service refuses to switch it implicitly and reports that state; it must not overwrite or discard it to complete the new request. First release can create the new file and defer opening, with a clear result, until the person resolves the current document.

If a requested named existing document matches several entries, the agent receives metadata candidates with paths. No content scan across the user's home directory.

### F07 — Save and title/location

Title control shows the name and a clear dirty indicator when appropriate. The location popover shows the full path, Copy path, reveal, rename and move. A separate compact status reads **Saved**, **Unsaved changes**, **Saving…**, or **Couldn't save**. Hover is not needed to discover an error.

Mod+S/native Save/editor Save/agent Save share one queue. Repeated Save coalesces without duplicate writes. While a revision is saving, later edits remain usable and dirty. Success marks only the written revision saved. A quick save updates inline status without a celebratory toast.

Rename validates only on commit/blur, preserving the entered name if rejected. Keep the `.excalidraw` extension implicit in the normal field and visible in the location. Invalid OS characters, reserved names and case collisions receive field-level messages. Rename changes a path, not unsaved scene content: dirty remains dirty until Save.

### F08–F10 — Open and quick switch

**Recent/starred click:** open the file in place. Equal names always show enough location to distinguish them. Preserve prior zoom/selection when returning to the still-mounted drawing; reopen may restore host view preferences but does not claim to restore native undo after close.

**Native open/file association/drop:** use the same admission/load path. Clicking a file in the OS opens the app and that document. Dropping a `.excalidraw` opens it in place after the unsaved guard; it does not import its contents into the wrong document. Dropping an image onto the canvas adds an image to that scene. A drop containing several drawings opens a chooser/adds library references; it never rapidly switches through and discards documents.

**Quick switch:** Mod+P searches known drawings; `>` filters actions. The palette button remains clickable. Mod+Shift+P opens actions if available without conflict with the pinned editor. Preserve Excalidraw's link shortcut instead of stealing Mod+K globally. Final shortcut collision checks are an implementation gate, not assumed settled.

Arrow keys change result focus; Enter opens; Escape closes and restores focus. A highlighted row is a preview, not a document mutation. No results: **“No drawings match ‘billing’.”** with Clear search, Open file…, New drawing. Search uses filename/path/index metadata by default, not the private contents of every drawing.

### F11 — Add/remove a folder

Library → Add folder… → native picker → show the chosen path and initial scan state. Index only that root under documented recursion/symlink rules. Existing entries become navigable progressively; no blank blocking spinner for the whole app. Exclude app caches, hidden build folders and symlink escapes by default. A folder that goes offline displays one root-level status, not hundreds of scary per-file toasts.

Remove folder… explains **“Remove this folder from the library? The files stay where they are.”** Remove its indexed references; don't delete disk data. Deal with an active dirty document through F21 before losing its navigation entry. Re-adding a folder is safe and does not duplicate canonical file entries.

### F12 — Star, recents and reference removal

Star changes metadata immediately, with a text/keyboard equivalent. Remove from recents only removes that history entry; a watched folder can still list the drawing. “Remove from library” is offered for an individually tracked external file not covered by a registered root. For a folder-indexed drawing, use precise alternatives: Remove from recents, Manage folder, or Move file to Trash. Avoid a generic “Remove” whose disk effect is ambiguous.

### F13 — Move/rename

Title menu or library row → Move… → native folder picker → destination preview → Move. The document keeps its logical ID and live editor, changes path and updates the library atomically enough to recover failures. Moving dirty work does not silently save it. Duplicate names offer a unique new filename or Cancel; replacing another drawing is never the default.

On a different filesystem, copy/verify/remove is not advertised as instantaneous atomic rename. Keep the source until destination verification succeeds; a failed source removal reports that both files remain, without pretending the move fully completed. No cross-platform “Undo move” button unless the reverse operation and conflict checks are implemented.

### F14 — Duplicate / Save As

Duplicate captures the current visible content into a new document with a unique name, after successful write. The original file remains unchanged. If the original was dirty, it remains dirty; creating a copy is not evidence it was saved. Save As writes a chosen new target, then rebinds the live document to it after success. Make the difference explicit in the menu/help. Export is neither operation.

### F15 — Trash

“Move file to Trash” / “Move file to Recycle Bin” is separate from removing a library reference. Confirm the exact file/path. An active dirty drawing offers **Save and move to Trash** and Cancel, explicitly stating that choice's effect. A failed save prevents the trash step.

Use the OS trash facility. If it is unavailable, explain and offer Show in file manager; never fall back to permanent deletion silently. Do not promise cross-platform undo from a toast when the OS API cannot restore the file reliably. If deletion succeeds but index cleanup fails, refresh repairs the index without recreating the file.

### F16 — Export

Export sheet: PNG or SVG; whole drawing, current selection, or frame; background on/off; size; **Include editable drawing** labeled as containing the original scene data. State the consequence: **“Anyone with this export can reopen the included drawing.”** Embedded editability is off for ordinary image sharing unless the person selects it.

The preview and export use the same captured content revision. The person can continue drawing; later edits are not silently included. Native destination picker, then progress and Open file / Show in folder. No invented share URL or cloud upload. Unsupported font/image conditions get an explicit warning/error. Cancel preserves the document and does not leave a success toast or unintended final file.

## Agents, onboarding and education

### F17 — CLI and skill setup

Agents opens a small sheet: **“Use the agent you already work with.”** Short privacy sentence, then **CLI + skill** as the default path. Agent options only appear when configuring a host; the app does not require choosing a model or provider.

Step 1 verifies CLI availability/version. If missing, present the documented install command with Copy and the prerequisite state. “Copied” is feedback, not completion. Step 2 selects detected Codex/Claude Code or a custom supported skill root. Show paths that will be linked and allow **Install skill**. Use one canonical source and symlinks on Unix; test directory junctions/link discovery on Windows. If a host cannot follow a link, report the limitation rather than create untracked duplicates.

Step 3 shows one useful request: **“Use agent-excalidraw to draw a three-step onboarding flow.”** The person runs it in their agent. Successful real tool use changes status to **Last used just now**. If host reload is needed, say exactly that. Don't claim “Connected” because a file was written.

The person can close setup at any point and draw. Setup progress is resumable and each step is idempotent. Existing unrelated config/skills are never replaced silently. CLI/manual app version mismatch displays a repair action that preserves active drawings.

### F18 — Optional MCP

Advanced option in Agents: **Use MCP instead**. Explain: **“The same drawing tools, exposed to MCP-compatible clients.”** Choose host → show the exact registration change → Apply → verify handshake when that client starts the server. Offer copyable configuration when direct registration is unsupported. Keep stdout protocol-clean; surface diagnostics in the setup result.

Removing MCP registration leaves CLI, skill and drawings working. Do not install MCP automatically during default CLI setup. A registered-but-not-running host reads **Configured · waiting for client**, not **Connected**.

### F19 — Live co-editing

Persistent low-key Agents control becomes **Agent working** during real work. A small activity line can say **“Adding 4 steps”**, with Stop. Do not stream model chain-of-thought, add an always-open chat panel or move the user's selection to every agent-created element.

When the user is dragging/typing, the agent receives a bounded wait/busy response; the UI can say **Waiting for your edit** without interrupting that edit. A stale batch is rejected and the agent re-inspects. A completed batch can be focused with **Show changes**, on demand. Saves are a separate state. **Agent finished** is not synonymous with **Saved**.

The active document binding is visible to the agent and in the Agents sheet. Opening another library entry never retargets a queued mutation. If a client requests an operation for an inactive document in the one-editor release, respond explicitly; do not silently bring some other document forward and apply it.

### F20 — Stop/revert

Stop cancels pending work before commit and pauses further mutation admission from that agent session until explicitly resumed. A later request from the same session is refused while paused, so an external agent cannot immediately continue changing the drawing. This app can stop its tool operations; it cannot terminate reasoning in an unrelated agent host. If the batch already committed, report **“Stopped. The last changes are still on the canvas.”** No claim of rollback. Reconcile ambiguous outcomes before retrying.

Native Undo remains available under the tested batch contract. “Revert last agent change” is offered only when its guarded post-revision is still current. After later human work, disable it with an explanation and offer normal history guidance; never restore stale element snapshots over later edits.

### F27 — Teach at the moment of need

* First canvas: select, pan, save; dismiss on action, retain in Help.
* First save: status shows location; path popover teaches Reveal once, not a modal.
* First agent setup: one real prompt and a truthful provider boundary; no generic video tour.
* First supported conflict/recovery: explain which copy is which in the resolution UI.
* Help menu: Getting started, Drawing shortcuts, Agent guide, File & recovery behavior, Diagnostics. All essential guides ship locally and match the installed version.
* Tooltips show action names and real OS shortcuts. Essential actions have menus/buttons and keyboard paths, not only hidden gestures.
* Quick switch results teach commands while executing them. No achievement badges or persistent checklist occupying the canvas.

## Safety, interruptions and recovery

### F21 — Close/switch/quit

Clean document: close/switch normally. Dirty document: **“Save changes to ‘Onboarding flow’?”** with Save, Don't save, Cancel using native ordering/conventions. Save closes only after confirmed disk success. Don't save closes without changing that file and removes that session's matching recovery candidate so it isn't offered as an accidental undo of an intentional discard.

If an agent commit is pending, request stop and reconcile before deciding dirty state. An unresponsive renderer presents the last known recovery status honestly; no “all changes saved” shortcut. Closing the last window follows each OS convention; explicit Quit always flushes/guards dirty work. App updates do not kill a dirty editor.

### F22 — Crash recovery

On launch, a compact recovery panel lists only genuine unsaved candidates, with drawing name, original path and snapshot time. **Restore a copy** is the safe default, writing a unique recovered file after preview; **Discard recovery** deletes only that recovery artifact after confirmation. Keep the original file untouched until an explicit later save/replace choice.

A person can open the saved file and compare. A recovered copy has a visible “Recovered copy” state until first successful save, then behaves like a normal drawing. Do not persist the native undo-history promise across crashes. If recovery is older than the last edit, show its actual time rather than “Recovered everything”.

### F23 — External change

Clean local view and changed disk file: indicate **Changed outside the app** and offer Reload; auto-reload may be a later preference, never destroy dirty content. Dirty local view plus changed disk file: conflict sheet identifies **Your open drawing** and **File on disk**, times and previews when available.

Default action **Save your work as a copy**; secondary Open disk version / Keep editing. An explicit Replace disk file action is advanced and requires clear confirmation. No automatic content merge claim. Locking our app clients does not stop arbitrary external writers; pre-save fingerprints are conflict detection, not a universal filesystem transaction.

### F24 — Unsupported/read-only/corrupt

Read-only permissions: view normally with a persistent read-only banner and **Save a copy…**. Corrupt scene: preserve bytes; show path and the parse/load reason, with Open another file / Show in folder / View recovery. Never show a blank editable canvas that could overwrite the bad input.

Unknown future element types: read-only or supported-content preview with **“This drawing uses elements this version can't edit.”** Count unsupported content where known. Offer Update app (explicit network action), Open another file, or Export supported preview with qualification. **Save compatible copy…** explains removed content and never overwrites the original. Do not equate stable SDK version with compatibility with every current excalidraw.com file.

### F25 — Missing/moved/unavailable

Missing single file: **“We can't find this drawing at [path].”** Locate file…, Remove reference, Cancel. Selecting a candidate validates it before rebinding. A watched folder/drive offline shows one root status with Retry/Locate folder; it does not mark every drawing corrupt. File permissions can be retried after an OS change. Never recreate a missing original silently.

### F26 — Save failure

Persistent inline **Couldn't save** status opens a focused sheet containing destination and reason: no permission, disk full, disconnected location or invalid destination. Primary **Save a copy…**; secondary Retry; Keep editing remains possible. The original saved file and current in-memory work remain intact. Report whether a recovery snapshot actually exists, not a generic reassurance.

If the latest content revision changes while saving, completing the older write must leave the later one dirty. Save failure never triggers library navigation, close, move, export success or a green check.

## Settings, updates and lifecycle

### F28 — Settings and keyboard

Appearance: System/Light/Dark, UI scale, reduced motion follow OS. Files & recovery: default folder, optional autosave, recovery retention/location, cache cleanup and document-open preference. Agents: integrations and status. Keyboard: searchable real bindings, conflicts and restore defaults. About: app/editor/CLI/protocol versions, licenses and explicit update check.

Changing the default folder affects new drawings only. Cache/recovery cleanup previews what is being removed and never deletes source drawings. Excalidraw's shape library is persisted separately and clearly labeled. Accessibility: complete keyboard/focus behavior for the shell, readable contrast, noncolor statuses, screen-reader dialog labels and scalable text. Expose a useful drawing outline where available; do not claim full screen-reader equivalence for the stock canvas without validating it.

### F29 — Updates and mismatches

No background network update check by default. About → Check for updates explicitly contacts the release service, displays installed/new versions and notes, and lets the user choose download/install. Package-manager installations use their own documented update route. Prefer restoring the previous app binary if installation fails; drawings do not participate in app rollback.

If work is dirty: **Update after I close this drawing** or Cancel. A CLI/app protocol mismatch can be repaired without restarting the active editor blindly. Downloads verify platform/signing/version and never execute untrusted artifacts just because a URL resolved. Clear progress, cancel where safe, and preserve the prior healthy installation.

### F30 — Disconnect/uninstall

Remove skill/MCP integration separately in Agents; show owned paths/entries and preserve unrelated host configuration. Removing an integration doesn't remove drawings. OS uninstall removes app/runtime; source drawings stay. An optional “Remove local app data” action explicitly lists settings, previews and recovery artifacts, with a warning about unsaved recovery. Do not offer an ambiguous “Delete everything” checkbox selected by default.

### F31 — Fast, large and offline

Library list renders indexed metadata before thumbnails; only visible previews load. Search never parses every scene on each keypress. Large documents show a real bounded loading stage, allow cancellation before activation, and keep the prior document until the new one is ready. Long operations report what is being done and don't disable unrelated actions indefinitely. Recovery/save/render work does not re-render the entire shell on each pointer event.

An offline launch/draw/save/export/setup-guide path works with cold caches. Network-dependent installation/update action says **Internet required to download the app/update**. It does not label manual drawing unavailable because an agent host is disconnected.

### F32 — Host/machine mismatch

Explain that a local agent tool runs on the machine containing the files. A remote coding environment or WSL invocation is not silently bridged to the desktop. Offer the matching local CLI instructions/host configuration and a diagnostic explaining the mismatch. Remote/LAN access is a separate product scope, disabled by default. An unsupported host still gets the full CLI guide; it isn't a dead end requiring MCP.

## Input and focus contract

Native dialogs use native OS behavior. App dialogs move focus inside, constrain it while modal, and restore the invoking focus on dismissal. Escape dismisses the top transient surface without discarding a drawing. Enter submits a single-line form; multiline fields keep newline semantics. Clickable actions are actual buttons/links. Context-menu actions have menu/command equivalents.

Mod+N New; Mod+O Open; Mod+S Save; Mod+Shift+S Save As; Mod+P quick switch; proposed Mod+Shift+P actions; Mod+Comma settings where compatible. Preserve editor tool, link, text-editing, undo and redo bindings. Never intercept a character tool shortcut while a text input/IME owns focus. A final pinned-editor shortcut audit must settle conflicts before M3 acceptance.

## Design acceptance principles

* A new person can create/open without understanding agents, runtimes or MCP.
* A coding agent can create/edit/render/save without registering MCP or driving UI coordinates.
* Every drawing can answer “What file is this?” in one click.
* Primary create/open paths are one action from Library; ordinary Save is zero dialogs.
* Every displayed success is tied to its actual effect. Error and recovery states remain useful with no internet.
* The visual shell is minimal, but errors and essential actions never disappear into hover-only affordances.

## Inspiration and implementation references

Design interpretation is our own. Primary reference behavior: [T3 Code keybindings and command palette](https://github.com/pingdotgg/t3code/blob/main/docs/user/keybindings.md), [T3 Code appearance](https://github.com/pingdotgg/t3code/blob/main/docs/user/appearance.md), [Linear display/command navigation](https://linear.app/docs/display-options), [Arc command-bar/sidebar behavior](https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes). Platform groundwork: [Electron distribution](https://www.electronjs.org/docs/latest/tutorial/distribution-overview), [Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Node IPC](https://nodejs.org/api/net.html#ipc-support). Older source research remains in the parent directory; this document defines the current UX scope.
