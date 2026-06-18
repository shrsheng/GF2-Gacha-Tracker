const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gf2API", {
  loadRecords: () => ipcRenderer.invoke("load-records"),
  saveRecords: (records) => ipcRenderer.invoke("save-records", records),
  exportRecords: () => ipcRenderer.invoke("export-records"),
  importRecords: () => ipcRenderer.invoke("import-records"),
  syncPool: (params) => ipcRenderer.invoke("sync-pool", params),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  updateItemMap: () => ipcRenderer.invoke("update-item-map")
});