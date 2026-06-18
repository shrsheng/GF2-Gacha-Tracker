const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let dataDir;
let dataFile;
let configFile;
const itemMapFile = path.join(__dirname, "itemMap.json");

function initDataPaths() {
  dataDir = path.join(app.getPath("userData"), "data");
  dataFile = path.join(dataDir, "gacha.json");
  configFile = path.join(dataDir, "config.json");

  
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
  if (!fs.existsSync(itemMapFile)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(itemMapFile, "utf-8"));
}

function loadConfig() {
  ensureDataFile();

  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ gachaUrl: "",  accessToken: "" }, null, 2),
      "utf-8"
    );
  }

  return JSON.parse(fs.readFileSync(configFile, "utf-8"));
}

function saveConfig(config) {
  ensureDataFile();

  fs.writeFileSync(
    configFile,
    JSON.stringify(config, null, 2),
    "utf-8"
  );
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
    7: "自選武器"
  };

  return {
    pageOrder: remote.pageOrder,
    pageIndex: remote.pageIndex,
    nextKey: remote.nextKey,

    id: `${poolType}_${remote.pool_id}_${itemId}_${timestamp}_${remote.drawIndex ?? 0}`,
    drawIndex: remote.drawIndex ?? 0,

    itemId,
    poolId: remote.pool_id,
    time: formatTime(timestamp),
    source: sourceMap[poolType] || `卡池${poolType}`,
    type: itemInfo?.type || "未知",
    name: itemInfo?.name || `未知道具(${itemId})`,
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

ipcMain.handle("load-records", () => {
  ensureDataFile();

  const raw = fs.readFileSync(dataFile, "utf-8");
  return JSON.parse(raw).records;
});

ipcMain.handle("save-records", (event, records) => {
  ensureDataFile();

  fs.writeFileSync(
    dataFile,
    JSON.stringify({ version: 1, records }, null, 2),
    "utf-8"
  );

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

  const raw = fs.readFileSync(dataFile, "utf-8");
  fs.writeFileSync(result.filePath, raw, "utf-8");

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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  initDataPaths();
  ensureDataFile();

  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});