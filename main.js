const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

let dataDir;
let dataFile;
let configFile;
let accountsFile;
const bundledItemMapFile = path.join(__dirname, "itemMap.json");
const bundledSignatureMapFile = path.join(__dirname, "signatureMap.json");
const bundledCharacterArtMapFile = path.join(__dirname, "characterArtMap.json");
const bundledWeaponArtMapFile = path.join(__dirname, "weaponArtMap.json");
const bundledOutfitPoolMapFile = path.join(__dirname, "outfitPoolMap.json");
let userItemMapFile;
let userSignatureMapFile;
let userCharacterArtMapFile;
let userWeaponArtMapFile;
let userOutfitPoolMapFile;
let dataUpdateStateFile;
let legacyMirrorInitialized = false;
const dataUpdateManifestUrl =
  "https://raw.githubusercontent.com/shrsheng/GF2-Gacha-Tracker/refs/heads/main/data-update-manifest.json";

function initDataPaths() {
  dataDir = path.join(app.getPath("userData"), "data");
  dataFile = path.join(dataDir, "gacha.json");
  configFile = path.join(dataDir, "config.json");
  accountsFile = path.join(dataDir, "accounts.json");
  userItemMapFile = path.join(dataDir, "itemMap.json");
  userSignatureMapFile = path.join(dataDir, "signatureMap.json");
  userCharacterArtMapFile = path.join(dataDir, "characterArtMap.json");
  userWeaponArtMapFile = path.join(dataDir, "weaponArtMap.json");
  userOutfitPoolMapFile = path.join(dataDir, "outfitPoolMap.json");
  dataUpdateStateFile = path.join(dataDir, "data-update-state.json");


}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(
      dataFile,
      JSON.stringify({ version: 1, records: [] }, null, 2),
      "utf-8"
    );
  }

  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ gachaUrl: "", accessToken: "" }, null, 2),
      "utf-8"
    );
  }

  ensureAccountStore();

  // 新版以 accounts.json 保存多帳號；同時鏡像目前帳號到舊格式，
  // 讓使用者若暫時退回舊版，仍可讀取最近使用帳號的紀錄與設定。
  if (!legacyMirrorInitialized) {
    const store = readJsonFile(accountsFile, { activeAccountId: "", accounts: [] });
    const account = Array.isArray(store.accounts)
      ? store.accounts.find(item => item.id === store.activeAccountId) || store.accounts[0]
      : null;
    writeLegacyCompatibilityFiles(account);
    legacyMirrorInitialized = true;
  }
}

function makeAccountKey(server, uid) {
  return `${String(server || "unknown").trim()}::${String(uid || "legacy").trim()}`;
}

