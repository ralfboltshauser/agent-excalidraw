# E0: actual T3 MCP App consumer probe

Observed 2026-11-19 in this T3 installation, Codex provider.

## Outcome

Actual tool discovery and invocation passed. Resource retrieval and T3 MCP App attachment capture passed. Visual inline rendering and app-to-host interaction remain unverified pending the parent's manual check. E0 is therefore only partially verified, not an end-to-end pass.

## Evidence

- Discovery exposed `mcp__agent_excalidraw_e0__show_probe` with an empty-object input. `read_counter` did not appear in the model-visible discovery results and was never called by this agent.
- Called `show_probe({})` exactly once through the discovered MCP tool, not through a CLI or direct server client. The model-facing result was `Synthetic bridge probe.` with no reported tool error.
- Reading this actual result thread's activity showed the completed dynamic tool `agent-excalidraw-e0.show_probe`, input `{}`, and T3's captured output:

```json
{
  "t3McpApp": {
    "attachmentId": "thread-delegated-task-command-3amcp-3a8f82272b-4722-497f-980f-943f86bdcf61-3adel-187bb29e-9a98-4bb9-949f-e464ed1335d3-html",
    "server": "agent-excalidraw-e0",
    "tool": "show_probe",
    "resourceUri": "ui://agent-excalidraw/e0-probe.html"
  },
  "result": {
    "_meta": { "probe": "ready" },
    "content": [{ "type": "text", "text": "Synthetic bridge probe." }],
    "structuredContent": null
  }
}
```

- The permitted synthetic trace `/tmp/ae-e0-probe-events.jsonl` contained:

```jsonl
{"time":1795119097759,"event":"initialized","capabilities":{"experimental":{"codex/auth-change":{}},"elicitation":{"form":{},"url":{}},"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}
{"time":1795119109142,"event":"tool","name":"show_probe"}
{"time":1795119109149,"event":"resource"}
```

This proves the connected client advertised the MCP Apps UI extension and MIME type, and that the server logged a resource fetch seven milliseconds after the tool call. The trace does not provide client name/version or the resource response MIME; those were not independently established.

## Exact limitations and manual handoff

The recorded `t3McpApp` attachment establishes capture for this actual tool result; it does not by itself establish that the frontend painted the inline app, initialized its bridge, or successfully executed an app-only call. No visual inspection or click was performed by this agent. No `read_counter` event was present in the trace read above. The parent should open the result thread, verify the inline app is visible, and manually click its UI once; app-only invocation and the resulting counter behavior require that separate observation.

No configuration changes, restarts, Claude invocations, spawned agents, HTML preview substitutes, or direct-server calls were used. The only written artifact is this report.

Actual result thread: [Exercise actual T3 MCP App probe](t3-thread://v2/b12ff0cd-ed1c-4337-b01a-ce1110d7bab6/thread:delegated-task:command%3Amcp%3A8f82272b-4722-497f-980f-943f86bdcf61%3Adelegate-task%3A0dace1a9-8bac-4afd-bcd5-ab71c98d4ff2)

## Parent native UI verification

The parent opened the actual tool result in T3 through native computer use. The captured App displayed `Bridge connected`. Clicking its real Read counter button changed the output to `Read succeeded: 1795119191`, with no write approval prompt. The synthetic server trace independently records `read_counter`. This completes the tool → resource → iframe initialization → App-only tool → visible reply journey for this installed T3/Codex lane. No direct-client or HTML-render replacement was used for that proof.

The screenshot was inspected. The synthetic probe used a dark foreground on the dark host because it handled only later host-context changes. Production UI must apply initial context too; that correction is part of the next milestone. The unrelated unsent draft remained preserved.

Other hosts, full screen and provider-stop/restart remain unrun at E0. E0 establishes the primary integration path, not all-host support.
