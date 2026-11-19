import { app, BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
app.whenReady().then(async () => {
  const svg = await readFile("assets/icon.svg", "utf8");
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        "<style>body{margin:0;background:transparent}</style>" + svg,
      ),
  );
  await writeFile(
    "assets/icon.png",
    (await window.webContents.capturePage()).toPNG(),
  );
  window.destroy();
  app.quit();
});