function ensureAccountStore() {
  if (fs.existsSync(accountsFile)) return;
  const legacyData = readJsonFile(dataFile, { records: [] });
  const legacyConfig = readJsonFile(configFile, { gachaUrl: "", accessToken: "" });
  const account = {
    id: makeAccountKey("未設定", "legacy"),
    server: "未設定",
    uid: "legacy",
    name: "原有帳號",
    records: Array.isArray(legacyData.records) ? legacyData.records : [],
    config: legacyConfig || { gachaUrl: "", accessToken: "" },
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(accountsFile, JSON.stringify({ version: 1, activeAccountId: account.id, accounts: [account] }, null, 2), "utf-8");
}

function loadAccountStore() {
  ensureDataFile();
  const store = readJsonFile(accountsFile, { version: 1, activeAccountId: "", accounts: [] });
  if (!Array.isArray(store.accounts)) store.accounts = [];
  return store;
}

function saveAccountStore(store) {
  fs.writeFileSync(accountsFile, JSON.stringify(store, null, 2), "utf-8");
}

function writeLegacyCompatibilityFiles(account) {
  if (!account || !dataFile || !configFile) return;
  fs.writeFileSync(
    dataFile,
    JSON.stringify({ version: 1, records: Array.isArray(account.records) ? account.records : [] }, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    configFile,
    JSON.stringify(account.config || { gachaUrl: "", accessToken: "" }, null, 2),
    "utf-8"
  );
}

function saveAccountStoreAndMirror(store) {
  saveAccountStore(store);
  writeLegacyCompatibilityFiles(getActiveAccount(store));
}

function getActiveAccount(store = loadAccountStore()) {
  return store.accounts.find(account => account.id === store.activeAccountId) || store.accounts[0] || null;
}

const iconPath = path.join(__dirname, "assets", "icon.ico");


function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

function loadItemMap() {
  const bundledMap = fs.existsSync(bundledItemMapFile)
    ? JSON.parse(fs.readFileSync(bundledItemMapFile, "utf-8"))
    : {};
  const userMap = userItemMapFile && fs.existsSync(userItemMapFile)
    ? JSON.parse(fs.readFileSync(userItemMapFile, "utf-8"))
    : {};

  // 使用者資料夾可能留有舊版 itemMap。保留線上更新內容，同時補入新版程式
  // 隨附但舊表缺少的物件，避免升級後仍顯示「未知道具」。
  const hasManagedUpdate = dataUpdateStateFile && fs.existsSync(dataUpdateStateFile);
  return hasManagedUpdate
    ? { ...bundledMap, ...userMap }
    : { ...userMap, ...bundledMap };
}

function readJsonFile(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function mergeDataMap(bundledFile, userFile, nestedKeys = []) {
  const bundled = readJsonFile(bundledFile, {});
  const user = readJsonFile(userFile, {});
  const merged = { ...bundled, ...user };
  nestedKeys.forEach(key => {
    merged[key] = { ...(bundled[key] || {}), ...(user[key] || {}) };
  });
  return merged;
}

function resolveDownloadedAsset(assetPath) {
  if (typeof assetPath !== "string" || !assetPath.startsWith("../assets/")) return assetPath;
  const relativePath = assetPath.slice("../assets/".length);
  const downloadedPath = path.join(dataDir, "assets", relativePath);
  return fs.existsSync(downloadedPath) ? pathToFileURL(downloadedPath).href : assetPath;
}

function resolveMapAssetPaths(value) {
  if (Array.isArray(value)) return value.map(resolveMapAssetPaths);
  if (!value || typeof value !== "object") return resolveDownloadedAsset(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, resolveMapAssetPaths(child)])
  );
}

function validateUpdatePath(relativePath) {
  const original = String(relativePath || "");
  const normalized = path.posix.normalize(original);
  if (!normalized || original.includes("\\") || original.includes(":") ||
      normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`更新清單包含不安全路徑：${relativePath}`);
  }
  if (!/\.(json|png|webp|jpe?g)$/i.test(normalized)) {
    throw new Error(`不支援的更新檔案格式：${relativePath}`);
  }
  return normalized;
}

async function downloadDataManifest() {
  const response = await fetch(dataUpdateManifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`下載更新清單失敗（HTTP ${response.status}）`);
  const manifest = await response.json();
  if (!manifest || !Array.isArray(manifest.files)) throw new Error("更新清單格式錯誤");
  return manifest;
}

function loadConfig() {
  const account = getActiveAccount();
  return account?.config || { gachaUrl: "", accessToken: "" };
}

function saveConfig(config) {
  const store = loadAccountStore();
  const account = getActiveAccount(store);
  if (!account) throw new Error("尚未建立帳號");
  account.config = config;
  saveAccountStoreAndMirror(store);
}

function formatTime(timestamp) {
  const time = new Date(timestamp * 1000);

  return (
    time.getFullYear() + "-" +
    String(time.getMonth() + 1).padStart(2, "0") + "-" +
    String(time.getDate()).padStart(2, "0") + " " +
    String(time.getHours()).padStart(2, "0") + ":" +
    String(time.getMinutes()).padStart(2, "0") + ":" +
    String(time.getSeconds()).padStart(2, "0")
  );
}

function normalizeRemoteRecord(remote, poolType) {
  const itemMap = loadItemMap();

  const itemId = String(remote.item_id || remote.item);
  const timestamp = remote.gacha_timestamp || remote.time;
  const itemInfo = itemMap[itemId];

  const sourceMap = {
    1: "常規採購",
    2: "卡池2",
    3: "定向採購",
    4: "軍備提升",
    5: "新手採購",
    6: "自選人形",
    7: "自選武器",
    8: "神秘箱",
    9: "新裝採購"
  };

  const itemName = itemInfo?.name || `未知道具(${itemId})`;
  let itemType = itemInfo?.type || "未知";
  if (poolType === 8) itemType = "神秘箱獎勵";
  if (poolType === 9) {
    if (itemName.startsWith("衣裝·")) itemType = "服裝";
    else if (itemName.startsWith("塗裝·")) itemType = "塗裝";
    else itemType = "服裝池獎勵";
  }

  return {
    pageOrder: remote.pageOrder,
    pageIndex: remote.pageIndex,
    nextKey: remote.nextKey,

    id: `${poolType}_${remote.pool_id}_${itemId}_${timestamp}_${remote.drawIndex ?? 0}`,
    drawIndex: remote.drawIndex ?? 0,

    itemId,
    poolId: remote.pool_id,
    poolType,
    itemNum: Number(remote.item_num ?? 1),
    time: formatTime(timestamp),
    source: sourceMap[poolType] || `卡池${poolType}`,
    type: itemType,
    name: itemName,
    rarity: itemInfo?.rarity || "未知"
  };
}

