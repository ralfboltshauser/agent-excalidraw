# Independent diagram consumer trial

Test date: 2026-11-19. Synthetic content only. The consumer installed the provided `agent-excalidraw-0.1.0.tgz` in a fresh temporary npm project, then reinstalled the refreshed archive before drawing. Public inputs were the packaged README, `--help`, `skills get core`, `schema`, and `apply --help`. No application implementation source was read. No MCP, UI clicking, browser interaction, AppleScript, or private renderer evaluation was used.

The signed packaged desktop executable supplied by the parent was tested through the installed CLI. Parent-provided provenance: source commit `ca19157`; ASAR SHA-256 `c99222d12a305b9892416a9e22269426ac92b07132976bed6a64de5d713ac8a4`. The consumer did not independently rebuild or hash that package. A separate short `AGENT_EXCALIDRAW_DATA_DIR` and explicit temporary drawing and image paths isolated this trial. File locations were explicitly chosen for the test; this does not test autonomous file-location heuristics. No real integrations or global settings were installed.

## Results

Scores are visual judgments of the actual CLI-rendered PNGs, each opened using `view_image`. Each dimension uses 1–5, with 5 meaning clearly readable/no observed issue at the rendered size, 4 meaning a minor improvement remains, and 3 or below requiring refinement. JSON checks supplement this visual review; IDs alone do not establish readability.

| Task / final PNG                                 | Labels | Hierarchy | Spacing | Crossings | Clipping | Mean | Refinement loops                                                        |
| ------------------------------------------------ | -----: | --------: | ------: | --------: | -------: | ---: | ----------------------------------------------------------------------- |
| Local notes system context / `notes-context.png` |      5 |         5 |       4 |         5 |        5 |  4.8 | 0                                                                       |
| Yes/No onboarding flow / `onboarding-flow.png`   |      5 |         5 |       5 |         5 |        5 |  5.0 | 0                                                                       |
| Project-planning mindmap / `project-plan.png`    |      5 |         4 |       4 |         5 |        5 |  4.6 | 0                                                                       |
| Annotated sketch / `sketch-annotation.png`       |      5 |         4 |       4 |         5 |        5 |  4.6 | 1 additive annotation pass after viewing saved fixture; 0 further loops |
| Refined existing clutter / `clutter-refined.png` |      5 |         4 |       5 |         5 |        5 |  4.8 | 1 public `layout` pass after viewing saved fixture; 0 further loops     |

- **System context:** writer, local app, device storage, and optional user backup folder are distinct. Connection labels remain readable. The top title region could be slightly tighter. Three connectors have reciprocal live bindings. Saved revision 1 contains 16 elements.
- **Onboarding:** the diamond asks “Existing notes?”; Yes leads to import and No to first-note creation. Both merge into Workspace ready without crossings. Five connectors have reciprocal live bindings. Saved revision 1 contains 18 elements.
- **Mindmap:** four colored branches surround a larger central project. Branch details are readable, but free-standing notes could sit closer to their branch labels; this is a modest four-branch mindmap, not a dense planning stress test. Four connectors have reciprocal live bindings. Saved revision 1 contains 19 elements.
- **Sketch annotation:** the initial rough, unfilled “quick jot → inbox → weekly review” sketch was saved and rendered before annotations. The final adds a blue explanation layer below it. All 10 original elements retain their IDs, geometry (including points and angle), text, seed, style, and binding fields. Five added elements include a label. Two connectors remain reciprocally bound. Saved final revision 2 contains 15 elements. This fixture is agent-authored to resemble human work; no real human sketch was used.
- **Clutter cleanup:** the initial four overlapping checklist boxes and awkward connectors were saved and rendered. Public horizontal `layout` created a clear Draft → Review → Test → Ship row with 100-unit gaps. All 12 original element IDs survive; no element was deleted or recreated. Original node sizes, colors, seeds, label IDs, and binding membership survive. `boundElements` array order changed, with equivalent semantic membership. All three connector endpoint bindings remain reciprocal. Saved final revision 2 contains 12 elements. The layout was one-dimensional; this does not establish automatic cleanup quality on complex graphs.

## Attempts, receipts, and saved artifacts

All seven scene-changing commands succeeded on their first attempt: six `apply` batches and one `layout` batch. All receipts reported `applied:true`, `stage:read-back`; no command errors, uncertain outcomes, retries, or stale revision errors occurred. Creation used a fresh complete snapshot before each batch and explicit document/epoch/revision/request ID. Seven render and seven save calls succeeded, including both before fixtures. Saves reported `persisted:true`.

| Batch request ID  | Revision | Created entries | Final saved basename           |
| ----------------- | -------: | --------------: | ------------------------------ |
| `context-initial` |        1 |               9 | `notes-context.excalidraw`     |
| `flow-initial`    |        1 |              11 | `onboarding-flow.excalidraw`   |
| `mindmap-initial` |        1 |              14 | `project-plan.excalidraw`      |
| `sketch-fixture`  |        1 |               7 | `sketch-annotation.excalidraw` |
| `sketch-annotate` |        2 |               4 | `sketch-annotation.excalidraw` |
| `clutter-fixture` |        1 |               8 | `clutter-refined.excalidraw`   |
| `clutter-layout`  |        2 |               0 | `clutter-refined.excalidraw`   |

Before PNGs are `sketch-before.png` and `clutter-before.png`; their complete snapshots are preserved separately. Final snapshots are named after the final PNG basenames. `receipts.jsonl` captures command inputs and public response envelopes without endpoint credentials; `integrity.json` records complete snapshots, reciprocal bindings, and preservation checks. Actual local artifact paths are supplied separately to the parent rather than publishing workstation paths here.

The public `quit` command returned `{"closing":true}` after every drawing was saved. No subsequent command reopened or controlled the application.

## Consumer friction and limits

The core guide supplied enough information to build all five tasks without trial-and-error mutations. Direct style fields and `label.fontSize` are easy to copy from its example, while the full schema is lengthy enough to benefit from local filtering. Stable explicit IDs, create refs, complete snapshots, and render bounds made the process predictable. Public layout preserved connectors successfully in this modest cleanup.

A minor naming surprise: `new --title 'Local notes system context'` with an explicit filename returned the filename-derived title `notes-context`. The requested title was not retained as the drawing title. Content, saving, and rendering succeeded. No claim is made about freehand input, images, large graphs, complex elbow connectors, concurrent human edits, accessibility, recovery, or cross-platform behavior.
