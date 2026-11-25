// Test-only native host: no production app or user profile is reused.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setName("Embedded viewer test host");
app.setPath("userData", path.join(process.argv[2], "profile"));
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.whenReady().then(() => {
  new BrowserWindow({
    show: false,
    width: 780,
    height: 790,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  }).loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
