export const coreInstructions=`# Agent Excalidraw — installed command guide

Use the CLI directly; MCP registration is optional. The desktop app opens on the first drawing command. Run agent-excalidraw doctor if launch fails. Installation and explicit updates need internet; drawing works offline.

## Choose the file

Honor an explicit path. For an existing drawing, use list --json and open --path <absolute path>; compare full paths before choosing among equal names. For a new idea use new --title <purpose> --project-dir <current project> --json. This chooses a collision-free file under the configured drawing root, outside the repository by default. A request merely to launch the workspace uses launch, not new.

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

## Preserve human work

Target the returned document ID, never whichever window is focused. Inspect selection with snapshot --selection, groups with snapshot --group <group ID>, or named shapes with snapshot --ids <id1,id2>. A region rectangle can be supplied through --input; inspect schema for its shape. Use view only when you intend to change selection/viewport. Keep the person's selection/viewport unless they ask you to focus changes. DOCUMENT_BUSY means the person is mid-edit: wait briefly, then inspect again. STALE_REVISION or STALE_EPOCH requires a fresh snapshot and a newly considered batch. Do not force an old snapshot over current work. Moving a shape with a bent, elbow or rotated bound arrow can return UNSUPPORTED_OPERATION; the batch is refused without changes. Preserve that geometry and use the editor rather than repeatedly flattening or replacing its connectors.

On OUTCOME_UNKNOWN, reconcile operation status --request-id <same ID> --document <id> --epoch <epoch> --json before replay. A restart changes the epoch and invalidates old mutation preconditions. Revert-last-agent-batch is available only while its post-revision is still current. Stop pauses that session's later mutations until resume; it does not undo applied edits.

## Privacy and completion

Manual app use keeps files local. Content you read through the tool is handled by your agent provider. Rendering/export supports --scale 0.1 through 4 and --no-background for transparency. Export editable drawing data with --embed-scene only when requested; ordinary image exports exclude it. No scene content goes in diagnostic logs. Finish with a real render inspection and a successful save receipt, or state precisely what remains unsaved/unverified.
`;
