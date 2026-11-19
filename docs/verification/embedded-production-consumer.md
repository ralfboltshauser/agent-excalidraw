# Installed MCP consumer test: embedded canvas

Tested 2026-11-19, completed at 20:44 UTC, from a T3 Code conversation through the Codex harness. Server: `agent-excalidraw-preview`. App version reported by status: `0.2.0`, protocol `1`.

## Scope and method

Used the installed server's actual MCP tools and public MCP resource discovery. Read the installed agent-excalidraw skill. Did not inspect repository implementation, use a replacement HTML/CLI viewer, change configuration, install anything, spawn agents, edit the drawing, or save it. No browser or desktop clicks were performed; visual UI verification is left to the parent.

## Results

1. Tool discovery succeeded. `status`, `snapshot`, and `show_canvas` were available. The `show_canvas` description clearly requires a document and epoch from open/snapshot and describes a live read-only mirror.
2. `status({})` succeeded and identified the already active requested drawing, so opening it again was unnecessary:
   - Path: `/private/tmp/aev-live-4fy7qt2r/Embedded canvas.excalidraw`
   - Document: `01371369-595e-44a1-9f8e-455612028a41`
   - Epoch: `f7ea7e89-6b46-40c2-bdb9-c14c22be3293`
   - Revision: `1`; dirty: `true`; autosave: `false`; saving: `false`; error: `null`.
3. `snapshot({document, epoch})` succeeded with `ok:true`, `isError:false`, `total:7`, `complete:true`, and `nextOffset:null`. The semantic scene contains two rectangles labelled “You draw” and “Your agent edits”, an arrow labelled “One canvas”, and the text “Live in your coding agent. Saved on your Mac.” Selection is empty and interaction is idle. This is semantic inspection, not visual review.
4. Called the actual `show_canvas` tool with exactly:

   ```json
   {"document":"01371369-595e-44a1-9f8e-455612028a41","epoch":"f7ea7e89-6b46-40c2-bdb9-c14c22be3293"}
   ```

   The call returned `isError:false` and one text content block:

   > Opened a read-only canvas mirror. Human and agent edits remain in the desktop document; Save remains explicit.

   No image, embedded resource content block, structured content, or result `_meta` was exposed in the returned result visible to this agent. This does not establish whether tool-level UI metadata was available to the host.
5. `resources/list` succeeded and advertised one resource: `ui://agent-excalidraw/viewer-v1.html`, name `Canvas viewer`, MIME type `text/html;profile=mcp-app`. `resources/read` for that URI succeeded and returned HTML titled `Drawing preview` with inline styling/script content. Resource availability is confirmed; capture of that HTML is **not evidence of inline rendering**.
6. A final explicit `status({document, epoch})` succeeded. The active path, document, epoch, revision `1`, dirty `true`, and autosave `false` were unchanged. No edit/save/mutation tool was invoked.

## Discoverability and UX findings

- Positive: `show_canvas` was discoverable by name and its description supplied the prerequisite and read-only intent. Status plus snapshot supplied the required stable identifiers without opening or mutating the drawing.
- Discovery rough edge: `resources/templates/list` returned `Mcp error: -32601: Method not found`. Static resource discovery still worked. No separate guide resource was advertised in the resource list.
- Verification gap: the tool reports “Opened” but the agent-visible result contains only text. I did not observe an inline canvas in this conversation. Consequently embedded rendering, live updates, controls, sizing, and read-only interaction are **unverified**, rather than passed or definitively failed. A host screenshot or parent UI observation is needed to distinguish successful display from a missing renderer.

## Parent follow-up

Inspect the `show_canvas` tool card in this same conversation and confirm whether the embedded canvas is visible with the snapshot's labels. Actual UI clicks may be performed by the parent. Do not infer an inline-rendering pass from the successful resource read or the “Opened” message alone.
