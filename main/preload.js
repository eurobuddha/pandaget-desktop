/*
 * preload.js — the only bridge to main. contextIsolation is on; the renderer gets a tiny,
 * safe surface: platform, catalog fetch, download+verify+reveal, reveal/open a saved file,
 * open an https link. No node, no fs, no network reach in the renderer.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pandaget", {
  platform: () => ipcRenderer.invoke("pg:platform"),
  appVersion: () => ipcRenderer.invoke("pg:appVersion"),
  catalog: () => ipcRenderer.invoke("pg:catalog"),
  download: (row) => ipcRenderer.invoke("pg:download", row),
  reveal: (path) => ipcRenderer.invoke("pg:reveal", path),
  open: (path) => ipcRenderer.invoke("pg:open", path),
  openExternal: (url) => ipcRenderer.invoke("pg:openExternal", url),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("pg:progress", handler);
    return () => ipcRenderer.removeListener("pg:progress", handler);
  }
});
