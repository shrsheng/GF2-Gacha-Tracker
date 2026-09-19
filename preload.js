const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gf2API", {
  loadRecords: () => ipcRenderer.invoke("load-records"),
  listAccounts: () => ipcRenderer.invoke("list-accounts"),
  createAccount: (account) => ipcRenderer.invoke("create-account", account),
  updateActiveAccount: (account) => ipcRenderer.invoke("update-active-account", account),
  updateAccount: (accountId, account) => ipcRenderer.invoke("update-account", accountId, account),
  deleteAccount: (accountId) => ipcRenderer.invoke("delete-account", accountId),
  switchAccount: (accountId) => ipcRenderer.invoke("switch-account", accountId),
  loadSignatureMap: () => ipcRenderer.invoke("load-signature-map"),
  loadItemMap: () => ipcRenderer.invoke("load-item-map"),
  loadCharacterArtMap: () => ipcRenderer.invoke("load-character-art-map"),
  loadWeaponArtMap: () => ipcRenderer.invoke("load-weapon-art-map"),
  loadOutfitPoolMap: () => ipcRenderer.invoke("load-outfit-pool-map"),
  saveRecords: (records) => ipcRenderer.invoke("save-records", records),
  exportRecords: () => ipcRenderer.invoke("export-records"),
  importRecords: () => ipcRenderer.invoke("import-records"),
  backupRecordsBeforeImport: () => ipcRenderer.invoke("backup-records-before-import"),
  syncPool: (params) => ipcRenderer.invoke("sync-pool", params),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  updateItemMap: () => ipcRenderer.invoke("update-item-map"),
  checkAppUpdate: () => ipcRenderer.invoke("check-app-update"),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  exportManualTemplate: () => ipcRenderer.invoke("export-manual-template"),
  importManualRecords: () => ipcRenderer.invoke("import-manual-records")
});
