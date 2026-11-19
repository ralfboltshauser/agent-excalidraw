export const coreInstructions = `# Agent Excalidraw — installed command guide

Use the CLI directly; MCP registration is optional. The desktop app opens on the first drawing command. Run agent-excalidraw doctor if launch fails. Installation and explicit updates need internet; drawing works offline.

## Skill discovery and safe installation

If agent-excalidraw is not on PATH, first check the desktop app's local launcher: ~/.local/bin/agent-excalidraw on macOS/Linux, or %LOCALAPPDATA%\\agent-excalidraw\\bin\\agent-excalidraw.cmd on Windows. Run skills get core through that full path, and use the resolved command throughout the task. This avoids reinstalling an already working app merely because a terminal's PATH is stale.

skills install --dry-run --json previews the canonical source and exact selected host links. Default roots honor AGENTS_HOME, CODEX_HOME and CLAUDE_CONFIG_DIR, with ~/.agents, ~/.codex and ~/.claude as fallbacks. For an isolated trial, use:
agent-excalidraw skills install --home /tmp/excalidraw-trial --data-dir /tmp/excalidraw-trial/app-data --hosts codex,claude --dry-run --json

--home overrides inherited host-root settings for every selected agent. --data-dir sets the canonical source directory; AGENT_EXCALIDRAW_DATA_DIR supplies its default when set. Remove --dry-run to install; repeat the same home/data-dir when uninstalling. Installation preserves unrelated existing skills. A copied or installed skill is not proof of a real agent call.

## Choose the file

Honor an explicit path. The displayed drawing name follows its filename; --title suggests a filename only when --path is omitted. For an existing drawing, use list --query <name or path> --json and open --path <absolute path>; compare full paths before choosing among equal names. Library results are paginated: follow nextOffset until null when you need all matches. status returns a count, not every private filename. For a new idea use new --title <purpose> --project-dir <current project> --json. This chooses a collision-free file under the configured drawing root, outside the repository by default. A request merely to launch the workspace uses launch, not new. Leave the app open after drawing unless asked to close it. The quit command closes only after saved work; unsaved agent shutdown is refused.

## Edit the live document

1. Read snapshot --document <id> --json. Keep document, epoch, revision and the stable element IDs. A partial snapshot is marked incomplete: page or restrict scope before making global claims.
2. Write a JSON input file with an operations array. Use apply --document <id> --epoch <epoch> --expected-revision <revision> --request-id <unique ID> --session <your session> --input <file> --json. Scene payloads belong in files/stdin, avoiding shell history and argv.
3. Use render --document <id> --epoch <epoch> --output <absolute PNG path> --json, then actually open/view the returned image. Refine labels, spacing, hierarchy, crossings and clipping. Source JSON alone is not visual inspection.
4. Save the authorized finished work with save --document <id> --epoch <epoch> --json. Report the actual returned file path. Agent finished and Saved are different states.

Example apply input (after obtaining live preconditions):
\
{
  "operations": [
    {"op":"create","ref":"start","type":"rectangle","x":0,"y":0,"width":180,"height":90,"label":{"text":"Start","fontFamily":5,"fontSize":20},"strokeColor":"#6965db","backgroundColor":"#eeedff","fillStyle":"solid","roundness":{"type":3}},
    {"op":"create","ref":"finish","type":"rectangle","x":300,"y":0,"width":180,"height":90,"label":"Finish","backgroundColor":"#ffffff","fillStyle":"solid","roundness":{"type":3}},
    {"op":"create","type":"arrow","from":"start","to":"finish","label":"next"}
  ]
}
\

Style and geometry fields go directly on each operation, for example strokeColor, backgroundColor, fillStyle, roughness, opacity, roundness and x/y/width/height. A nested style object is rejected. For sharp corners use roundness:null; rounded boxes use roundness:{"type":3}. Font IDs: 1 Virgil, 2 Helvetica, 3 Cascadia, 5 Excalifont, 6 Nunito, 7 Lilita One, 8 Comic Shanns, 9 Liberation Sans (Agent Sans fallback).

Update uses {"op":"update","id":"stable ID","x":120,"label":{"text":"Revised","fontFamily":5,"fontSize":20}}; delete uses {"op":"delete","id":"stable ID"}; group uses {"op":"group","ids":["id1","id2"]}. Refs exist only inside the submitted batch: a later arrow from/to can use them. The receipt returns created entries with ref and stable id; use those stable IDs in subsequent batches. Type-specific and styling fields are documented in apply --help and schema.

Canvas background is also a revision-checked operation: {"op":"canvas","viewBackgroundColor":"#ffffff"}. It can share one batch with shapes and one native Undo step; shell theme remains separate.

## Optional embedded canvas

When the host exposes the MCP tool show_canvas and the user wants the drawing inside their coding-agent conversation, first obtain the explicit document and epoch through snapshot, then call show_canvas with those values. The panel is a read-only mirror of the same live desktop drawing; keep editing through the existing CLI or MCP commands and save explicitly. Its image refreshes after accepted changes. A changed/closed/reopened document expires the old panel: create a fresh view only for the drawing the user requested.

If show_canvas is unavailable or the host cannot display MCP Apps, use the normal render-and-view workflow and leave the desktop app open. CLI-only work requires no MCP configuration. App-only canvas_read carries preview bytes for the UI; agents use snapshot/render for their own inspection. Local transport does not prevent the host from retaining displayed pixels or the agent provider from processing content supplied to it.

## Preserve human work

Target the returned document ID, never whichever window is focused. Inspect selection with snapshot --selection, groups with snapshot --group <group ID>, or named shapes with snapshot --ids <id1,id2>. A region rectangle can be supplied through --input; inspect schema for its shape. Use view only when you intend to change selection/viewport. Keep the person's selection/viewport unless they ask you to focus changes. DOCUMENT_BUSY means the person is mid-edit: wait briefly, then inspect again. STALE_REVISION or STALE_EPOCH requires a fresh snapshot and a newly considered batch. Do not force an old snapshot over current work. Moving a shape with a bent, elbow or rotated bound arrow can return UNSUPPORTED_OPERATION; the batch is refused without changes. Preserve that geometry and use the editor rather than repeatedly flattening or replacing its connectors.

On OUTCOME_UNKNOWN, reconcile operation status --request-id <same ID> --document <id> --epoch <epoch> --json before replay. A restart changes the epoch and invalidates old mutation preconditions. Revert-last-agent-batch is available only while its post-revision is still current. Stop pauses that session's later mutations until resume; it does not undo applied edits.

## Privacy and completion

Manual app use keeps files local. Content you read through the tool is handled by your agent provider. Rendering/export supports --scale 0.1 through 4 and --no-background for transparency. Export editable drawing data with --embed-scene only when requested; ordinary image exports exclude it. No scene content goes in diagnostic logs. Finish with a real render inspection and a successful save receipt, or state precisely what remains unsaved/unverified.
`;