ipcMain.handle("load-config", () => {
  return loadConfig();
});

ipcMain.handle("save-config", (event, config) => {
  saveConfig(config);
  return true;
});

ipcMain.handle("update-item-map", async () => {
  ensureDataFile();
  const manifest = await downloadDataManifest();
  const baseUrl = String(manifest.baseUrl || new URL(".", dataUpdateManifestUrl).href);
  const pendingFiles = [];
  let totalBytes = 0;

  for (const file of manifest.files) {
    const relativePath = validateUpdatePath(file.path);
    const fileUrl = file.url || new URL(relativePath, baseUrl).href;
    const response = await fetch(fileUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`下載 ${relativePath} 失敗（HTTP ${response.status}）`);
    const buffer = Buffer.from(await response.arrayBuffer());
    totalBytes += buffer.length;
    if (buffer.length > 50 * 1024 * 1024 || totalBytes > 200 * 1024 * 1024) {
      throw new Error("資料更新檔案超過安全大小限制");
    }

    if (relativePath.endsWith(".json")) JSON.parse(buffer.toString("utf-8"));
    if (file.sha256) {
      const digest = crypto.createHash("sha256").update(buffer).digest("hex");
      if (digest.toLowerCase() !== String(file.sha256).toLowerCase()) {
        throw new Error(`${relativePath} 校驗失敗`);
      }
    }
    pendingFiles.push({ relativePath, buffer });
  }

  // 全部下載與驗證成功後才寫入，避免網路中斷留下半套資料。
  pendingFiles.forEach(({ relativePath, buffer }) => {
    const destination = path.join(dataDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
  });
  fs.writeFileSync(dataUpdateStateFile, JSON.stringify({
    version: manifest.version || "unknown",
    updatedAt: new Date().toISOString(),
    files: pendingFiles.map(file => file.relativePath)
  }, null, 2), "utf-8");

  const itemMap = loadItemMap();
  return {
    version: manifest.version || "unknown",
    count: Object.keys(itemMap).length,
    fileCount: pendingFiles.length,
    imageCount: pendingFiles.filter(file => /\.(png|webp|jpe?g)$/i.test(file.relativePath)).length
  };
});

ipcMain.handle("load-records", () => {
  const account = getActiveAccount();
  return Array.isArray(account?.records) ? account.records : [];
});

ipcMain.handle("list-accounts", () => {
  const store = loadAccountStore();
  return {
    activeAccountId: store.activeAccountId,
    accounts: store.accounts.map(account => ({
      id: account.id,
      server: account.server,
      uid: account.uid,
      name: account.name,
      recordCount: Array.isArray(account.records) ? account.records.length : 0
    }))
  };
});

ipcMain.handle("create-account", (event, input) => {
  const server = String(input?.server || "").trim();
  const uid = String(input?.uid || "").trim();
  const name = String(input?.name || "").trim() || uid;
  if (!server || !uid) throw new Error("伺服器與 UID 為必填");
  if (server.length > 30 || uid.length > 40 || name.length > 40) throw new Error("帳號資料過長");

  const store = loadAccountStore();
  const id = makeAccountKey(server, uid);
  if (store.accounts.some(account => account.id === id)) throw new Error("此伺服器與 UID 已存在");
  store.accounts.push({ id, server, uid, name, records: [], config: { gachaUrl: "", accessToken: "" }, createdAt: new Date().toISOString() });
  store.activeAccountId = id;
  saveAccountStoreAndMirror(store);
  return id;
});

ipcMain.handle("update-active-account", (event, input) => {
  const server = String(input?.server || "").trim();
  const uid = String(input?.uid || "").trim();
  const name = String(input?.name || "").trim() || uid;
  if (!server || !uid) throw new Error("伺服器與 UID 為必填");
  if (server.length > 30 || uid.length > 40 || name.length > 40) throw new Error("帳號資料過長");

  const store = loadAccountStore();
  const account = getActiveAccount(store);
  if (!account) throw new Error("尚未建立帳號");
  const nextId = makeAccountKey(server, uid);
  if (store.accounts.some(item => item !== account && item.id === nextId)) throw new Error("此伺服器與 UID 已存在");
  account.id = nextId;
  account.server = server;
  account.uid = uid;
  account.name = name;
  store.activeAccountId = nextId;
  saveAccountStoreAndMirror(store);
  return nextId;
});

ipcMain.handle("update-account", (event, accountId, input) => {
  const server = String(input?.server || "").trim();
  const uid = String(input?.uid || "").trim();
  const name = String(input?.name || "").trim() || uid;
  if (!server || !uid) throw new Error("伺服器與 UID 為必填");
  if (server.length > 30 || uid.length > 40 || name.length > 40) throw new Error("帳號資料過長");

  const store = loadAccountStore();
  const account = store.accounts.find(item => item.id === accountId);
  if (!account) throw new Error("找不到指定帳號");
  const nextId = makeAccountKey(server, uid);
  if (store.accounts.some(item => item !== account && item.id === nextId)) throw new Error("此伺服器與 UID 已存在");
  const wasActive = store.activeAccountId === account.id;
  account.id = nextId;
  account.server = server;
  account.uid = uid;
  account.name = name;
  if (wasActive) store.activeAccountId = nextId;
  saveAccountStoreAndMirror(store);
  return nextId;
});

ipcMain.handle("delete-account", (event, accountId) => {
  const store = loadAccountStore();
  if (store.accounts.length <= 1) throw new Error("至少需要保留一個帳號");
  const index = store.accounts.findIndex(account => account.id === accountId);
  if (index < 0) throw new Error("找不到指定帳號");
  const wasActive = store.activeAccountId === accountId;
  store.accounts.splice(index, 1);
  if (wasActive) store.activeAccountId = store.accounts[0].id;
  saveAccountStoreAndMirror(store);
  return { activeAccountId: store.activeAccountId, activeChanged: wasActive };
});

ipcMain.handle("switch-account", (event, accountId) => {
  const store = loadAccountStore();
  if (!store.accounts.some(account => account.id === accountId)) throw new Error("找不到指定帳號");
  store.activeAccountId = accountId;
  saveAccountStoreAndMirror(store);
  return true;
});

ipcMain.handle("load-signature-map", () => {
  return mergeDataMap(bundledSignatureMapFile, userSignatureMapFile);
});

ipcMain.handle("load-item-map", () => loadItemMap());

ipcMain.handle("load-character-art-map", () => {
  return resolveMapAssetPaths(mergeDataMap(
    bundledCharacterArtMapFile,
    userCharacterArtMapFile,
    ["roles", "wallpapers"]
  ));
});

ipcMain.handle("load-weapon-art-map", () => {
  return resolveMapAssetPaths(mergeDataMap(
    bundledWeaponArtMapFile,
    userWeaponArtMapFile,
    ["weapons"]
  ));
});

ipcMain.handle("load-outfit-pool-map", () => {
  return resolveMapAssetPaths(mergeDataMap(
    bundledOutfitPoolMapFile,
    userOutfitPoolMapFile,
    ["pools"]
  ));
});

ipcMain.handle("save-records", (event, records) => {
  const store = loadAccountStore();
  const account = getActiveAccount(store);
  if (!account) throw new Error("尚未建立帳號");
  account.records = Array.isArray(records) ? records : [];
  saveAccountStoreAndMirror(store);

  return true;
});

ipcMain.handle("export-records", async () => {
  ensureDataFile();

  const result = await dialog.showSaveDialog({
    title: "匯出抽卡紀錄",
    defaultPath: "gf2-gacha-backup.json",
    filters: [
      { name: "JSON 檔案", extensions: ["json"] }
    ]
  });

  if (result.canceled) {
    return false;
  }

  const account = getActiveAccount();
  fs.writeFileSync(result.filePath, JSON.stringify({ version: 2, account: { server: account.server, uid: account.uid, name: account.name }, records: account.records || [] }, null, 2), "utf-8");

  return true;
});

ipcMain.handle("sync-pool", async (event, params) => {
  const { gachaUrl, accessToken, poolType } = params;

  let next = "";
  let pageOrder = 0;
  const allRecords = [];


  while (true) {
    const body = new URLSearchParams();
    body.set("type_id", String(poolType));

    if (next) {
      body.set("next", next);
    }

    const response = await fetch(gachaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": accessToken
      },
      body: body.toString()
    });

    const json = await response.json();

    if (json.code !== 0) {
      throw new Error(`${json.message} (Code ${json.code})`);
    }

    const data = json.data;

    const recordList =
      data.list ||
      data.record_list ||
      data.RecordList ||
      [];






    recordList.forEach((record, index) => {
      allRecords.push({
        ...record,
        pageOrder,
        pageIndex: index,
        nextKey: next || "first"
      });
    });

    pageOrder++;

    next = data.next || data.Next || "";

    if (!next) {
      break;
    }
  }



  const duplicateCounter = new Map();

  const normalized = allRecords.map(record => {
    const itemId = String(record.item_id || record.item);
    const timestamp = record.gacha_timestamp || record.time;
    const poolId = record.pool_id;

    const baseKey = `${poolType}_${poolId}_${itemId}_${timestamp}`;
    const drawIndex = duplicateCounter.get(baseKey) || 0;

    duplicateCounter.set(baseKey, drawIndex + 1);

    return normalizeRemoteRecord(
      {
        ...record,
        drawIndex
      },
      poolType
    );
  });


  return {
    poolType,
    count: normalized.length,
    records: normalized
  };
});

