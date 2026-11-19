document.documentElement.dataset.theme =
  window.agentExcalidraw.initialTheme || "light";
document.documentElement.style.colorScheme =
  window.agentExcalidraw.initialTheme || "light";
// The host owns document persistence. Use the editor's supported file-input
// adapter consistently for image/shape imports before loading the SDK.
for (const name of [
  "showOpenFilePicker",
  "showSaveFilePicker",
  "showDirectoryPicker",
]) {
  delete (window as any)[name];
}
window.EXCALIDRAW_ASSET_PATH = new URL("./", location.href).href;
void import("./main");
