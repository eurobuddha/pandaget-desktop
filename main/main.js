/*
 * main.js — Electron main process for PandaGet Desktop.
 *
 * A download-only store for the family's DESKTOP apps. Owns the window and a tiny IPC surface:
 * fetch the catalog, report the platform, download+verify+reveal an installer, open external
 * links. It runs no node, bundles no runtime, and can install nothing — every "Download" ends
 * as a verified file revealed in the OS file manager for the user to install themselves.
 */
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { fetchCatalog } = require("./catalog");
const { downloadInstaller } = require("./download");

let win = null;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

/** Mac / Windows / Linux — matches the catalog's `source` field for desktop rows. */
function platformName() {
  return process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows" : "Linux";
}

// window.open policy: https to the OS browser, nothing else. `file:` is never handed to the OS.
function windowOpenHandler({ url }) {
  if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  return { action: "deny" };
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 640,
    minHeight: 560,
    backgroundColor: "#0E1116",          // PandaApps BG — no white flash on load
    title: "PandaGet",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.setWindowOpenHandler(windowOpenHandler);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// ---- IPC ----
ipcMain.handle("pg:platform", () => platformName());
ipcMain.handle("pg:catalog", async () => {
  try { return { ok: true, ...(await fetchCatalog()) }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});
ipcMain.handle("pg:download", async (_e, row) => {
  try {
    const savedPath = await downloadInstaller(row, u => send("pg:progress", u));
    return { ok: true, savedPath };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    send("pg:progress", { packageId: row && row.packageId, phase: "error", error: msg });
    return { ok: false, error: msg };
  }
});
ipcMain.handle("pg:reveal", (_e, p) => { if (p) shell.showItemInFolder(p); return true; });
ipcMain.handle("pg:open", (_e, p) => { if (p) return shell.openPath(p); return ""; });
ipcMain.handle("pg:openExternal", (_e, url) => {
  if (/^https:\/\//i.test(String(url || ""))) shell.openExternal(url).catch(() => {});
  return true;
});

app.whenReady().then(createWindow);
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