ipcMain.handle("check-app-update", async () => {
  const currentVersion = app.getVersion();

  const response = await fetch(
    "https://api.github.com/repos/shrsheng/GF2-Gacha-Tracker/releases/latest",
    {
      headers: {
        "User-Agent": "GF2-Gacha-Tracker"
      }
    }
  );

  if (!response.ok) {
    throw new Error("Failed to check latest release");
  }

  const release = await response.json();

  const latestVersion = String(release.tag_name || "")
    .replace(/^v/i, "")
    .trim();

  return {
    currentVersion,
    latestVersion,
    releaseName: release.name || release.tag_name,
    releaseUrl: release.html_url,
    hasUpdate: isNewerVersion(latestVersion, currentVersion)
  };
});

ipcMain.handle("open-external-url", async (event, url) => {
  await shell.openExternal(url);
  return true;
});

function isNewerVersion(latest, current) {
  const latestParts = latest.split(".").map(Number);
  const currentParts = current.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const latestNum = latestParts[i] || 0;
    const currentNum = currentParts[i] || 0;

    if (latestNum > currentNum) return true;
    if (latestNum < currentNum) return false;
  }

  return false;
}

ipcMain.handle("import-records", async () => {
  const result = await dialog.showOpenDialog({
    title: "匯入抽卡紀錄 JSON",
    filters: [
      { name: "JSON 檔案", extensions: ["json"] }
    ],
    properties: ["openFile"]
  });

  if (result.canceled) {
    return null;
  }

  const filePath = result.filePaths[0];
  const raw = fs.readFileSync(filePath, "utf-8");

  return JSON.parse(raw);
});

