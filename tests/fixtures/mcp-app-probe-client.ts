import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
const app = new App({
  name: "Agent Excalidraw bridge probe",
  version: "1.0.0",
});
const output = document.querySelector<HTMLOutputElement>("output")!;
let stopped = false;
app.ontoolresult = (result) => {
  output.textContent =
    result._meta?.probe === "ready" ? "Bridge connected" : "Awaiting binding";
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables)
    applyHostStyleVariables(context.styles.variables);
};
app.onteardown = async () => {
  stopped = true;
  return {};
};
document.querySelector("button")!.addEventListener("click", async () => {
  if (stopped) return;
  try {
    const r = await app.callServerTool({ name: "read_counter", arguments: {} });
    output.textContent = `Read succeeded: ${r.structuredContent?.seconds}`;
  } catch {
    output.textContent = "Read unavailable";
  }
});
await app.connect();
