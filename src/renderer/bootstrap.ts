// The host owns document persistence. Chromium's File System Access picker is
// exposed on our secure app: origin but cannot reliably service native dialogs.
// Force the editor's supported input-file fallback for image/shape imports.
for (const name of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker']) {
  delete (window as any)[name];
}
window.EXCALIDRAW_ASSET_PATH=new URL('./',location.href).href;
void import('./main');
