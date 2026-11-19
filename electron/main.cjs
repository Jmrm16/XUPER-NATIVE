const { app, BrowserWindow } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

let mainWindow = null;

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0a0a0f",
    autoHideMenuBar: true,
    title: "Xuper TV",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    process.env.XUPER_DATA_DIR = app.getPath("userData");
    process.env.XUPER_AUTO_START = "0";

    const serverUrl = pathToFileURL(path.resolve(__dirname, "..", "server.mjs")).href;
    const { startLocalServer } = await import(serverUrl);
    const port = await startLocalServer(8910, "127.0.0.1");
    await createWindow(port);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