ipcMain.handle("backup-records-before-import", () => {
  ensureDataFile();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    app.getPath("userData"),
    `records-before-import-${stamp}.json`
  );

  fs.copyFileSync(accountsFile, backupPath);
  return backupPath;
});

ipcMain.handle("export-manual-template", async () => {
  const result = await dialog.showSaveDialog({
    title: "下載手動紀錄模板",
    defaultPath: "gf2-manual-import-template.json",
    filters: [{ name: "JSON 檔案", extensions: ["json"] }]
  });

  if (result.canceled) {
    return false;
  }

  const template = [
    {
      time: "2025-01-01 12:00:00",
      source: "定向採購",
      type: "人形",
      name: "維普蕾",
      rarity: "橙色",
      pullCount: 65
    },
    {
      time: "2025-01-02 12:00:00",
      source: "定向採購",
      type: "人形",
      name: "M200",
      rarity: "橙色",
      pullCount: 70
    }
  ];

  fs.writeFileSync(
    result.filePath,
    JSON.stringify(template, null, 2),
    "utf-8"
  );

  return true;
});

ipcMain.handle("import-manual-records", async () => {
  const result = await dialog.showOpenDialog({
    title: "匯入手動抽卡紀錄 JSON",
    filters: [{ name: "JSON 檔案", extensions: ["json"] }],
    properties: ["openFile"]
  });

  if (result.canceled) {
    return null;
  }

  const filePath = result.filePaths[0];
  const raw = fs.readFileSync(filePath, "utf-8");

  return JSON.parse(raw);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  initDataPaths();
  ensureDataFile();

  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
