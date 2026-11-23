let records = [];
let externalAcquisitions = [];
let itemMap = {};
let signatureMap = {};
let characterArtMap = { roles: {}, wallpapers: {} };
let weaponArtMap = { weapons: {} };
let outfitPoolMap = { pools: {} };
let poolMap = { pools: [] };
let currentRecordPage = 1;
let currentPoolFilter = "全部";
let currentRarityFilter = "全部";
let currentRecordSearch = "";
let pendingRecordFocusId = null;
let editingAccountId = null;
const recordsPerPage = 6;
const ANALYSIS_PREF_KEY = "gf2.recruitmentAnalysis.preferences";
const recruitmentAnalysisState = {
  category: "limited",
  poolName: "定向採購",
  historyView: "portrait",
  eliteFilter: "all",
  distributionView: "elite",
  advancedExpanded: false,
  selectedEventId: null,
  selectedPeriodKey: null
};
const recruitmentPoolGroups = {
  limited: ["定向採購", "軍備提升"],
  standard: ["常規採購", "新手採購"],
  selected: ["自選人形", "自選武器"],
  special: ["新裝採購", "神秘箱"]
};

const permanentTargetCharacters = [
  "維普蕾",
  "佩里緹亞",
  "托洛洛",
  "瓊玖",
  "塞布麗娜",
  "莫辛納甘",
  "緋",
  "哈卜茜"
];

const permanentWeaponNames = [
  "斯摩希克",
  "獵心者",
  "光學幻境",
  "游星",
  "金石奏",
  "梅扎露娜",
  "赫斯提亞",
  "二律背反"
];

function sortByGameOrder(recordsToSort, direction = "oldToNew") {
  return [...recordsToSort].sort((a, b) => {
    const timeDiff =
      direction === "oldToNew"
        ? new Date(a.time) - new Date(b.time)
        : new Date(b.time) - new Date(a.time);

    if (timeDiff !== 0) return timeDiff;

    const pageOrderDiff =
      direction === "oldToNew"
        ? (b.pageOrder ?? 0) - (a.pageOrder ?? 0)
        : (a.pageOrder ?? 0) - (b.pageOrder ?? 0);

    if (pageOrderDiff !== 0) return pageOrderDiff;

    // 關鍵：
    // 顯示 newToOld：pageIndex 由小到大
    // 計算 oldToNew：必須反過來，pageIndex 由大到小
    return direction === "oldToNew"
      ? (b.pageIndex ?? 0) - (a.pageIndex ?? 0)
      : (a.pageIndex ?? 0) - (b.pageIndex ?? 0);
  });
}

function getGameRecords(poolName = null, direction = "oldToNew") {
  let list = records;

  if (poolName) {
    list = records.filter(record => record.source === poolName);
  }

  return sortByGameOrder(list, direction);
}

function getExternalAcquisitionCount(name, itemType = "character") {
  return externalAcquisitions
    .filter(entry => entry.itemType === itemType && entry.itemName === name)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity) || 0), 0);
}

function sortRecordsByTime() {
  records = sortByGameOrder(records, "oldToNew");
}

function isOffRateRecord(record) {
  if (record.rarity !== "橙色") return false;

  if (record.source === "定向採購" || record.source === "自選人形") {
    return permanentTargetCharacters.includes(record.name);
  }

  if (record.source === "軍備提升" || record.source === "自選武器") {
    return permanentWeaponNames.includes(record.name);
  }

  return false;
}

function createRecordId(record) {
  if (record.id) {
    return record.id;
  }

  return [
    record.source,
    record.poolId || "",
    record.itemId || "",
    record.time,
    record.name,
    record.drawIndex ?? 0
  ].join("_");
}

const gfl2HelpPoolNames = {
  1: "常規採購",
  3: "定向採購",
  4: "軍備提升",
  5: "新手採購",
  6: "自選人形",
  7: "自選武器",
  8: "神秘箱",
  9: "新裝採購"
};

function formatImportedTimestamp(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function findGfl2HelpServers(payload) {
  const candidates = [];
  const visited = new Set();

  function walk(value, path = [], depth = 0) {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3 || visited.has(value)) return;
    visited.add(value);

    const poolEntries = Object.entries(value).filter(([key, list]) => {
      return /^\d+$/.test(key) && Array.isArray(list);
    });
    const recordCount = poolEntries.reduce((sum, [, list]) => sum + list.length, 0);

    if (poolEntries.length > 0 && recordCount > 0) {
      candidates.push({
        label: path.join(" / ") || "預設資料",
        pools: value,
        recordCount
      });
      return;
    }

    Object.entries(value).forEach(([key, child]) => walk(child, [...path, key], depth + 1));
  }

  walk(payload);
  return candidates;
}

function normalizeGfl2HelpImport(payload) {
  const servers = findGfl2HelpServers(payload);
  if (servers.length === 0) return null;

  let selected = servers[0];
  if (servers.length > 1) {
    const menu = servers.map((server, index) => `${index + 1}. ${server.label}（${server.recordCount} 筆）`).join("\n");
    const answer = prompt(`偵測到多組 gfl2help 資料，請輸入要匯入的編號：\n\n${menu}`, "1");
    if (answer === null) return { canceled: true };
    const selectedIndex = Number(answer) - 1;
    if (!Number.isInteger(selectedIndex) || !servers[selectedIndex]) {
      throw new Error("伺服器編號不正確，已取消匯入");
    }
    selected = servers[selectedIndex];
  }

  const duplicateCounter = new Map();
  const normalized = [];
  let unknownItems = 0;

  Object.entries(selected.pools).forEach(([poolTypeText, list]) => {
    if (!Array.isArray(list)) return;
    const poolType = Number(poolTypeText);
    const source = gfl2HelpPoolNames[poolType];
    if (!source) return;

    list.forEach((remote, pageIndex) => {
      const itemId = String(remote.item_id ?? remote.item ?? "");
      const timestamp = remote.gacha_timestamp ?? remote.time;
      const poolId = remote.pool_id;
      if (!itemId || !timestamp || poolId === undefined || poolId === null) return;

      const info = itemMap[itemId];
      if (!info) unknownItems++;
      const baseKey = `${poolType}_${poolId}_${itemId}_${timestamp}`;
      const drawIndex = duplicateCounter.get(baseKey) || 0;
      duplicateCounter.set(baseKey, drawIndex + 1);

      let type = info?.type || "未知";
      if (poolType === 8) type = "神秘箱獎勵";
      if (poolType === 9) {
        if (info?.name?.startsWith("衣裝·")) type = "服裝";
        else if (info?.name?.startsWith("塗裝·")) type = "塗裝";
        else type = "服裝池獎勵";
      }

      normalized.push({
        id: `${poolType}_${poolId}_${itemId}_${timestamp}_${drawIndex}`,
        drawIndex,
        pageOrder: 0,
        pageIndex,
        itemId,
        poolId,
        poolType,
        itemNum: Number(remote.item_num ?? 1),
        time: formatImportedTimestamp(timestamp),
        source,
        type,
        name: info?.name || `未知道具(${itemId})`,
        // gfl2help 的 type 8／9 quality 與遊戲物件表不完全一致，統一由本機表判斷。
        rarity: info?.rarity || "未知",
        importedFrom: "gfl2help"
      });
    });
  });

  return { records: normalized, server: selected.label, unknownItems };
}

function normalizeSpecialRecruitRecord(record) {
  const poolId = String(record.poolId ?? "");
  if (record.source === "服裝池" || record.source === "外觀補給") {
    record.source = poolId === "99001" ? "神秘箱" : "新裝採購";
  }
  if (Number(record.poolType) === 8) record.source = "神秘箱";
  if (Number(record.poolType) === 9) record.source = "新裝採購";
  if (record.itemNum === undefined || record.itemNum === null) record.itemNum = 1;
  return record;
}

function refreshRecordMetadata(record) {
  const info = itemMap[String(record.itemId ?? "")];
  if (!info || record.manual === true) return record;

  record.name = info.name || record.name;
  record.rarity = info.rarity || record.rarity;
  if (Number(record.poolType) !== 8 && Number(record.poolType) !== 9) {
    record.type = info.type || record.type;
  }
  return record;
}

function getDateOnly(timeText) {
  return String(timeText)
    .split(" ")[0]
    .replaceAll("/", "-");
}

function getEarliestApiRecordDate() {
  const apiRecords = records.filter(record => record.manual !== true);

  if (apiRecords.length === 0) {
    return null;
  }

  const sorted = [...apiRecords].sort((a, b) => {
    return new Date(a.time) - new Date(b.time);
  });

  return getDateOnly(sorted[0].time);
}

function checkManualRecord(record, index, earliestApiDate) {
  const requiredFields = ["time", "source", "type", "name", "rarity"];

  for (const field of requiredFields) {
    if (!record[field]) {
      return {
        valid: false,
        reason: "INVALID",
        message: `第 ${index + 1} 筆缺少欄位：${field}`
      };
    }
  }

  const manualTime = new Date(record.time).getTime();

  if (Number.isNaN(manualTime)) {
    return {
      valid: false,
      reason: "INVALID",
      message: `第 ${index + 1} 筆 time 格式錯誤：${record.time}`
    };
  }


  const validSources = [
    "定向採購",
    "軍備提升",
    "常規採購",
    "自選人形",
    "自選武器"
  ];
  const validTypes = ["人形", "角色", "武器"];
  const validRarities = ["橙色", "紫色", "藍色"];

  if (!validSources.includes(record.source)) {
    return {
      valid: false,
      reason: "INVALID",
      message: `第 ${index + 1} 筆 source 錯誤：${record.source}`
    };
  }

  if (!validTypes.includes(record.type)) {
    return {
      valid: false,
      reason: "INVALID",
      message: `第 ${index + 1} 筆 type 錯誤：${record.type}`
    };
  }

  if (!validRarities.includes(record.rarity)) {
    return {
      valid: false,
      reason: "INVALID",
      message: `第 ${index + 1} 筆 rarity 錯誤：${record.rarity}`
    };
  }

  const manualDate = getDateOnly(record.time);

  if (earliestApiDate && manualDate >= earliestApiDate) {
    return {
      valid: false,
      reason: "API_RANGE",
      message: `第 ${index + 1} 筆落在 API 同步資料範圍內：${record.time}`
    };
  }

  return {
    valid: true,
    manualTime
  };
}

function normalizeManualRecords(manualRecords) {
  const earliestApiDate = getEarliestApiRecordDate();

  const validRecords = [];
  const skippedApiRange = [];
  const skippedInvalid = [];

  manualRecords.forEach((record, index) => {
    const checkResult = checkManualRecord(record, index, earliestApiDate);

    if (!checkResult.valid) {
      if (checkResult.reason === "API_RANGE") {
        skippedApiRange.push({
          index: index + 1,
          record,
          message: checkResult.message
        });
      } else {
        skippedInvalid.push({
          index: index + 1,
          record,
          message: checkResult.message
        });
      }

      return;
    }

    const pullCount =
      record.pullCount === undefined || record.pullCount === null || record.pullCount === ""
        ? null
        : Number(record.pullCount);

    const isSummaryOnly = pullCount !== null;

    if (isSummaryOnly) {
      if (!Number.isInteger(pullCount) || pullCount <= 0) {
        skippedInvalid.push({
          index: index + 1,
          record,
          message: `第 ${index + 1} 筆 pullCount 必須是正整數`
        });
        return;
      }

      if (record.rarity !== "橙色") {
        skippedInvalid.push({
          index: index + 1,
          record,
          message: `第 ${index + 1} 筆使用 pullCount 時 rarity 必須為橙色`
        });
        return;
      }

    }

    validRecords.push({
      time: record.time,
      source: record.source,
      type: record.type,
      name: record.name,
      rarity: record.rarity,
      manual: true,
      summaryOnly: isSummaryOnly,
      pullCount: isSummaryOnly ? pullCount : undefined,
      id: [
        isSummaryOnly ? "manual_summary" : "manual",
        record.source,
        record.time,
        record.name,
        record.rarity,
        index
      ].join("_")
    });
  });

  return {
    validRecords,
    skippedApiRange,
    skippedInvalid
  };
}

async function addRecords(newRecords) {
  newRecords.forEach(record => {
    refreshRecordMetadata(record);
    normalizeSpecialRecruitRecord(record);
  });
  const existingIds = new Set(
    records.map(record => record.id || createRecordId(record))
  );

  let addedCount = 0;
  let skippedCount = 0;

  newRecords.forEach(record => {
    const id = record.id || createRecordId(record);

    if (existingIds.has(id)) {
      skippedCount++;
      return;
    }

    record.id = id;
    records.push(record);
    existingIds.add(id);
    addedCount++;
  });

  sortRecordsByTime();
  currentRecordPage = 1;

  await window.gf2API.saveRecords(records);

  renderRecords();
  renderStats();
  renderSpecialRecords();
  renderOrangeHistory();
  renderTargetCharacterStats();
  renderAppearanceAnalysis();
  updateStatsDate();

  return { addedCount, skippedCount };
}

function setSyncStatus(message) {
  document.getElementById("syncStatus").textContent = message;
}

function showToast(message, type = "success", duration = 3600) {
  const region = document.getElementById("toastRegion");
  const toast = document.createElement("div");
  toast.className = `app-toast app-toast-${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✓" : type === "error" ? "!" : "i"}</span><p>${escapeHtml(message)}</p>`;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

function setSyncProgress(step, total, title, detail) {
  const panel = document.getElementById("syncProgress");
  panel.classList.remove("hidden", "sync-progress-error", "sync-progress-complete");
  document.getElementById("syncProgressBar").style.width = `${Math.round(step / total * 100)}%`;
  document.getElementById("syncProgressTitle").textContent = title;
  document.getElementById("syncProgressDetail").textContent = detail;
}

async function syncAllPoolsReal(gachaUrl, accessToken) {
  const poolTypes = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const poolNameMap = {
    1: "常規採購",
    2: "未知卡池",
    3: "定向採購",
    4: "軍備提升",
    5: "新手採購",
    6: "自選人形",
    7: "自選武器",
    8: "神秘箱",
    9: "新裝採購"
  };

  let allSyncedRecords = [];
  let messages = [];

  for (let index = 0; index < poolTypes.length; index++) {
    const poolType = poolTypes[index];
    const poolName = poolNameMap[poolType] || `卡池${poolType}`;

    setSyncStatus(`同步中：${poolName}...`);
    setSyncProgress(index, poolTypes.length + 1, `正在讀取：${poolName}`, `第 ${index + 1}／${poolTypes.length} 個卡池`);

    const result = await window.gf2API.syncPool({
      gachaUrl,
      accessToken,
      poolType
    });

    allSyncedRecords = allSyncedRecords.concat(result.records);
    messages.push(`${poolName}：${result.count} 筆`);
  }

  setSyncStatus("同步完成");
  setSyncProgress(poolTypes.length, poolTypes.length + 1, "正在整理紀錄", "合併新資料並略過重複內容…");

  return {
    records: allSyncedRecords,
    messages
  };
}

function getRarityClass(rarity) {
  if (rarity === "橙色") return "rarity-elite";
  if (rarity === "紫色") return "rarity-standard";
  return "";
}

function formatRate(count, total) {
  return total > 0 ? `${(count / total * 100).toFixed(2)}%` : "-";
}

function makeAppearanceKpi(label, value, detail) {
  return `<article class="appearance-kpi"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function renderAppearanceAnalysis() {
  const outfitRecords = getGameRecords("新裝採購", "oldToNew").filter(record => !record.summaryOnly);
  const mysteryRecords = getGameRecords("神秘箱", "oldToNew").filter(record => !record.summaryOnly);
  const inferOutfitDefinition = poolRecords => {
    const itemMatchedDefinition = poolRecords
      .map(record => outfitPoolMap.itemMatchers?.[String(record.itemId)])
      .find(Boolean);
    if (itemMatchedDefinition) return itemMatchedDefinition;
    if (poolRecords.some(record => String(record.itemId) === "31126")) {
      return {
        name: "睡醒的人魚",
        featuredOutfit: "衣裝·睡醒的人魚",
        image: "../assets/special-recruit/pool-springfield-mermaid.png"
      };
    }
    const featured = poolRecords.find(record => {
      return record.rarity === "橙色" && String(record.name || "").startsWith("衣裝·");
    });
    return featured ? {
      name: featured.name.replace(/^衣裝·/, ""),
      featuredOutfit: featured.name
    } : {};
  };
  const isLimitedOutfitReward = (record, definition = {}) => {
    const featuredName = definition.featuredOutfit;
    return featuredName
      ? record.name === featuredName
      : record.rarity === "橙色" && String(record.name || "").startsWith("衣裝·");
  };
  const isRareOutfitReward = (record, definition = {}) => {
    if (isLimitedOutfitReward(record, definition)) return false;
    const name = String(record.name || "");
    return name.startsWith("衣裝·") ||
      name.startsWith("塗裝·") ||
      name.startsWith("精雕奇憶·") ||
      name === "位鍵演化禮盒" ||
      name === "火控演化禮盒" ||
      (definition.rareItems || []).includes(name);
  };
  const groups = new Map();
  outfitRecords.forEach(record => {
    const key = String(record.poolId ?? "unknown");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  const poolCards = [...groups.entries()].map(([poolId, poolRecords]) => {
    const definition = outfitPoolMap.pools?.[poolId] || inferOutfitDefinition(poolRecords);
    const poolLimited = poolRecords.filter(record => isLimitedOutfitReward(record, definition));
    const poolRare = poolRecords.filter(record => isRareOutfitReward(record, definition));
    const featuredName = definition.featuredOutfit || "";
    const dateStart = poolRecords[0]?.time?.split(" ")[0] || "-";
    const dateEnd = poolRecords.at(-1)?.time?.split(" ")[0] || "-";
    const outfitDraws = poolRecords
      .map((record, index) => ({ record, drawNumber: index + 1 }))
      .filter(({ record }) => String(record.name).startsWith("衣裝·"));
    const outfitDrawList = outfitDraws.map(({ record, drawNumber }) => {
      const category = featuredName && record.name === featuredName ? "限定衣裝" : "稀有衣裝";
      const categoryClass = category === "限定衣裝" ? "featured" : "outfit";
      return `<li><span class="reward-badge ${categoryClass}">${category}</span><span>${escapeHtml(record.name)}</span><strong>第 ${drawNumber} 抽</strong></li>`;
    }).join("") || `<li class="empty-result">尚未取得限定衣裝或稀有衣裝</li>`;

    const categorizedRare = poolRare.filter(record => !String(record.name).startsWith("衣裝·"));
    const categories = [
      ["衣裝部件", record => !String(record.name).startsWith("塗裝·") && !String(record.name).startsWith("精雕奇憶·") && !["位鍵演化禮盒", "火控演化禮盒"].includes(record.name)],
      ["武器塗裝與部件", record => String(record.name).startsWith("塗裝·")],
      ["精雕奇憶造物", record => String(record.name).startsWith("精雕奇憶·")],
      ["位鍵演化禮盒", record => record.name === "位鍵演化禮盒"],
      ["火控演化禮盒", record => record.name === "火控演化禮盒"]
    ];
    const categoryHtml = categories.map(([label, predicate]) => {
      const categoryRecords = categorizedRare.filter(predicate);
      const nameCounts = new Map();
      categoryRecords.forEach(record => nameCounts.set(record.name, (nameCounts.get(record.name) || 0) + 1));
      const detail = [...nameCounts.entries()].map(([name, count]) => `${escapeHtml(name)}${count > 1 ? ` ×${count}` : ""}`).join("、");
      return `<div class="reward-category"><div><span>${label}</span><small>${detail || "尚未取得"}</small></div><strong>${categoryRecords.length}</strong></div>`;
    }).join("");
    const poolArt = definition.image
      ? `<img class="outfit-hero-art" src="${escapeHtml(definition.image)}" alt="${escapeHtml(definition.name || "新裝採購")}" loading="lazy">`
      : "";

    return `<article class="outfit-pool-card">
      <header class="outfit-hero"><div class="outfit-hero-copy"><span class="outfit-code">POOL // ${poolId}${definition.provisional ? " · ITEM MATCH" : ""}</span><h3>${definition.name || `新裝採購 ${poolId}`}</h3><small>${dateStart} ～ ${dateEnd}</small><div class="outfit-total"><strong>${poolRecords.length}</strong><span>總抽數</span></div><div class="outfit-core-stats"><div><span>限定</span><strong>${poolLimited.length}</strong><small>${formatRate(poolLimited.length, poolRecords.length)}／官方 1.18%</small></div><div><span>稀有</span><strong>${poolRare.length}</strong><small>${formatRate(poolRare.length, poolRecords.length)}／官方 16.02%</small></div></div></div>${poolArt}</header>
      <div class="outfit-result-grid">
        <section class="visual-reward-list"><div><span>衣裝出貨</span>${featuredName ? `<small>本期：${escapeHtml(featuredName.replace(/^衣裝·/, ""))}</small>` : ""}</div><ul>${outfitDrawList}</ul></section>
        <section class="rare-reward-summary"><h4>稀有獎品分類</h4><div class="reward-category-grid">${categoryHtml}</div></section>
      </div>
    </article>`;
  }).reverse().join("");

  document.getElementById("outfitPoolStats").innerHTML = poolCards || `<div class="appearance-empty">尚無新裝採購紀錄，請先同步 type_id=9。</div>`;

  const isCatalogCharacterOrWeapon = record => {
    const catalogType = itemMap[String(record.itemId)]?.type || record.originalType || record.type || "";
    return catalogType === "人形" || catalogType === "角色" || String(catalogType).includes("武器");
  };
  const mysteryLimited = mysteryRecords.filter(record => record.rarity === "橙色" && isCatalogCharacterOrWeapon(record));
  const mysteryRare = mysteryRecords.filter(record => record.rarity === "紫色" && isCatalogCharacterOrWeapon(record));
  const limitedFragments = mysteryLimited.length * 90;
  const rareFragments = mysteryRare.length * 18;
  const totalFragments = limitedFragments + rareFragments;
  const convertedPulls = Math.floor(totalFragments / 30);
  const remainingFragments = totalFragments % 30;
  document.getElementById("mysterySummary").innerHTML = [
    makeAppearanceKpi("神秘箱總抽數", `${mysteryRecords.length} 抽`, "每筆紀錄視為一次收取"),
    makeAppearanceKpi("限定獎品", `${mysteryLimited.length} 個`, `實際機率 ${formatRate(mysteryLimited.length, mysteryRecords.length)}／官方 0.28%`),
    makeAppearanceKpi("稀有獎品", `${mysteryRare.length} 個`, `實際機率 ${formatRate(mysteryRare.length, mysteryRecords.length)}／官方 3.92%`),
    `<article class="mystery-pull-hero"><span>碎片可換算</span><strong>${convertedPulls}<small>抽</small></strong><p>${totalFragments} 碎片｜兌換後剩餘 ${remainingFragments} 碎片</p></article>`
  ].join("");
  const renderMysteryGroup = (title, groupRecords, officialRate) => {
    const counts = new Map();
    groupRecords.forEach(record => counts.set(record.name, (counts.get(record.name) || 0) + 1));
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `<li><span>${escapeHtml(name)}</span><strong>×${count}</strong></li>`).join("");
    return `<section><header><div><span>${title}</span><small>官方機率 ${officialRate}</small></div><strong>${groupRecords.length} 次</strong></header><ul>${rows || `<li class="empty-result">尚無紀錄</li>`}</ul></section>`;
  };
  document.getElementById("mysteryBreakdown").innerHTML = [
    renderMysteryGroup("限定獎品", mysteryLimited, "0.28%"),
    renderMysteryGroup("稀有獎品", mysteryRare, "3.92%"),
    `<section class="fragment-conversion"><header><div><span>換算明細</span><small>每 30 碎片折算 1 抽</small></div><strong>${totalFragments} 碎片</strong></header><div class="fragment-equation"><div><span>限定人形</span><strong>${mysteryLimited.length} × 90</strong><small>${limitedFragments} 碎片</small></div><div><span>稀有武器</span><strong>${mysteryRare.length} × 18</strong><small>${rareFragments} 碎片</small></div></div></section>`
  ].join("");
  renderRecruitmentAnalysis();
}

function renderPagination(totalPages) {

  const container = document.getElementById("recordPageNumbers");

  container.innerHTML = "";

  const start = Math.floor((currentRecordPage - 1) / 10) * 10 + 1;

  const end = Math.min(start + 9, totalPages);

  for (let i = start; i <= end; i++) {

    const btn = document.createElement("button");

    btn.className = "page-number";

    if (i === currentRecordPage) {

      btn.classList.add("active");
    }

    btn.textContent = i;

    btn.onclick = () => {

      currentRecordPage = i;

      renderRecords();

    };

    container.appendChild(btn);

  }

}

function getFilteredRecordList() {
  let filteredRecords = records.filter(record => !record.summaryOnly);

  if (currentPoolFilter !== "全部") {
    filteredRecords = filteredRecords.filter(record => {
      return record.source === currentPoolFilter;
    });
  }

  if (currentRarityFilter !== "全部") {
    filteredRecords = filteredRecords.filter(record => record.rarity === currentRarityFilter);
  }

  const keyword = currentRecordSearch.trim().toLocaleLowerCase("zh-Hant");
  if (keyword) {
    filteredRecords = filteredRecords.filter(record =>
      [record.name, record.source, record.type, getRecordPoolName(record)]
        .some(value => String(value ?? "").toLocaleLowerCase("zh-Hant").includes(keyword))
    );
  }

  return filteredRecords;
}

function getRecordPoolName(record) {
  const poolId = String(record?.poolId ?? "");
  if (!poolId) return record?.source || "未識別卡池";
  const generalDefinition = poolMap.pools?.find(pool => String(pool.poolId) === poolId);
  if (generalDefinition?.displayName) return generalDefinition.displayName;
  const outfitDefinition = outfitPoolMap.pools?.[poolId];
  if (outfitDefinition?.name) return outfitDefinition.name;
  return record?.source ? `${record.source}（未識別期別）` : "未識別卡池";
}

function renderRecords() {
  const table = document.getElementById("recordTable");
  table.innerHTML = "";

  const filteredRecords = getFilteredRecordList();

  const displayRecords = sortByGameOrder(filteredRecords, "newToOld");

  const totalPages = Math.max(
    1,
    Math.ceil(displayRecords.length / recordsPerPage)
  );

  if (currentRecordPage > totalPages) {
    currentRecordPage = totalPages;
  }

  const startIndex = (currentRecordPage - 1) * recordsPerPage;
  const pageRecords = displayRecords.slice(
    startIndex,
    startIndex + recordsPerPage
  );

  document.getElementById("recordFilterSummary").textContent = `${displayRecords.length.toLocaleString()} 筆`;
  const emptyState = document.getElementById("recordEmptyState");
  const tableWrap = document.getElementById("recordTableWrap");
  const pagination = document.querySelector("#recordsPage .pagination");
  emptyState.classList.toggle("hidden", displayRecords.length > 0);
  tableWrap.classList.toggle("hidden", displayRecords.length === 0);
  pagination.classList.toggle("hidden", displayRecords.length === 0);

  pageRecords.forEach(record => {
    const tr = document.createElement("tr");
    if (pendingRecordFocusId && createRecordId(record) === pendingRecordFocusId) tr.classList.add("record-focus-row");
    const nameClass = getRarityClass(record.rarity);

    tr.innerHTML = `
      <td>${record.time}</td>
      <td>${record.source}</td>
      <td>${record.type}</td>
      <td class="${nameClass}">${record.name}</td>
      <td>${record.itemNum ?? 1}</td>
      <td>${escapeHtml(getRecordPoolName(record))}</td>
    `;

    table.appendChild(tr);
  });

  if (pendingRecordFocusId) {
    requestAnimationFrame(() => document.querySelector(".record-focus-row")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  renderPagination(totalPages);

  document.getElementById("recordFirstBtn").disabled =
    currentRecordPage === 1;

  document.getElementById("recordPrevBtn").disabled =
    currentRecordPage === 1;

  document.getElementById("recordNextBtn").disabled =
    currentRecordPage === totalPages;

  document.getElementById("recordLastBtn").disabled =
    currentRecordPage === totalPages;
}

function getPoolStats(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");


  let total = 0;
  let elite = 0;
  let pity = 0;

  poolRecords.forEach(record => {
    if (record.summaryOnly && record.pullCount) {
      total += record.pullCount;
    } else {
      total += 1;
    }

    if (record.rarity === "橙色") {
      elite++;
      pity = 0;
    } else {
      pity++;
    }
  });

  return {
    total,
    elite,
    pity
  };
}

function getEliteRateText(poolStats) {
  if (poolStats.total === 0) {
    return "0 (-)";
  }

  const rate = ((poolStats.elite / poolStats.total) * 100).toFixed(1);
  return `${poolStats.elite} (${rate}%)`;
}

function getRecordPullCount(record) {
  if (record.summaryOnly && Number.isInteger(record.pullCount)) {
    return record.pullCount;
  }

  return 1;
}

function createCharacterStat(name) {
  return {
    name,
    poolIds: new Set(),
    acquisitionPulls: 0,
    upCount: 0,
    offRateCount: 0,
    offRateDetails: [],
    upPullDetails: [],
    firstTime: null,
    lastTime: null
  };
}

function updateCharacterStatDate(stat, time) {
  if (!time) return;

  if (!stat.firstTime || new Date(time) < new Date(stat.firstTime)) {
    stat.firstTime = time;
  }

  if (!stat.lastTime || new Date(time) > new Date(stat.lastTime)) {
    stat.lastTime = time;
  }
}

function getLimitedPoolStats(source) {
  const targetRecords = getGameRecords(source, "oldToNew");
  const stats = new Map();
  let pullsSinceLastUp = 0;
  let pullsSinceLastOrange = 0;
  let pendingOffRates = [];

  function getStat(name) {
    if (!stats.has(name)) {
      stats.set(name, createCharacterStat(name));
    }

    return stats.get(name);
  }

  targetRecords.forEach(record => {
    const weight = getRecordPullCount(record);
    pullsSinceLastUp += weight;
    pullsSinceLastOrange += weight;

    if (record.rarity !== "橙色") {
      return;
    }

    const orangePullCount = pullsSinceLastOrange;
    pullsSinceLastOrange = 0;

    if (isOffRateRecord(record)) {
      pendingOffRates.push({
        name: record.name,
        count: orangePullCount,
        time: record.time
      });
      return;
    }

    // Every non-permanent orange result is treated as the UP character. All
    // pulls and off-rate results since the previous UP are assigned here.
    const stat = getStat(record.name);
    stat.upCount++;
    stat.acquisitionPulls += pullsSinceLastUp;
    stat.upPullDetails.push({
      count: pullsSinceLastUp,
      poolId: record.poolId ? String(record.poolId) : "manual",
      time: record.time
    });
    stat.offRateCount += pendingOffRates.length;
    stat.offRateDetails.push(...pendingOffRates);
    if (record.poolId) {
      stat.poolIds.add(String(record.poolId));
    }
    updateCharacterStatDate(stat, pendingOffRates[0]?.time || record.time);
    updateCharacterStatDate(stat, record.time);

    pullsSinceLastUp = 0;
    pendingOffRates = [];
  });

  return [...stats.values()].sort((a, b) => {
    return new Date(b.lastTime || 0) - new Date(a.lastTime || 0);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCharacterCopies(upCount) {
  if (upCount === 0) return "未取得";
  if (upCount === 1) return "本體（0 椎）";
  return `本體 + ${upCount - 1} 椎`;
}

function formatWeaponTuning(upCount) {
  if (upCount === 0) return "未取得";

  const level = Math.min(upCount, 6);
  const overflow = Math.max(upCount - 6, 0);

  return overflow > 0
    ? `調校 ${level} 等（溢出 ${overflow} 把）`
    : `調校 ${level} 等`;
}

function getSelectedPoolStats(source) {
  const sourceRecords = getGameRecords(source, "oldToNew");
  const recordsByPool = new Map();

  sourceRecords.forEach(record => {
    const poolId = String(record.poolId || "manual");
    if (!recordsByPool.has(poolId)) recordsByPool.set(poolId, []);
    recordsByPool.get(poolId).push(record);
  });

  const stats = new Map();

  function getStat(name) {
    if (!stats.has(name)) stats.set(name, createCharacterStat(name));
    return stats.get(name);
  }

  for (const [poolId, poolRecords] of recordsByPool.entries()) {
    let pullsSinceLastUp = 0;
    let pullsSinceLastOrange = 0;
    let pendingOffRates = [];

    poolRecords.forEach(record => {
      const weight = getRecordPullCount(record);
      pullsSinceLastUp += weight;
      pullsSinceLastOrange += weight;

      if (record.rarity !== "橙色") return;

      const orangePullCount = pullsSinceLastOrange;
      pullsSinceLastOrange = 0;

      if (isOffRateRecord(record)) {
        pendingOffRates.push({
          name: record.name,
          count: orangePullCount,
          time: record.time
        });
        return;
      }

      const stat = getStat(record.name);
      stat.poolIds.add(poolId);
      stat.upCount++;
      stat.acquisitionPulls += pullsSinceLastUp;
      stat.upPullDetails.push({
        count: pullsSinceLastUp,
        poolId,
        time: record.time
      });
      stat.offRateCount += pendingOffRates.length;
      stat.offRateDetails.push(...pendingOffRates);
      updateCharacterStatDate(stat, pendingOffRates[0]?.time || record.time);
      updateCharacterStatDate(stat, record.time);

      pullsSinceLastUp = 0;
      pendingOffRates = [];
    });
  }

  return [...stats.values()].sort((a, b) => {
    return new Date(b.lastTime || 0) - new Date(a.lastTime || 0);
  });
}

function renderCharacterStatCards(containerId, characterStats, emptyText, itemKind = "character") {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (characterStats.length === 0) {
    container.innerHTML = `<p class="character-stats-empty">${escapeHtml(emptyText)}</p>`;
    return;
  }

  container.innerHTML = characterStats.map(stat => {
    const periodCount = stat.poolIds.size || 1;
    const dateText = stat.firstTime && stat.lastTime
      ? `${getDateOnly(stat.firstTime)}～${getDateOnly(stat.lastTime)}`
      : "日期未知";
    const totalSpent = stat.acquisitionPulls;
    const progressionLabel = itemKind === "weapon" ? "武器／調校" : "人形／椎體";
    const progressionText = itemKind === "weapon"
      ? formatWeaponTuning(stat.upCount)
      : formatCharacterCopies(stat.upCount);
    const artPath = itemKind === "character"
      ? characterArtMap.roles?.[stat.name]?.illustration
      : weaponArtMap.weapons?.[stat.name];
    const artClass = itemKind === "weapon" ? "weapon-card-art" : "character-card-art";
    const cardArtClass = itemKind === "weapon" ? "has-weapon-art" : "has-character-art";
    const artHtml = artPath
      ? `<img class="${artClass}" src="${escapeHtml(artPath)}" alt="" loading="lazy">`
      : "";
    const offRateHtml = stat.offRateDetails.length > 0
      ? stat.offRateDetails.map(item => `
          <li>
            <span>${escapeHtml(item.name)}</span>
            <strong>${item.count} 抽</strong>
          </li>
        `).join("")
      : `<li class="off-rate-empty">沒有歪角</li>`;
    const efficiency = getStatEfficiency(stat);

    return `
      <article class="character-stat-card ${artPath ? cardArtClass : ""}">
        ${artHtml}
        <div class="character-card-content">
          <h3>${escapeHtml(stat.name)}</h3>
          <p class="character-stat-meta">${periodCount} 期卡池｜${dateText}</p>
          <div class="stat-row">
            <span class="stat-label">總抽數</span>
            <span class="stat-value character-stat-highlight">${totalSpent} 抽</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">${progressionLabel}</span>
            <span class="stat-value">${progressionText}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">抽歪次數</span>
            <span class="stat-value">${stat.offRateCount} 次</span>
          </div>
          ${renderCardEfficiency(
            efficiency,
            itemKind === "weapon" ? "單武器抽卡統計" : "單角色抽卡統計"
          )}
          <div class="off-rate-breakdown">
            <div class="off-rate-breakdown-title">抽歪紀錄</div>
            <ul>${offRateHtml}</ul>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderTargetCharacterStats() {
  renderCharacterStatCards(
    "targetCharacterStats",
    getLimitedPoolStats("定向採購"),
    "尚無已完成的定向採購 UP 紀錄；目前墊抽會等下一位 UP 出貨後再歸入。"
  );
  renderCharacterStatCards(
    "weaponTargetStats",
    getLimitedPoolStats("軍備提升"),
    "尚無已完成的軍備提升 UP 紀錄；目前墊抽會等下一把 UP 武器出貨後再歸入。",
    "weapon"
  );
  renderCharacterStatCards(
    "selectCharacterStats",
    getSelectedPoolStats("自選人形"),
    "尚未取得自選人形橙色；目前抽數會先保留為墊抽。"
  );
  renderCharacterStatCards(
    "selectWeaponCharacterStats",
    getSelectedPoolStats("自選武器"),
    "尚未取得自選武器橙色；目前抽數會先保留為墊抽。",
    "weapon"
  );

  renderCombinedLoadoutStats();
}

function mergeProgressStats(...statGroups) {
  const merged = new Map();

  statGroups.flat().forEach(stat => {
    if (!merged.has(stat.name)) merged.set(stat.name, createCharacterStat(stat.name));
    const target = merged.get(stat.name);

    stat.poolIds.forEach(poolId => target.poolIds.add(poolId));
    target.acquisitionPulls += stat.acquisitionPulls;
    target.upCount += stat.upCount;
    target.offRateCount += stat.offRateCount;
    target.offRateDetails.push(...stat.offRateDetails);
    target.upPullDetails.push(...stat.upPullDetails);
    updateCharacterStatDate(target, stat.firstTime);
    updateCharacterStatDate(target, stat.lastTime);
  });

  return [...merged.values()];
}

function getCombinedLoadoutStats() {
  const characterStats = mergeProgressStats(
    getLimitedPoolStats("定向採購"),
    getSelectedPoolStats("自選人形")
  );
  const weaponStats = mergeProgressStats(
    getLimitedPoolStats("軍備提升"),
    getSelectedPoolStats("自選武器")
  );
  const weaponByName = new Map(weaponStats.map(stat => [stat.name, stat]));

  return characterStats.map(character => {
    const signatureName = signatureMap[character.name];
    if (!signatureName) return null;

    const signature = weaponByName.get(signatureName) || null;
    const characterPulls = [...character.upPullDetails]
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const signaturePulls = [...(signature?.upPullDetails || [])]
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const completed = characterPulls.length >= 7 && signaturePulls.length >= 1;
    const sixPlusSixCompleted = characterPulls.length >= 7 && signaturePulls.length >= 6;
    const characterSixPulls = characterPulls.slice(0, 7)
      .reduce((sum, detail) => sum + detail.count, 0);
    const sixPlusOnePulls = characterSixPulls + (signaturePulls[0]?.count || 0);
    const sixPlusSixPulls = characterSixPulls + signaturePulls.slice(0, 6)
      .reduce((sum, detail) => sum + detail.count, 0);

    return {
      character,
      signature,
      signatureName,
      completed,
      sixPlusOnePulls,
      sixPlusSixCompleted,
      sixPlusSixPulls,
      currentTotalPulls: character.acquisitionPulls + (signature?.acquisitionPulls || 0)
    };
  }).filter(Boolean)
    .sort((a, b) => new Date(b.character.lastTime || 0) - new Date(a.character.lastTime || 0));
}

function renderCombinedLoadoutStats() {
  const container = document.getElementById("combinedLoadoutStats");
  if (!container) return;

  const combinedStats = getCombinedLoadoutStats();
  if (combinedStats.length === 0) {
    container.innerHTML = `<p class="character-stats-empty">尚無可配對的人形與專武紀錄。</p>`;
    return;
  }

  container.innerHTML = combinedStats.map(item => {
    const character = item.character;
    const currentConeLevel = Math.max(character.upCount - 1, 0);
    const currentTuningLevel = Math.min(item.signature?.upCount || 0, 6);
    const currentProgressLabel = `${currentConeLevel}＋${currentTuningLevel}`;
    const efficiency = getStatEfficiency({
      acquisitionPulls: item.currentTotalPulls,
      upCount: character.upCount + (item.signature?.upCount || 0),
      offRateCount: character.offRateCount + (item.signature?.offRateCount || 0)
    });
    const artPath = characterArtMap.roles?.[character.name]?.display;
    const artHtml = artPath
      ? `<img class="loadout-character-art" src="${escapeHtml(artPath)}" alt="" loading="lazy">`
      : "";
    const weaponArtPath = weaponArtMap.weapons?.[item.signatureName];
    const weaponArtHtml = weaponArtPath
      ? `<img class="signature-weapon-art" src="${escapeHtml(weaponArtPath)}" alt="" loading="lazy">`
      : "";

    return `
      <article class="character-stat-card combined-stat-card ${item.completed ? "is-complete" : "is-pending"}">
        <div class="loadout-card-header">
          ${artHtml}
          <div class="loadout-identity">
            <span class="loadout-code">ELMO // LOADOUT</span>
            <h3>${escapeHtml(character.name)}</h3>
            <p class="character-stat-meta">專武：${escapeHtml(item.signatureName)}</p>
          </div>
          <span class="loadout-status ${item.sixPlusSixCompleted ? "is-legend" : ""}">${item.sixPlusSixCompleted ? "6＋6 LEGEND" : item.completed ? "6＋1 COMPLETE" : "IN PROGRESS"}</span>
        </div>
        <div class="combined-columns">
          <div class="combined-column combined-goal-column">
            <span class="combined-column-title">${currentProgressLabel} 總抽數</span>
            <strong class="combined-primary-value character-stat-highlight">${item.currentTotalPulls} 抽</strong>
          </div>
          <div class="combined-column combined-progress-column ${weaponArtPath ? "has-signature-art" : ""}">
            ${weaponArtHtml}
            <span class="combined-column-title">目前總進度</span>
            <strong>${formatCharacterCopies(character.upCount)}</strong>
            <span>${formatWeaponTuning(item.signature?.upCount || 0)}</span>
          </div>
        </div>
        ${renderCardEfficiency(efficiency, "人形＋專武抽卡統計")}
      </article>
    `;
  }).join("");
}

function getStatEfficiency(stat) {
  const pulls = stat?.acquisitionPulls || 0;
  const up = stat?.upCount || 0;
  const off = stat?.offRateCount || 0;
  const orange = up + off;

  return {
    rate: pulls > 0 && orange > 0 ? `${((orange / pulls) * 100).toFixed(1)}%` : "-",
    average: up > 0 ? `${(pulls / up).toFixed(1)} 抽` : "-",
    upRate: orange > 0 ? `${((up / orange) * 100).toFixed(1)}%` : "-",
    detail: orange > 0 ? `${orange} 橙｜${up} UP／${off} 歪` : "尚無完整出貨紀錄"
  };
}

function renderCardEfficiency(stat, title) {
  return `
    <div class="card-efficiency">
      <div class="card-efficiency-heading"><span>${title}</span><small>${stat.detail}</small></div>
      <div class="card-efficiency-metrics">
        <div><span>出橙機率</span><strong>${stat.rate}</strong></div>
        <div><span>UP 平均成本</span><strong>${stat.average}</strong></div>
        <div><span>UP 率</span><strong>${stat.upRate}</strong></div>
      </div>
    </div>
  `;
}

function getOrangeHistory(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");

  const history = [];
  let countSinceLastElite = 0;
  const isolateByPool = poolName.startsWith("自選");
  const countByPool = new Map();
  let latestPoolKey = "";

  poolRecords.forEach(record => {
    const poolKey = String(record.poolId || "manual");
    if (isolateByPool) latestPoolKey = poolKey;
    const currentCount = isolateByPool ? (countByPool.get(poolKey) || 0) : countSinceLastElite;

    if (record.summaryOnly && record.pullCount) {
      if (record.rarity === "橙色") {
        history.push({
          name: record.name,
          count: record.pullCount,
          time: record.time,
          isOffRate: isOffRateRecord(record),
          summaryOnly: true,
          manual: record.manual === true,
          poolId: record.poolId || "",
          source: record.source,
          itemId: record.itemId || "",
          type: record.type || record.originalType || "",
          eventId: createRecordId(record)
        });

        if (isolateByPool) countByPool.set(poolKey, 0);
        else countSinceLastElite = 0;
      }

      return;
    }

    if (record.rarity === "橙色") {
      history.push({
        name: record.name,
        count: currentCount + 1,
        time: record.time,
        isOffRate: isOffRateRecord(record),
        summaryOnly: false,
        manual: record.manual === true,
        poolId: record.poolId || "",
        source: record.source,
        itemId: record.itemId || "",
        type: record.type || record.originalType || "",
        eventId: createRecordId(record)
      });

      if (isolateByPool) countByPool.set(poolKey, 0);
      else countSinceLastElite = 0;
    } else {
      if (isolateByPool) countByPool.set(poolKey, currentCount + 1);
      else countSinceLastElite++;
    }
  });

  return {
    history,
    currentPity: isolateByPool ? (countByPool.get(latestPoolKey) || 0) : countSinceLastElite
  };
}

function getAdvancedStats(poolName) {
  const result = getOrangeHistory(poolName);
  const eliteItems = result.history;

  let best = "-";
  let bestName = "";
  let worst = "-";
  let worstName = "";
  let average = "-";

  if (eliteItems.length > 0) {
    const counts = eliteItems.map(item => item.count);
    const sum = counts.reduce((total, count) => total + count, 0);

    average = (sum / counts.length).toFixed(1);

    eliteItems.forEach(item => {
      if (best === "-" || item.count < best) {
        best = item.count;
        bestName = item.name;
      }

      if (worst === "-" || item.count > worst) {
        worst = item.count;
        worstName = item.name;
      }
    });
  }

  return {
    eliteCount: eliteItems.length,
    currentPity: result.currentPity,
    best,
    bestName,
    worst,
    worstName,
    average
  };
}

function getPoolUpCost(poolName) {
  if (["常規採購", "新手採購"].includes(poolName)) return { average: "-", upCount: 0, spent: 0 };
  const stats = poolName.startsWith("自選")
    ? getSelectedPoolStats(poolName)
    : getLimitedPoolStats(poolName);
  const upCount = stats.reduce((sum, item) => sum + item.upCount, 0);
  const spent = stats.reduce((sum, item) => sum + item.acquisitionPulls, 0);
  return {
    average: upCount > 0 ? (spent / upCount).toFixed(1) : "-",
    upCount,
    spent
  };
}

function saveRecruitmentAnalysisPreference() {
  try {
    localStorage.setItem(ANALYSIS_PREF_KEY, JSON.stringify({
      category: recruitmentAnalysisState.category,
      poolName: recruitmentAnalysisState.poolName,
      historyView: recruitmentAnalysisState.historyView,
      eliteFilter: recruitmentAnalysisState.eliteFilter,
      distributionView: recruitmentAnalysisState.distributionView,
      advancedExpanded: recruitmentAnalysisState.advancedExpanded
    }));
  } catch (_) {}
}

function getRecruitmentEventVisual(event) {
  const character = characterArtMap.roles?.[event.name];
  if (character) return {
    path: character.head || character.display || character.illustration || "",
    kind: "character",
    assetKind: character.head ? "head" : "fallback"
  };
  const weapon = weaponArtMap.weapons?.[event.name];
  if (weapon) return { path: weapon, kind: "weapon", assetKind: "weapon" };
  const normalizedType = String(event.type || event.itemType || "").trim().toLowerCase();
  const isWeapon = normalizedType === "武器" || normalizedType.includes("weapon") || normalizedType.includes("槍");
  return { path: "", kind: isWeapon ? "weapon" : "character", assetKind: "missing" };
}

function getPoolCategory(poolName) {
  return Object.entries(recruitmentPoolGroups).find(([, pools]) => pools.includes(poolName))?.[0] || "limited";
}

function syncRecruitmentSelectors() {
  document.querySelectorAll("[data-analysis-category]").forEach(button => {
    button.classList.toggle("active", button.dataset.analysisCategory === recruitmentAnalysisState.category);
  });
  const select = document.getElementById("analysisPoolFilter");
  const poolOptions = recruitmentPoolGroups[recruitmentAnalysisState.category] || recruitmentPoolGroups.limited;
  if (!poolOptions.includes(recruitmentAnalysisState.poolName)) recruitmentAnalysisState.poolName = poolOptions[0];
  select.innerHTML = poolOptions.map(pool => `<option${pool === recruitmentAnalysisState.poolName ? " selected" : ""}>${pool}</option>`).join("");
}

function getCompletedUpDetails(poolName) {
  if (["常規採購", "新手採購"].includes(poolName)) return [];
  const stats = poolName.startsWith("自選") ? getSelectedPoolStats(poolName) : getLimitedPoolStats(poolName);
  return stats.flatMap(stat => stat.upPullDetails.map(detail => ({ ...detail, name: stat.name })));
}

function renderEliteEventDetail(event) {
  const detail = document.getElementById("eliteEventDetail");
  if (!event) {
    detail.classList.add("hidden");
    detail.innerHTML = "";
    return;
  }
  const visual = getRecruitmentEventVisual(event);
  const artPath = visual.path;
  const hasUnitDetail = Boolean(getDetailStatByName(event.name));
  detail.innerHTML = `<button class="elite-detail-close" data-close-event-detail aria-label="關閉事件詳情">×</button><div class="elite-detail-art ${visual.kind === "weapon" ? "is-weapon" : "is-character"} asset-${visual.assetKind}">${artPath ? `<img src="${escapeHtml(artPath)}" alt="">` : `<span>${escapeHtml(event.name.slice(0, 1))}</span>`}</div><div class="elite-detail-copy"><span>SELECTED ELITE</span><h4>${escapeHtml(event.name)}</h4><p>${escapeHtml(event.time || "日期未知")}｜${escapeHtml(event.source || recruitmentAnalysisState.poolName)}｜POOL ${escapeHtml(event.poolId || "未識別")}</p><div><b>${event.count} 抽</b><em>${event.isOffRate ? "歪" : ["常規採購", "新手採購"].includes(event.source) ? "菁英" : "UP"}</em>${event.summaryOnly ? `<small>摘要紀錄</small>` : event.manual ? `<small>手動紀錄</small>` : ""}</div></div><div class="elite-detail-actions"><button data-open-record="${escapeHtml(event.eventId)}">定位原始紀錄</button>${hasUnitDetail ? `<button data-open-unit="${escapeHtml(event.name)}">查看人形／軍備詳情</button>` : ""}</div>`;
  detail.classList.remove("hidden");
}

function renderRecruitmentPeriods(poolName, events) {
  const list = document.getElementById("periodHistoryList");
  const poolRecords = getGameRecords(poolName, "oldToNew");
  const groups = new Map();
  poolRecords.forEach((record, index) => {
    const hasPoolId = record.poolId !== undefined && record.poolId !== null && String(record.poolId) !== "";
    const key = hasPoolId ? `pool:${record.poolId}` : `missing:${createRecordId(record)}:${index}`;
    if (!groups.has(key)) groups.set(key, { key, poolId: hasPoolId ? String(record.poolId) : "", records: [] });
    groups.get(key).records.push(record);
  });
  const upDetails = getCompletedUpDetails(poolName);
  if (recruitmentAnalysisState.selectedPeriodKey && !groups.has(recruitmentAnalysisState.selectedPeriodKey)) {
    recruitmentAnalysisState.selectedPeriodKey = null;
  }
  const cards = [...groups.values()].reverse().map((group, index) => {
    const totalPulls = group.records.reduce((sum, record) => sum + getRecordPullCount(record), 0);
    const elites = group.records.filter(record => record.rarity === "橙色");
    const up = elites.filter(record => !isOffRateRecord(record)).length;
    const off = elites.filter(isOffRateRecord).length;
    const start = group.records[0]?.time || "";
    const end = group.records.at(-1)?.time || "";
    const definition = group.poolId ? poolMap.pools?.find(pool => String(pool.poolId) === group.poolId) : null;
    const periodName = definition?.displayName || (group.poolId ? poolName : `${poolName}（未識別期別）`);
    const openStart = definition?.startDate || String(start).slice(0, 10) || "日期未知";
    const openEnd = definition?.endDate || String(end).slice(0, 10) || "日期未知";
    const groupEvents = events.filter(event => group.poolId ? String(event.poolId) === group.poolId : group.records.some(record => createRecordId(record) === event.eventId));
    const completed = group.poolId ? upDetails.filter(item => String(item.poolId) === group.poolId) : [];
    const acquisitionHtml = completed.map(item => `<li><span>${escapeHtml(item.name)}</span><strong>${item.count} 抽</strong><small>${item.count > totalPulls ? "含前期累積抽數" : "本期取得"}</small></li>`).join("");
    const eventHtml = groupEvents.map(event => `<li><span>${escapeHtml(event.name)}</span><strong>${event.count} 抽</strong><small>${escapeHtml(event.time || "日期未知")}</small></li>`).join("");
    const selected = recruitmentAnalysisState.selectedPeriodKey === group.key;
    return `<details class="period-card" data-period-key="${escapeHtml(group.key)}"${selected ? " open" : ""}><summary><div><span>卡池開放期間</span><strong>${escapeHtml(periodName)}</strong><small>${escapeHtml(openStart)} ～ ${escapeHtml(openEnd)}</small></div><div class="period-summary-metrics"><span><b>${totalPulls}</b> 抽</span><span><b>${elites.length}</b> 菁英</span><span><b>${["常規採購", "新手採購"].includes(poolName) ? "—" : `${up}／${off}`}</b> UP／歪</span></div></summary><div class="period-card-body"><section><h4>本期出貨事件</h4><ul>${eventHtml || `<li>尚無菁英出貨</li>`}</ul></section><section><h4>UP 取得成本</h4><ul>${acquisitionHtml || `<li>${["常規採購", "新手採購"].includes(poolName) ? "不適用" : "本期尚未取得 UP"}</li>`}</ul></section></div></details>`;
  }).join("");
  list.innerHTML = cards || `<div class="analysis-empty-state">此卡池尚無可分組紀錄</div>`;
}

function renderRecruitmentAnalysis() {
  const poolName = recruitmentAnalysisState.poolName;
  syncRecruitmentSelectors();
  const isSpecial = recruitmentAnalysisState.category === "special";
  document.getElementById("recruitmentGeneralAnalysis").classList.toggle("hidden", isSpecial);
  document.getElementById("recruitmentSpecialAnalysis").classList.toggle("hidden", !isSpecial);

  if (isSpecial) {
    document.querySelectorAll("[data-appearance-target]").forEach(button => button.classList.toggle("active", button.dataset.appearanceTarget === (poolName === "新裝採購" ? "outfitAnalysisPanel" : "mysteryAnalysisPanel")));
    document.querySelectorAll(".appearance-panel").forEach(panel => panel.classList.toggle("active", panel.id === (poolName === "新裝採購" ? "outfitAnalysisPanel" : "mysteryAnalysisPanel")));
    saveRecruitmentAnalysisPreference();
    return;
  }

  const poolStats = getPoolStats(poolName);
  const result = getOrangeHistory(poolName);
  const history = result.history;
  const noUpMechanic = ["常規採購", "新手採購"].includes(poolName);
  if (noUpMechanic && recruitmentAnalysisState.eliteFilter !== "all") recruitmentAnalysisState.eliteFilter = "all";
  const upItems = noUpMechanic ? [] : history.filter(item => !item.isOffRate);
  const offItems = noUpMechanic ? [] : history.filter(item => item.isOffRate);
  const eliteAverage = history.length ? history.reduce((sum, item) => sum + item.count, 0) / history.length : null;
  const upCost = getPoolUpCost(poolName);
  const rate = poolStats.total ? poolStats.elite / poolStats.total * 100 : null;
  const upRate = noUpMechanic || !history.length ? null : upItems.length / history.length * 100;
  document.getElementById("analysisKpis").innerHTML = `<article class="pity-kpi"><span>目前墊抽</span><strong>${result.currentPity}<small> 抽</small></strong></article><article><span>總抽數</span><strong>${poolStats.total.toLocaleString()}</strong><small>${poolName}</small></article><article><span>菁英機率</span><strong>${rate === null ? "—" : `${rate.toFixed(1)}%`}</strong><small>${poolStats.elite} 位菁英</small></article><article class="cost-kpi"><span>平均出貨成本</span><div class="cost-kpi-values"><b>${eliteAverage === null ? "—" : `${eliteAverage.toFixed(1)} 抽`}<small>菁英平均</small></b><b>${noUpMechanic || upCost.average === "-" ? "不適用" : `${upCost.average} 抽`}<small>UP 平均</small></b></div><small>${noUpMechanic ? "此卡池沒有 UP 機制" : `已取得 ${upCost.upCount} 次 UP`}</small></article><article><span>UP 命中率</span><strong>${upRate === null ? "不適用" : `${upRate.toFixed(1)}%`}</strong><small>${noUpMechanic ? "此卡池沒有 UP 機制" : `${upItems.length} UP / ${offItems.length} 歪`}</small></article>`;
  const supplemental = document.getElementById("analysisSupplemental");
  supplemental.innerHTML = poolName.startsWith("自選") ? `<span class="mechanic-note">首橙保底 UP｜實際結果保留</span>` : "";
  supplemental.classList.toggle("hidden", !supplemental.innerHTML);

  if (recruitmentAnalysisState.selectedEventId && !history.some(event => event.eventId === recruitmentAnalysisState.selectedEventId)) recruitmentAnalysisState.selectedEventId = null;
  const filteredHistory = history.filter(event => recruitmentAnalysisState.eliteFilter === "all" || (recruitmentAnalysisState.eliteFilter === "off" ? event.isOffRate : !event.isOffRate));
  const displayEvents = filteredHistory.slice().reverse();
  const portraitButton = event => {
    const visual = getRecruitmentEventVisual(event);
    const artPath = visual.path;
    const selected = event.eventId === recruitmentAnalysisState.selectedEventId;
    const status = noUpMechanic ? "菁英" : event.isOffRate ? "歪" : "UP";
    return `<button class="elite-portrait-item ${visual.kind === "weapon" ? "is-weapon" : "is-character"} asset-${visual.assetKind}${selected ? " selected" : ""}" data-analysis-event="${escapeHtml(event.eventId)}" title="${escapeHtml(event.name)}｜${escapeHtml(event.time || "日期未知")}｜${event.count} 抽｜${status}"><span class="elite-avatar">${artPath ? `<img src="${escapeHtml(artPath)}" alt="${escapeHtml(event.name)}">` : `<span>${escapeHtml(event.name.slice(0, 1))}</span>`}</span><b class="elite-pull-badge">${event.count}</b><em class="elite-state-mark ${event.isOffRate ? "is-off" : "is-up"}">${status}</em><span class="elite-portrait-name">${escapeHtml(event.name)}</span></button>`;
  };
  const barScaleMax = Math.max(80, Math.ceil(Math.max(1, ...displayEvents.map(event => event.count)) / 10) * 10);
  const timelineButton = event => {
    const visual = getRecruitmentEventVisual(event);
    const artPath = visual.path;
    const selected = event.eventId === recruitmentAnalysisState.selectedEventId;
    const stateClass = noUpMechanic ? "is-neutral" : event.isOffRate ? "is-off" : "is-up";
    const status = noUpMechanic ? "菁英" : event.isOffRate ? "歪" : "UP";
    const width = Math.max(8, Math.min(100, event.count / barScaleMax * 100));
    return `<button class="elite-bar-event ${visual.kind === "weapon" ? "is-weapon" : "is-character"} ${stateClass}${selected ? " selected" : ""}" data-analysis-event="${escapeHtml(event.eventId)}" aria-label="${escapeHtml(event.name)}，${event.count} 抽，${status}"><span class="elite-bar-avatar">${artPath ? `<img src="${escapeHtml(artPath)}" alt="">` : `<span>${escapeHtml(event.name.slice(0, 1))}</span>`}</span><span class="elite-bar-copy"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.time || "日期未知")}</small></span><span class="elite-bar-track" aria-hidden="true"><i style="width:${width.toFixed(2)}%"><b>${event.count}<small>抽</small></b></i></span><em>${status}</em></button>`;
  };
  const emptyText = recruitmentAnalysisState.eliteFilter === "all" ? "尚無菁英出貨紀錄" : `最近紀錄中沒有${recruitmentAnalysisState.eliteFilter === "up" ? " UP" : "抽歪"}事件`;
  document.getElementById("recentEliteList").innerHTML = displayEvents.map(portraitButton).join("") || `<div class="analysis-empty-state">${emptyText}</div>`;
  document.getElementById("eliteTimelineList").innerHTML = displayEvents.map(timelineButton).join("") || `<div class="analysis-empty-state">${emptyText}</div>`;
  document.getElementById("recentEliteList").classList.toggle("hidden", recruitmentAnalysisState.historyView !== "portrait");
  document.getElementById("eliteTimelineList").classList.toggle("hidden", recruitmentAnalysisState.historyView !== "timeline");
  document.querySelectorAll("[data-elite-view]").forEach(button => button.classList.toggle("active", button.dataset.eliteView === recruitmentAnalysisState.historyView));
  document.querySelectorAll("[data-elite-filter]").forEach(button => {
    button.classList.toggle("active", button.dataset.eliteFilter === recruitmentAnalysisState.eliteFilter);
    button.disabled = noUpMechanic && button.dataset.eliteFilter !== "all";
  });
  renderEliteEventDetail(history.find(event => event.eventId === recruitmentAnalysisState.selectedEventId));

  const advanced = getAdvancedStats(poolName);
  const worstWithOff = noUpMechanic ? { count: "-", name: "" } : getWorstWithOffRate(poolName);
  document.getElementById("advancedRecordSummary").innerHTML = `<article><span>最歐出貨</span><strong class="luck-positive">${formatPullWithName(advanced.best, advanced.bestName)}</strong></article><article><span>最非出貨</span><strong class="luck-negative">${formatPullWithName(advanced.worst, advanced.worstName)}</strong></article><article><span>最非含歪</span><strong class="luck-warning">${noUpMechanic ? "不適用" : formatPullWithName(worstWithOff.count, worstWithOff.name)}</strong></article>`;
  const poolRecords = getGameRecords(poolName, "oldToNew");
  const compositionDefinitions = [
    { label: "菁英人形", color: "#D89A32", rarity: "橙色", kind: "character" },
    { label: "菁英武器", color: "#C45458", rarity: "橙色", kind: "weapon" },
    { label: "紫色人形", color: "#667BC4", rarity: "紫色", kind: "character" },
    { label: "紫色武器", color: "#65A96B", rarity: "紫色", kind: "weapon" }
  ];
  const composition = compositionDefinitions.map(definition => ({ ...definition, count: poolRecords.filter(record => record.rarity === definition.rarity && getRecruitmentEventVisual(record).kind === definition.kind).length }));
  const compositionTotal = composition.reduce((sum, item) => sum + item.count, 0);
  let compositionOffset = 0;
  const compositionSegments = composition.map(item => {
    const percent = compositionTotal ? item.count / compositionTotal * 100 : 0;
    const offset = compositionOffset;
    compositionOffset += percent;
    return item.count ? `<circle class="composition-segment" cx="80" cy="80" r="58" pathLength="100" fill="none" stroke="${item.color}" stroke-width="28" stroke-dasharray="${percent.toFixed(4)} ${(100 - percent).toFixed(4)}" stroke-dashoffset="${(-offset).toFixed(4)}" data-label="${item.label}" data-count="${item.count}" data-percent="${percent.toFixed(1)}"></circle>` : "";
  }).join("");
  document.getElementById("recruitmentCompositionChart").innerHTML = compositionTotal ? `<div class="composition-donut"><svg viewBox="0 0 160 160" role="img" aria-label="招募結果組成"><circle class="composition-track" cx="80" cy="80" r="58" pathLength="100"></circle><g transform="rotate(-90 80 80)">${compositionSegments}</g></svg><div class="composition-center"><strong>${compositionTotal}</strong><small>有效紀錄</small></div><div class="composition-tooltip" hidden></div></div><div class="composition-legend">${composition.map(item => `<div><i style="background:${item.color}"></i><span>${item.label}</span></div>`).join("")}</div>` : `<div class="analysis-empty-state">尚無可分類的招募紀錄</div>`;

  const upDetails = getCompletedUpDetails(poolName);
  const distributionValues = recruitmentAnalysisState.distributionView === "up" ? upDetails.map(item => item.count) : history.map(item => item.count);
  const eliteDistributionRanges = Array.from({ length: 8 }, (_, index) => ({ label: `${index * 10 + 1}–${(index + 1) * 10}`, min: index * 10 + 1, max: (index + 1) * 10 }));
  const upDistributionRanges = Array.from({ length: 8 }, (_, index) => ({ label: `${index * 20 + 1}–${(index + 1) * 20}`, min: index * 20 + 1, max: (index + 1) * 20 }));
  const distributionRanges = (recruitmentAnalysisState.distributionView === "up" ? upDistributionRanges : eliteDistributionRanges).map(range => ({ ...range, count: distributionValues.filter(value => value >= range.min && value <= range.max).length }));
  const overflowCount = recruitmentAnalysisState.distributionView === "up" ? distributionValues.filter(value => value > 160).length : distributionValues.filter(value => value > 80).length;
  const maxBucket = Math.max(1, ...distributionRanges.map(item => item.count));
  document.getElementById("pullDistributionChart").innerHTML = distributionValues.length ? `<div class="distribution-columns">${distributionRanges.map(item => `<div class="distribution-column"><span>${item.count || ""}</span><div><i style="height:${item.count ? Math.max(9, item.count / maxBucket * 100) : 0}%"></i></div><small>${item.label}</small></div>`).join("")}</div>${overflowCount ? `<p class="distribution-data-warning">有 ${overflowCount} 筆超出${recruitmentAnalysisState.distributionView === "up" ? " 160 抽" : "菁英 80 抽保底"}，請檢查資料完整性或跨期歸屬。</p>` : ""}` : `<div class="analysis-empty-state">${recruitmentAnalysisState.distributionView === "up" ? (noUpMechanic ? "此卡池沒有 UP 機制" : "尚未取得 UP") : "尚無菁英出貨紀錄"}</div>`;
  document.getElementById("distributionChartDescription").textContent = recruitmentAnalysisState.distributionView === "up" ? "每 20 抽一組，顯示至 160 抽（包含途中抽歪）" : "每 10 抽一組，菁英保底上限 80 抽";
  document.querySelectorAll("[data-distribution-view]").forEach(button => button.classList.toggle("active", button.dataset.distributionView === recruitmentAnalysisState.distributionView));
  const details = document.getElementById("advancedAnalysisDetails");
  details.open = recruitmentAnalysisState.advancedExpanded;
  details.querySelector("summary b").textContent = details.open ? "收合" : "展開";
  renderRecruitmentPeriods(poolName, history);
  saveRecruitmentAnalysisPreference();
}

function formatPullWithName(count, name) {
  if (count === "-") {
    return "-";
  }

  return `${name}(${count} 抽)`;
}

function getUpRateStats(poolName) {
  const eliteRecords = getGameRecords(poolName, "oldToNew").filter(record => {
    return record.rarity === "橙色";
  });

  const offRateCount = eliteRecords.filter(isOffRateRecord).length;
  const upCount = eliteRecords.length - offRateCount;

  let upRate = "-";

  if (eliteRecords.length > 0) {
    upRate = ((upCount / eliteRecords.length) * 100).toFixed(1) + "%";
  }

  return {
    eliteCount: eliteRecords.length,
    upCount,
    offRateCount,
    upRate
  };
}

function getUpSummaryText(upStats) {
  if (upStats.eliteCount === 0) {
    return "-";
  }

  return `${upStats.upCount} UP / ${upStats.offRateCount} 歪｜${upStats.upRate}`;
}

function formatAverageValue(value) {
  return value === "-" || value === null || value === undefined ? "—" : `${Number(value).toFixed(1)} 抽`;
}

function applyOverviewSemanticColors() {
  const overviewStats = window.gf2OverviewStats;
  const metricIds = {
    targetBest: "best", weaponBest: "best", standardBest: "best", selectCharBest: "best", selectWeaponBest: "best",
    targetWorst: "worst", weaponWorst: "worst", standardWorst: "worst", selectCharWorst: "worst", selectWeaponWorst: "worst",
    targetWorstWithOffRate: "worstWithOffRate", weaponWorstWithOffRate: "worstWithOffRate",
    selectCharWorstWithOffRate: "worstWithOffRate", selectWeaponWorstWithOffRate: "worstWithOffRate"
  };
  Object.entries(metricIds).forEach(([id, metricType]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.remove("luck-positive", "luck-negative", "luck-warning", "luck-neutral");
    const tone = overviewStats.getLuckTone(metricType);
    element.classList.add(tone.className);
    element.title = tone.label;
  });
  [
    "overallAverage", "overallUpAverage", "overallUpRate", "targetAverage", "targetUpAverage",
    "weaponAverage", "weaponUpAverage", "standardAverage", "selectCharAverage", "selectCharUpAverage",
    "selectWeaponAverage", "selectWeaponUpAverage"
  ].forEach(id => document.getElementById(id)?.classList.add("luck-neutral"));
}

function getWorstWithOffRate(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");

  let countSinceLastUp = 0;
  let worst = "-";
  let worstName = "";

  poolRecords.forEach(record => {
    if (record.summaryOnly && record.pullCount) {
      countSinceLastUp += record.pullCount;
    } else {
      countSinceLastUp++;
    }

    if (record.rarity === "橙色" && !isOffRateRecord(record)) {
      if (worst === "-" || countSinceLastUp > worst) {
        worst = countSinceLastUp;
        worstName = record.name;
      }

      countSinceLastUp = 0;
    }
  });

  return {
    count: worst,
    name: worstName
  };
}

function getStandardEliteTypeStats() {
  const standardRecords = getGameRecords("常規採購", "oldToNew");

  const eliteRecords = standardRecords.filter(record => {
    return record.rarity === "橙色";
  });

  const characterCount = eliteRecords.filter(record => {
    return record.type === "人形" || record.type === "角色";
  }).length;

  const weaponCount = eliteRecords.filter(record => {
    return record.type && record.type.includes("武器");
  }).length;

  return {
    characterCount,
    weaponCount
  };
}

function renderStats() {
  const target = getPoolStats("定向採購");
  const weapon = getPoolStats("軍備提升");
  const standard = getPoolStats("常規採購");
  const selectChar = getPoolStats("自選人形");
  const selectWeapon = getPoolStats("自選武器");

  const targetUpStats = getUpRateStats("定向採購");
  const weaponUpStats = getUpRateStats("軍備提升");
  const selectCharUpStats = getUpRateStats("自選人形");
  const selectWeaponUpStats = getUpRateStats("自選武器");

  const targetAdvanced = getAdvancedStats("定向採購");
  const weaponAdvanced = getAdvancedStats("軍備提升");
  const standardAdvanced = getAdvancedStats("常規採購");
  const selectCharAdvanced = getAdvancedStats("自選人形");
  const selectWeaponAdvanced = getAdvancedStats("自選武器");

  const targetWorstWithOffRate = getWorstWithOffRate("定向採購");
  const weaponWorstWithOffRate = getWorstWithOffRate("軍備提升");
  const selectCharWorstWithOffRate = getWorstWithOffRate("自選人形");
  const selectWeaponWorstWithOffRate = getWorstWithOffRate("自選武器");
  const upCosts = {
    target: getPoolUpCost("定向採購"), weapon: getPoolUpCost("軍備提升"),
    selectChar: getPoolUpCost("自選人形"), selectWeapon: getPoolUpCost("自選武器")
  };


  const standardEliteTypeStats = getStandardEliteTypeStats();
  const overviewStats = window.gf2OverviewStats;
  const summary = overviewStats.computeOverviewSummary(records, getRecordPullCount, isOffRateRecord);
  const overallUpCost = overviewStats.combineCompletedUpCosts(Object.values(upCosts));

  document.getElementById("overallTotal").textContent = summary.totalPulls.toLocaleString();
  document.getElementById("overallOrange").textContent = summary.eliteCount.toLocaleString();
  document.getElementById("overallAverage").textContent = summary.eliteAverage === null
    ? "—" : `${summary.eliteAverage.toFixed(1)} 抽`;
  document.getElementById("overallUpAverage").textContent = overallUpCost.average === null
    ? "—" : `${overallUpCost.average.toFixed(1)} 抽`;
  document.getElementById("overallAverageDetail").textContent = overallUpCost.upCount
    ? `已取得 ${overallUpCost.upCount} 次 UP`
    : "尚未取得 UP";
  document.getElementById("overallUpRate").textContent = summary.upRate === null
    ? "—" : `${(summary.upRate * 100).toFixed(1)}%`;
  document.getElementById("overallUpDetail").textContent = summary.upRate === null
    ? "尚無資料" : `${summary.upCount} UP / ${summary.offRateCount} 歪`;

  document.getElementById("targetTotal").textContent = `${target.total} 抽`;
  document.getElementById("targetOrange").textContent = getEliteRateText(target);
  document.getElementById("targetAverage").textContent = formatAverageValue(targetAdvanced.average);
  document.getElementById("targetUpAverage").textContent = formatAverageValue(upCosts.target.average);
  document.getElementById("targetUpRate").textContent = targetUpStats.eliteCount ? targetUpStats.upRate : "-";
  document.getElementById("targetUpSummary").textContent = targetUpStats.eliteCount ? `${targetUpStats.upCount}／${targetUpStats.offRateCount}` : "-";
  document.getElementById("targetBest").textContent =
    formatPullWithName(targetAdvanced.best, targetAdvanced.bestName);
  document.getElementById("targetWorst").textContent =
    formatPullWithName(targetAdvanced.worst, targetAdvanced.worstName);
  document.getElementById("targetWorstWithOffRate").textContent =
    formatPullWithName(
      targetWorstWithOffRate.count,
      targetWorstWithOffRate.name
    );

  document.getElementById("weaponTotal").textContent = `${weapon.total} 抽`;
  document.getElementById("weaponOrange").textContent = getEliteRateText(weapon);
  document.getElementById("weaponAverage").textContent = formatAverageValue(weaponAdvanced.average);
  document.getElementById("weaponUpAverage").textContent = formatAverageValue(upCosts.weapon.average);
  document.getElementById("weaponUpRate").textContent = weaponUpStats.eliteCount ? weaponUpStats.upRate : "-";
  document.getElementById("weaponUpSummary").textContent = weaponUpStats.eliteCount ? `${weaponUpStats.upCount}／${weaponUpStats.offRateCount}` : "-";
  document.getElementById("weaponBest").textContent =
    formatPullWithName(weaponAdvanced.best, weaponAdvanced.bestName);
  document.getElementById("weaponWorst").textContent =
    formatPullWithName(weaponAdvanced.worst, weaponAdvanced.worstName);
  document.getElementById("weaponWorstWithOffRate").textContent =
    formatPullWithName(
      weaponWorstWithOffRate.count,
      weaponWorstWithOffRate.name
    );

  document.getElementById("standardTotal").textContent = `${standard.total} 抽`;
  document.getElementById("standardOrange").textContent =
    getEliteRateText(standard);
  document.getElementById("standardEliteCharacter").textContent =
    standardEliteTypeStats.characterCount;
  document.getElementById("standardEliteWeapon").textContent =
    standardEliteTypeStats.weaponCount;
  document.getElementById("standardAverage").textContent = formatAverageValue(standardAdvanced.average);
  document.getElementById("standardBest").textContent =
    formatPullWithName(standardAdvanced.best, standardAdvanced.bestName);
  document.getElementById("standardWorst").textContent =
    formatPullWithName(standardAdvanced.worst, standardAdvanced.worstName);

  document.getElementById("selectCharTotal").textContent = `${selectChar.total} 抽`;
  document.getElementById("selectCharOrange").textContent = getEliteRateText(selectChar);
  document.getElementById("selectCharAverage").textContent = formatAverageValue(selectCharAdvanced.average);
  document.getElementById("selectCharUpAverage").textContent = formatAverageValue(upCosts.selectChar.average);
  document.getElementById("selectCharUpRate").textContent = selectCharUpStats.eliteCount ? selectCharUpStats.upRate : "-";
  document.getElementById("selectCharUpSummary").textContent = selectCharUpStats.eliteCount ? `${selectCharUpStats.upCount}／${selectCharUpStats.offRateCount}` : "-";
  document.getElementById("selectCharBest").textContent =
    formatPullWithName(selectCharAdvanced.best, selectCharAdvanced.bestName);
  document.getElementById("selectCharWorst").textContent =
    formatPullWithName(selectCharAdvanced.worst, selectCharAdvanced.worstName);
  document.getElementById("selectCharWorstWithOffRate").textContent =
    formatPullWithName(
      selectCharWorstWithOffRate.count,
      selectCharWorstWithOffRate.name
    );

  document.getElementById("selectWeaponTotal").textContent = `${selectWeapon.total} 抽`;
  document.getElementById("selectWeaponOrange").textContent = getEliteRateText(selectWeapon);
  document.getElementById("selectWeaponAverage").textContent = formatAverageValue(selectWeaponAdvanced.average);
  document.getElementById("selectWeaponUpAverage").textContent = formatAverageValue(upCosts.selectWeapon.average);
  document.getElementById("selectWeaponUpRate").textContent = selectWeaponUpStats.eliteCount ? selectWeaponUpStats.upRate : "-";
  document.getElementById("selectWeaponUpSummary").textContent = selectWeaponUpStats.eliteCount ? `${selectWeaponUpStats.upCount}／${selectWeaponUpStats.offRateCount}` : "-";
  document.getElementById("selectWeaponBest").textContent =
    formatPullWithName(selectWeaponAdvanced.best, selectWeaponAdvanced.bestName);
  document.getElementById("selectWeaponWorst").textContent =
    formatPullWithName(selectWeaponAdvanced.worst, selectWeaponAdvanced.worstName);
  document.getElementById("selectWeaponWorstWithOffRate").textContent =
    formatPullWithName(
      selectWeaponWorstWithOffRate.count,
      selectWeaponWorstWithOffRate.name
    );
  applyOverviewSemanticColors();
}

function renderOrangeHistoryBlock(elementId, poolName) {
  const container = document.getElementById(elementId);
  if (!container) return;
  const result = getOrangeHistory(poolName);
  const poolStats = getPoolStats(poolName);
  const advancedStats = getAdvancedStats(poolName);
  const upStats = getUpRateStats(poolName);
  const isStandardPool = poolName === "常規採購";

  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "history-summary";
  summary.innerHTML = `
    <div class="history-summary-primary">
      <span>目前墊抽</span>
      <strong>${result.currentPity}<small> 抽</small></strong>
    </div>
    <div class="history-summary-metrics">
      <div><span>總抽數</span><strong>${poolStats.total.toLocaleString()}</strong></div>
      <div><span>菁英機率</span><strong>${poolStats.total ? ((poolStats.elite / poolStats.total) * 100).toFixed(1) + "%" : "-"}</strong><small>${poolStats.elite} 位菁英</small></div>
      <div><span>平均出橙</span><strong>${advancedStats.average === "-" ? "-" : advancedStats.average + " 抽"}</strong><small>不含目前墊抽</small></div>
      <div><span>UP 率</span><strong>${isStandardPool ? "不適用" : upStats.upRate}</strong><small>${isStandardPool ? "常駐池無 UP" : `${upStats.upCount} UP／${upStats.offRateCount} 歪`}</small></div>
    </div>
  `;
  container.appendChild(summary);

  const timeline = document.createElement("div");
  timeline.className = "orange-timeline";

  const current = document.createElement("div");
  current.className = "timeline-item timeline-current";
  current.innerHTML = `
    <span class="timeline-pulls">${result.currentPity} 抽</span>
    <span class="timeline-name">目前墊池</span>
  `;
  timeline.appendChild(current);

  if (result.history.length === 0) {
    container.appendChild(timeline);
    return;
  }

  const displayHistory = [...result.history].reverse();

  displayHistory.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "timeline-item";

    if (index === 0) {
      div.classList.add("timeline-latest");
    }

    if (index === 0 && result.currentPity === 0) {
      div.classList.add("timeline-current");
    }

    const offRateText = item.isOffRate
      ? `<span class="off-rate-label">歪</span>`
      : "";

    div.innerHTML = `
      <span class="timeline-pulls">${item.count} 抽</span>
      <span class="timeline-name">${escapeHtml(item.name)}</span>
      ${offRateText}
      <span class="timeline-time">${item.time}</span>
    `;

    timeline.appendChild(div);
  });

  container.appendChild(timeline);
}

function renderOrangeHistory() {
  renderOrangeHistoryBlock("targetOrangeHistory", "定向採購");
  renderOrangeHistoryBlock("weaponOrangeHistory", "軍備提升");
  renderOrangeHistoryBlock("standardOrangeHistory", "常規採購");
  const selectCharBlock = document.getElementById("selectCharOrangeHistory");
  if (selectCharBlock) {
    renderOrangeHistoryBlock("selectCharOrangeHistory", "自選人形");
  }

  const selectWeaponBlock = document.getElementById("selectWeaponOrangeHistory");
  if (selectWeaponBlock) {
    renderOrangeHistoryBlock("selectWeaponOrangeHistory", "自選武器");
  }
  renderRecruitmentAnalysis();
}

function getMaxConsecutiveUp(poolName) {
  const eliteRecords = getGameRecords(poolName, "oldToNew").filter(record => {
    return record.rarity === "橙色";
  });

  let current = 0;
  let max = 0;

  eliteRecords.forEach(record => {
    if (isOffRateRecord(record)) {
      current = 0;
    } else {
      current++;
      max = Math.max(max, current);
    }
  });

  return max;
}

function getMaxConsecutiveOffRate(poolName) {
  const eliteRecords = getGameRecords(poolName, "oldToNew").filter(record => {
    return record.rarity === "橙色";
  });

  let current = 0;
  let max = 0;
  let guaranteed = false;

  eliteRecords.forEach(record => {
    if (isOffRateRecord(record)) {
      current++;
      max = Math.max(max, current);
      guaranteed = true;
    } else if (guaranteed) {
      // This UP is the guaranteed result after losing the previous 50/50.
      // It does not end the consecutive small-pity loss streak.
      guaranteed = false;
    } else {
      // Winning an UP on small pity ends the loss streak.
      current = 0;
    }
  });

  return max;
}

function getEggText(count) {
  switch (count) {
    case 0: return "0";
    case 1: return "單菁英";
    case 2: return "初入歐洲 雙菁英";
    case 3: return "歐氣爆發 三菁英";
    case 4: return "歐皇降臨 四菁英";
    case 5: return "歐洲之神 五菁英";
    case 6: return "命運之子 六菁英";
    default: return `工程師別裝了 ${count} 菁英`;
  }
}

function getMaxEliteInBatch(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew")
    .filter(record => !record.summaryOnly);

  const groupMap = new Map();

  poolRecords.forEach(record => {
    const key = `${record.source}_${record.time}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }

    groupMap.get(key).push(record);
  });

  let maxElite = 0;
  let maxNames = [];

  for (const group of groupMap.values()) {
    const eliteRecords = group.filter(record => {
      return record.rarity === "橙色";
    });

    if (eliteRecords.length > maxElite) {
      maxElite = eliteRecords.length;
      maxNames = eliteRecords.map(record => record.name);
    }
  }

  return {
    count: maxElite,
    text: getEggText(maxElite),
    names: maxNames
  };
}

function formatEliteBatch(record) {
  if (record.count <= 1) {
    return "時機未到";
  }

  return `
    <div class="elite-title">${record.text}</div>
    <div class="elite-names">${record.names.join("、")}</div>
  `;
}

function renderSpecialRecords() {
  const targetMaxUpStreak = getMaxConsecutiveUp("定向採購");
  const weaponMaxUpStreak = getMaxConsecutiveUp("軍備提升");
  const selectCharMaxUpStreak = getMaxConsecutiveUp("自選人形");
  const selectWeaponMaxUpStreak = getMaxConsecutiveUp("自選武器");
  const targetMaxOffStreak = getMaxConsecutiveOffRate("定向採購");
  const weaponMaxOffStreak = getMaxConsecutiveOffRate("軍備提升");
  const selectCharMaxOffStreak = getMaxConsecutiveOffRate("自選人形");
  const selectWeaponMaxOffStreak = getMaxConsecutiveOffRate("自選武器");

  const targetMaxEliteBatch = getMaxEliteInBatch("定向採購");
  const weaponMaxEliteBatch = getMaxEliteInBatch("軍備提升");
  const standardMaxEliteBatch = getMaxEliteInBatch("常規採購");
  const selectCharMaxEliteBatch = getMaxEliteInBatch("自選人形");
  const selectWeaponMaxEliteBatch = getMaxEliteInBatch("自選武器");

  document.getElementById("targetMaxUpStreak").textContent =
    targetMaxUpStreak > 0 ? `${targetMaxUpStreak} 次` : "-";

  document.getElementById("weaponMaxUpStreak").textContent =
    weaponMaxUpStreak > 0 ? `${weaponMaxUpStreak} 次` : "-";

  document.getElementById("targetMaxOffStreak").textContent =
    targetMaxOffStreak > 0 ? `${targetMaxOffStreak} 次` : "-";

  document.getElementById("weaponMaxOffStreak").textContent =
    weaponMaxOffStreak > 0 ? `${weaponMaxOffStreak} 次` : "-";

  document.getElementById("targetMaxEliteBatch").innerHTML =
    formatEliteBatch(targetMaxEliteBatch);

  document.getElementById("weaponMaxEliteBatch").innerHTML =
    formatEliteBatch(weaponMaxEliteBatch);

  document.getElementById("standardMaxEliteBatch").innerHTML =
    formatEliteBatch(standardMaxEliteBatch);

  document.getElementById("selectCharMaxUpStreak").textContent =
    selectCharMaxUpStreak > 0 ? `${selectCharMaxUpStreak} 次` : "-";

  document.getElementById("selectWeaponMaxUpStreak").textContent =
    selectWeaponMaxUpStreak > 0 ? `${selectWeaponMaxUpStreak} 次` : "-";

  document.getElementById("selectCharMaxOffStreak").textContent =
    selectCharMaxOffStreak > 0 ? `${selectCharMaxOffStreak} 次` : "-";

  document.getElementById("selectWeaponMaxOffStreak").textContent =
    selectWeaponMaxOffStreak > 0 ? `${selectWeaponMaxOffStreak} 次` : "-";

  document.getElementById("selectCharMaxEliteBatch").innerHTML =
    formatEliteBatch(selectCharMaxEliteBatch);

  document.getElementById("selectWeaponMaxEliteBatch").innerHTML =
    formatEliteBatch(selectWeaponMaxEliteBatch);

  renderSpecialHighlights();
  renderMilestoneRecords();
  renderSpecialRankings();
}

function renderSpecialHighlights() {
  const container = document.getElementById("specialHighlights");
  if (!container) return;

  const poolNames = ["定向採購", "軍備提升", "常規採購", "自選人形", "自選武器"];
  const eliteResults = poolNames.flatMap(poolName =>
    getOrangeHistory(poolName).history.map(item => ({ ...item, poolName }))
  );
  const instantCount = eliteResults.filter(item => item.count === 1).length;
  const miracleCount = eliteResults.filter(item => item.count <= 10).length;
  const clutchCount = eliteResults.filter(item => item.count >= 60).length;
  const visitorCounts = new Map();
  eliteResults.forEach(item => visitorCounts.set(item.name, (visitorCounts.get(item.name) || 0) + 1));
  const favoriteVisitor = [...visitorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))[0];

  const cards = [
    ["一發入魂", `${instantCount} 次`, "第 1 抽直接出現", "01"],
    ["十抽奇蹟", `${miracleCount} 次`, "10 抽內迎來菁英", "10"],
    ["驚險壓線", `${clutchCount} 次`, "第 60 抽後才報到", "60+"],
    ["最常來訪", favoriteVisitor ? favoriteVisitor[0] : "尚無紀錄", favoriteVisitor ? `共相遇 ${favoriteVisitor[1]} 次` : "等待第一次相遇", "VIP"]
  ];

  container.innerHTML = cards.map(([title, value, note, code]) => `
    <article class="highlight-card">
      <span class="highlight-code">${code}</span>
      <small>${title}</small>
      <strong>${escapeHtml(value)}</strong>
      <p>${note}</p>
    </article>
  `).join("");
}

function renderRankingCard(title, subtitle, rows, valueFormatter) {
  const body = rows.length > 0
    ? rows.map((row, index) => `
      <li>
        <span class="ranking-position">${index + 1}</span>
        <div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.detail || "")}</small></div>
        <b>${escapeHtml(valueFormatter(row))}</b>
      </li>`).join("")
    : `<li class="ranking-empty">尚無足夠紀錄</li>`;

  return `<article class="ranking-card">
    <header><div><h3>${title}</h3><small>${subtitle}</small></div><span>TOP 5</span></header>
    <ol>${body}</ol>
  </article>`;
}

function getUpJourneyHistory(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");
  const journeys = [];
  let pullsSinceLastUp = 0;
  let offRateCount = 0;

  poolRecords.forEach(record => {
    pullsSinceLastUp += getRecordPullCount(record);

    if (record.rarity !== "橙色") return;
    if (isOffRateRecord(record)) {
      offRateCount++;
      return;
    }

    journeys.push({
      name: record.name,
      count: pullsSinceLastUp,
      offRateCount,
      time: record.time,
      detail: `${poolName}｜${offRateCount > 0 ? `含 ${offRateCount} 次抽歪` : "未抽歪"}`
    });
    pullsSinceLastUp = 0;
    offRateCount = 0;
  });

  return journeys;
}

function renderSpecialRankings() {
  const container = document.getElementById("specialRankings");
  if (!container) return;

  const poolNames = ["定向採購", "軍備提升", "常規採購", "自選人形", "自選武器"];
  const eliteResults = poolNames.flatMap(poolName => {
    return getOrangeHistory(poolName).history.map(item => ({
      ...item,
      detail: `${poolName}｜${String(item.time || "").split(" ")[0] || "-"}`
    }));
  });
  const fastest = [...eliteResults].sort((a, b) => a.count - b.count || new Date(b.time) - new Date(a.time)).slice(0, 5);
  const upJourneys = ["定向採購", "軍備提升", "自選人形", "自選武器"]
    .flatMap(getUpJourneyHistory);
  const slowest = [...upJourneys]
    .sort((a, b) => b.count - a.count || b.offRateCount - a.offRateCount || new Date(b.time) - new Date(a.time))
    .slice(0, 5);

  const offRateCounts = new Map();
  ["定向採購", "軍備提升", "自選人形", "自選武器"].forEach(poolName => {
    getGameRecords(poolName, "oldToNew")
      .filter(record => !record.summaryOnly && isOffRateRecord(record))
      .forEach(record => {
        const key = `${poolName}\u0000${record.name}`;
        const current = offRateCounts.get(key) || { name: record.name, detail: poolName, count: 0 };
        current.count++;
        offRateCounts.set(key, current);
      });
  });
  const offRateRanking = [...offRateCounts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"))
    .slice(0, 5);

  const investmentRanking = getCombinedLoadoutStats()
    .filter(item => item.currentTotalPulls > 0)
    .map(item => {
      const vertebra = Math.max(0, Math.min(6, item.character.upCount - 1));
      const tuning = Math.max(0, Math.min(6, item.signature?.upCount || 0));
      return {
        name: item.character.name,
        detail: `${vertebra} 椎＋專武調校 ${tuning} 等`,
        count: item.currentTotalPulls
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  container.innerHTML = [
    renderRankingCard("閃電出貨", "最短等待便迎來菁英", fastest, row => `${row.count} 抽`),
    renderRankingCard("壓線登場", "含抽歪在內，等到 UP 的最長旅程", slowest, row => `${row.count} 抽`),
    renderRankingCard("常駐之緣", "含定向、軍備與自選池的常駐來訪", offRateRanking, row => `${row.count} 次`),
    renderRankingCard("真愛投入榜", "目前人形與專武累積總抽數", investmentRanking, row => `${row.count} 抽`)
  ].join("");
}

function formatMilestoneRecord(item, pullKey) {
  if (!item) return "尚無完成紀錄";
  return `${item.character.name}＋${item.signatureName}　${item[pullKey]} 抽`;
}

function renderMilestoneRecords() {
  const combinedStats = getCombinedLoadoutStats();
  const sixPlusOne = combinedStats
    .filter(item => item.completed)
    .sort((a, b) => a.sixPlusOnePulls - b.sixPlusOnePulls);
  const sixPlusSix = combinedStats
    .filter(item => item.sixPlusSixCompleted)
    .sort((a, b) => a.sixPlusSixPulls - b.sixPlusSixPulls);

  document.getElementById("bestSixPlusOne").textContent =
    formatMilestoneRecord(sixPlusOne[0], "sixPlusOnePulls");
  document.getElementById("worstSixPlusOne").textContent =
    formatMilestoneRecord(sixPlusOne.at(-1), "sixPlusOnePulls");
  document.getElementById("bestSixPlusSix").textContent =
    formatMilestoneRecord(sixPlusSix[0], "sixPlusSixPulls");
  document.getElementById("worstSixPlusSix").textContent =
    formatMilestoneRecord(sixPlusSix.at(-1), "sixPlusSixPulls");
}
async function loadRecords() {
  const itemMapPromise = typeof window.gf2API.loadItemMap === "function"
    ? window.gf2API.loadItemMap().catch(error => {
        console.error("讀取道具資料表失敗：", error);
        return {};
      })
    : Promise.resolve({});
  const signatureMapPromise = typeof window.gf2API.loadSignatureMap === "function"
    ? window.gf2API.loadSignatureMap().catch(error => {
        console.error("讀取專武對照表失敗：", error);
        return {};
      })
    : Promise.resolve({});
  const characterArtMapPromise = typeof window.gf2API.loadCharacterArtMap === "function"
    ? window.gf2API.loadCharacterArtMap().catch(error => {
        console.error("讀取角色美術對照表失敗：", error);
        return { roles: {}, wallpapers: {} };
      })
    : Promise.resolve({ roles: {}, wallpapers: {} });
  const weaponArtMapPromise = typeof window.gf2API.loadWeaponArtMap === "function"
    ? window.gf2API.loadWeaponArtMap().catch(error => {
        console.error("讀取專武美術對照表失敗：", error);
        return { weapons: {} };
      })
    : Promise.resolve({ weapons: {} });
  const outfitPoolMapPromise = typeof window.gf2API.loadOutfitPoolMap === "function"
    ? window.gf2API.loadOutfitPoolMap().catch(error => {
        console.error("讀取服裝池對照表失敗：", error);
        return { pools: {} };
      })
    : Promise.resolve({ pools: {} });
  const poolMapPromise = typeof window.gf2API.loadPoolMap === "function"
    ? window.gf2API.loadPoolMap().catch(error => {
        console.error("讀取卡池對照表失敗：", error);
        return { pools: [] };
      })
    : Promise.resolve({ pools: [] });

  [records, externalAcquisitions, itemMap, signatureMap, characterArtMap, weaponArtMap, outfitPoolMap, poolMap] = await Promise.all([
    window.gf2API.loadRecords(),
    window.gf2API.loadExternalAcquisitions(),
    itemMapPromise,
    signatureMapPromise,
    characterArtMapPromise,
    weaponArtMapPromise,
    outfitPoolMapPromise,
    poolMapPromise
  ]);
  if (!Array.isArray(externalAcquisitions)) externalAcquisitions = [];
  records.forEach(record => {
    refreshRecordMetadata(record);
    normalizeSpecialRecruitRecord(record);
  });
  normalizeRecordIds();
  sortRecordsByTime();
  await window.gf2API.saveRecords(records);

  renderRecords();
  renderStats();
  renderSpecialRecords();
  renderOrangeHistory();
  renderTargetCharacterStats();
  renderAppearanceAnalysis();
  updateStatsDate();
}

async function loadConfigToUI() {
  const config = await window.gf2API.loadConfig();

  const gachaUrlInput = document.getElementById("gachaUrlInput");
  const accessTokenInput = document.getElementById("accessTokenInput");
  const configStatus = document.getElementById("configStatus");

  gachaUrlInput.value = "";
  accessTokenInput.value = "";
  accessTokenInput.type = "password";
  accessTokenInput.placeholder = "Authorization / AccessToken";

  if (config.gachaUrl) {
    gachaUrlInput.value = config.gachaUrl;
  }

  if (config.accessToken) {
    accessTokenInput.value = "";
    accessTokenInput.type = "password";
    accessTokenInput.placeholder = "已儲存 Authorization；需更新時重新貼上";
  }

  if (config.gachaUrl && config.accessToken) {
    configStatus.textContent = "已儲存同步資訊，可直接正式同步。";
  } else if (config.gachaUrl) {
    configStatus.textContent = "已儲存 gachaUrl，尚未儲存 Authorization。";
  } else {
    configStatus.textContent = "尚未設定同步資訊。";
  }
}

async function refreshAccountSwitcher() {
  const state = await window.gf2API.listAccounts();
  const active = state.accounts.find(account => account.id === state.activeAccountId) || state.accounts[0];
  const label = document.getElementById("activeAccountLabel");
  const meta = document.getElementById("activeAccountMeta");
  if (active) {
    label.textContent = active.name || active.uid;
    meta.textContent = `${active.server} · ${active.uid}`;
  }

  const list = document.getElementById("accountList");
  list.innerHTML = "";
  state.accounts.forEach(account => {
    const item = document.createElement("article");
    item.className = `account-list-item${account.id === state.activeAccountId ? " active" : ""}`;
    item.innerHTML = `<button class="account-select-action"><span><strong>${escapeHtml(account.name || account.uid)}</strong><small>${escapeHtml(account.server)} · UID ${escapeHtml(account.uid)} · ${account.recordCount.toLocaleString()} 筆</small></span><b>${account.id === state.activeAccountId ? "使用中" : "切換 ›"}</b></button><div class="account-item-actions"><button class="account-edit-btn">編輯</button><button class="account-delete-btn">移除</button></div>`;
    item.querySelector(".account-select-action").addEventListener("click", async () => {
      if (account.id === state.activeAccountId) return;
      await window.gf2API.switchAccount(account.id);
      currentRecordPage = 1;
      currentPoolFilter = "全部";
      document.getElementById("recordPoolFilter").value = "全部";
      await loadRecords();
      await loadConfigToUI();
      await refreshAccountSwitcher();
      closeAccountModal();
    });
    item.querySelector(".account-edit-btn").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openAccountEditModal(account);
    });
    item.querySelector(".account-delete-btn").addEventListener("click", async () => {
      const confirmed = confirm(`確定要永久移除帳號「${account.name || account.uid}」嗎？\n\n將刪除該帳號的 ${account.recordCount.toLocaleString()} 筆紀錄與同步設定，且不會自動備份。\n\n若要保留資料，請先取消、切換至此帳號，再使用「匯出 JSON」。`);
      if (!confirmed) return;
      try {
        const result = await window.gf2API.deleteAccount(account.id);
        if (result.activeChanged) {
          currentRecordPage = 1;
          currentPoolFilter = "全部";
          document.getElementById("recordPoolFilter").value = "全部";
          await loadRecords();
          await loadConfigToUI();
        }
        await refreshAccountSwitcher();
        resetAccountEditor();
        document.getElementById("accountEditorStatus").textContent = "帳號已移除。";
      } catch (error) {
        alert(`移除帳號失敗：${error.message}`);
      }
    });
    list.appendChild(item);
  });
}

function openAccountModal() {
  const modal = document.getElementById("accountModal");
  modal.classList.remove("hidden");
  void modal.offsetHeight;
  resetAccountEditor(false);
}

function openAccountEditModal(account) {
  editingAccountId = account.id;
  const serverInput = document.getElementById("editAccountServerInput");
  const hasServer = [...serverInput.options].some(option => option.value === account.server);
  if (!hasServer) serverInput.add(new Option(account.server, account.server));
  serverInput.value = account.server;
  document.getElementById("editAccountUidInput").value = account.uid;
  document.getElementById("editAccountNameInput").value = account.name || "";
  const modal = document.getElementById("accountEditModal");
  modal.classList.remove("hidden");
  void modal.offsetHeight;
  setTimeout(() => {
    const input = document.getElementById("editAccountUidInput");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 30);
}

function closeAccountEditModal() {
  editingAccountId = null;
  document.getElementById("accountEditModal").classList.add("hidden");
}

function resetAccountEditor(clearValues = true) {
  ["accountServerInput", "accountUidInput", "accountNameInput"].forEach(id => {
    const field = document.getElementById(id);
    field.disabled = false;
    field.readOnly = false;
    field.tabIndex = 0;
    field.style.pointerEvents = "auto";
    if (clearValues && id !== "accountServerInput") field.value = "";
  });
  document.getElementById("createAccountBtn").disabled = false;
  setTimeout(() => {
    const uidInput = document.getElementById("accountUidInput");
    uidInput.focus();
    uidInput.click();
  }, 30);
}

function closeAccountModal() {
  if (document.getElementById("accountModal").contains(document.activeElement)) {
    document.activeElement.blur();
  }
  document.getElementById("accountModal").classList.add("hidden");
}

const externalSourceLabels = {
  anniversary_select: "周年／活動自選",
  package: "禮包購買",
  event_gift: "活動贈送",
  shop_exchange: "商店兌換",
  compensation: "補償",
  other: "其他"
};

const BRAND_LOGO_PREF_KEY = "gf2gt.ui.brandLogo";
const brandLogoOptions = [
  { id: "02", label: "OTs-14", src: "../assets/logos/GF2GT_02_Ash_Hood.png" },
  { id: "03", label: "芙鈴", src: "../assets/logos/GF2GT_03_Fox_Ears.png" },
  { id: "04", label: "克萊妲", src: "../assets/logos/GF2GT_04_Lavender_Hair.png" },
  { id: "05", label: "阿斯緹亞", src: "../assets/logos/GF2GT_05_Pink_Hair_Gear.png" },
  { id: "06", label: "伊格蕾塔", src: "../assets/logos/GF2GT_06_Owl_Charm.png" },
  { id: "07", label: "希麗雅", src: "../assets/logos/GF2GT_07_Maroon_Beret.png" },
  { id: "08", label: "代理人", src: "../assets/logos/GF2GT_08_Black_Hair_Maid.png" },
  { id: "09", label: "針", src: "../assets/logos/GF2GT_09_Blonde_Red_Jacket.png" },
  { id: "10", label: "破壞者", src: "../assets/logos/GF2GT_10_Twin_Cannons.png" }
];

function getSelectedBrandLogoId() {
  try {
    const saved = localStorage.getItem(BRAND_LOGO_PREF_KEY);
    return brandLogoOptions.some(option => option.id === saved) ? saved : "02";
  } catch (_) {
    return "02";
  }
}

function applyBrandLogo(id) {
  const option = brandLogoOptions.find(item => item.id === id) || brandLogoOptions[0];
  const image = document.getElementById("activeBrandLogo");
  image.src = option.src;
  image.alt = `GF2GT ${option.label}`;
  document.querySelectorAll("[data-brand-logo]").forEach(button => {
    const active = button.dataset.brandLogo === option.id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function closeBrandLogoModal() {
  document.getElementById("brandLogoModal").classList.add("hidden");
}

function openBrandLogoModal() {
  applyBrandLogo(getSelectedBrandLogoId());
  document.getElementById("brandLogoModal").classList.remove("hidden");
  requestAnimationFrame(() => document.querySelector("[data-brand-logo].active")?.focus());
}

function initBrandLogoSelector() {
  const grid = document.getElementById("brandLogoGrid");
  grid.innerHTML = brandLogoOptions.map(option => `<button class="brand-logo-option" type="button" data-brand-logo="${option.id}" aria-pressed="false"><img src="${option.src}" alt=""><span>${escapeHtml(option.label)}</span></button>`).join("");
  applyBrandLogo(getSelectedBrandLogoId());
  document.getElementById("brandLogoButton").addEventListener("click", openBrandLogoModal);
  document.getElementById("closeBrandLogoBtn").addEventListener("click", closeBrandLogoModal);
  document.querySelector("[data-close-brand-logo]").addEventListener("click", closeBrandLogoModal);
  grid.addEventListener("click", event => {
    const button = event.target.closest("[data-brand-logo]");
    if (!button) return;
    try { localStorage.setItem(BRAND_LOGO_PREF_KEY, button.dataset.brandLogo); } catch (_) {}
    applyBrandLogo(button.dataset.brandLogo);
    closeBrandLogoModal();
    showToast("已更換 GF2GT Logo", "success", 1800);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.getElementById("brandLogoModal").classList.contains("hidden")) closeBrandLogoModal();
  });
}

function getExternalItemNames(itemType) {
  const expectedType = itemType === "weapon" ? "武器" : "人形";
  const names = itemType === "weapon"
    ? Object.values(signatureMap || {})
    : Object.keys(signatureMap || {});
  const generalSources = new Set(["定向採購", "軍備提升", "常規採購", "新手採購", "自選人形", "自選武器"]);
  records.forEach(record => {
    const mappedItem = itemMap[String(record.itemId)] || itemMap[record.itemId];
    if (generalSources.has(record.source) && record.rarity === "橙色" && mappedItem?.type === expectedType) names.push(record.name);
  });
  return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function refreshExternalItemOptions() {
  const type = document.getElementById("externalItemType").value;
  const select = document.getElementById("externalItemName");
  select.innerHTML = `<option value="" disabled selected>請選擇${type === "weapon" ? "菁英武器" : "菁英人形"}</option>` + getExternalItemNames(type)
    .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
}

function renderExternalAcquisitions() {
  const list = document.getElementById("externalAcquisitionList");
  document.getElementById("externalAcquisitionCount").textContent = `${externalAcquisitions.length} 筆`;
  if (!externalAcquisitions.length) {
    list.innerHTML = `<div class="external-acquisition-empty">尚未登記禮包、自選或活動取得項目</div>`;
    return;
  }
  const sorted = [...externalAcquisitions].sort((a, b) => String(b.acquiredAt || b.createdAt || "").localeCompare(String(a.acquiredAt || a.createdAt || "")));
  list.innerHTML = sorted.map(entry => `<article class="external-acquisition-item"><div><strong>${escapeHtml(entry.itemName)}</strong><span>${entry.itemType === "weapon" ? "武器" : "人形"} · ${escapeHtml(externalSourceLabels[entry.sourceType] || entry.sourceLabel || "其他")}</span><small>${escapeHtml(entry.acquiredAt || "未填日期")}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</small></div><b>＋${Number(entry.quantity) || 1}</b><button type="button" data-delete-external="${escapeHtml(entry.id)}">移除</button></article>`).join("");
}

function openExternalAcquisitionModal() {
  refreshExternalItemOptions();
  renderExternalAcquisitions();
  document.getElementById("externalAcquisitionModal").classList.remove("hidden");
  requestAnimationFrame(() => document.getElementById("externalItemName").focus());
}

function closeExternalAcquisitionModal() {
  document.getElementById("externalAcquisitionModal").classList.add("hidden");
}

async function saveExternalAcquisitionEntries() {
  await window.gf2API.saveExternalAcquisitions(externalAcquisitions);
  renderExternalAcquisitions();
  renderTargetCharacterStats();
}

function initExternalAcquisitionUI() {
  document.getElementById("externalItemType").addEventListener("change", refreshExternalItemOptions);
  document.getElementById("closeExternalAcquisitionBtn").addEventListener("click", closeExternalAcquisitionModal);
  document.querySelector("[data-close-external-acquisition]").addEventListener("click", closeExternalAcquisitionModal);
  document.getElementById("externalAcquisitionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const itemType = document.getElementById("externalItemType").value;
    const itemName = document.getElementById("externalItemName").value.trim();
    const quantity = Math.max(1, Math.min(20, Number(document.getElementById("externalQuantity").value) || 1));
    if (!getExternalItemNames(itemType).includes(itemName)) {
      alert("請從已知的人形或武器名稱中選擇，避免名稱錯字造成重複項目。");
      return;
    }
    externalAcquisitions.push({
      id: `external_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      itemType,
      itemName,
      quantity,
      sourceType: document.getElementById("externalSourceType").value,
      acquiredAt: document.getElementById("externalAcquiredAt").value,
      note: document.getElementById("externalNote").value.trim(),
      createdAt: new Date().toISOString()
    });
    await saveExternalAcquisitionEntries();
    event.currentTarget.reset();
    document.getElementById("externalQuantity").value = "1";
    refreshExternalItemOptions();
    showToast("已新增額外取得；抽卡統計不受影響", "success", 2600);
  });
  document.getElementById("externalAcquisitionList").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-external]");
    if (!button) return;
    const entry = externalAcquisitions.find(item => item.id === button.dataset.deleteExternal);
    if (!entry || !confirm(`確定移除「${entry.itemName}」的額外取得紀錄嗎？\n抽卡紀錄不會受到影響。`)) return;
    externalAcquisitions = externalAcquisitions.filter(item => item.id !== entry.id);
    await saveExternalAcquisitionEntries();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.getElementById("externalAcquisitionModal").classList.contains("hidden")) closeExternalAcquisitionModal();
  });
}

document.getElementById("accountSwitcherBtn").addEventListener("click", async () => {
  await refreshAccountSwitcher();
  openAccountModal();
});
document.getElementById("closeAccountModalBtn").addEventListener("click", closeAccountModal);
document.querySelector("[data-close-account-modal]").addEventListener("click", closeAccountModal);
document.getElementById("closeAccountEditBtn").addEventListener("click", closeAccountEditModal);
document.getElementById("cancelAccountEditBtn").addEventListener("click", closeAccountEditModal);
document.querySelector("[data-close-account-edit]").addEventListener("click", closeAccountEditModal);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.getElementById("accountEditModal").classList.contains("hidden")) {
    closeAccountEditModal();
    return;
  }
  if (event.key === "Escape" && !document.getElementById("accountModal").classList.contains("hidden")) {
    closeAccountModal();
  }
});
document.getElementById("createAccountBtn").addEventListener("click", async () => {
  const server = document.getElementById("accountServerInput").value;
  const uid = document.getElementById("accountUidInput").value.trim();
  const name = document.getElementById("accountNameInput").value.trim();
  if (!uid) {
    alert("請輸入 UID");
    return;
  }
  try {
    await window.gf2API.createAccount({ server, uid, name });
    document.getElementById("accountUidInput").value = "";
    document.getElementById("accountNameInput").value = "";
    currentRecordPage = 1;
    currentPoolFilter = "全部";
    document.getElementById("recordPoolFilter").value = "全部";
    await loadRecords();
    await loadConfigToUI();
    await refreshAccountSwitcher();
    resetAccountEditor();
    document.getElementById("accountEditorStatus").textContent = "帳號已建立並切換，可繼續輸入下一組帳號。";
  } catch (error) {
    alert(`建立帳號失敗：${error.message}`);
  }
});
document.getElementById("saveAccountEditBtn").addEventListener("click", async () => {
  const server = document.getElementById("editAccountServerInput").value;
  const uid = document.getElementById("editAccountUidInput").value.trim();
  const name = document.getElementById("editAccountNameInput").value.trim();
  if (!editingAccountId) {
    alert("請先在帳號列表按「編輯」");
    return;
  }
  if (!uid) {
    alert("請輸入 UID");
    return;
  }
  if (!confirm("確定要儲存這個帳號的伺服器、UID 與名稱嗎？\n抽卡紀錄與同步設定會完整保留。")) return;
  try {
    await window.gf2API.updateAccount(editingAccountId, { server, uid, name });
    closeAccountEditModal();
    await refreshAccountSwitcher();
    document.getElementById("accountEditorStatus").textContent = "帳號資料已更新。";
  } catch (error) {
    alert(`更新帳號失敗：${error.message}`);
  }
});

document.getElementById("saveSyncConfigBtn").addEventListener("click", async () => {
  const oldConfig = await window.gf2API.loadConfig();

  const gachaUrl =
    document.getElementById("gachaUrlInput").value.trim();

  const accessToken =
    document.getElementById("accessTokenInput").value.trim();

  if (!gachaUrl && !oldConfig.gachaUrl) {
    alert("請輸入 gachaUrl");
    return;
  }

  if (!accessToken && !oldConfig.accessToken) {
    alert("請輸入 Authorization / AccessToken");
    return;
  }

  const newConfig = {
    ...oldConfig,
    gachaUrl: gachaUrl || oldConfig.gachaUrl,
    accessToken: accessToken || oldConfig.accessToken
  };

  await window.gf2API.saveConfig(newConfig);

  document.getElementById("accessTokenInput").value = "";

  alert("同步設定已儲存 / 更新");

  await loadConfigToUI();
  document.getElementById("syncSettingPanel").classList.add("hidden");
});

document.getElementById("importBtn").addEventListener("click", async () => {
  try {
    const parsedData = await window.gf2API.importRecords();

    if (!parsedData) {
      return;
    }

    let importedRecords = [];
    let importDescription = "本程式備份";
    const gfl2HelpImport = normalizeGfl2HelpImport(parsedData);

    if (gfl2HelpImport?.canceled) return;

    if (gfl2HelpImport) {
      importedRecords = gfl2HelpImport.records;
      importDescription = `gfl2help：${gfl2HelpImport.server}`;

      if (importedRecords.length === 0) {
        alert("gfl2help 檔案內沒有可匯入的支援卡池紀錄");
        return;
      }

      const preview = [
        `來源：${importDescription}`,
        `可匯入：${importedRecords.length} 筆`,
        `未知道具：${gfl2HelpImport.unknownItems} 筆`,
        "",
        "匯入時只會新增不存在的紀錄，不會刪除或覆蓋目前資料。"
      ].join("\n");

      if (!confirm(`${preview}\n\n是否繼續？`)) return;
      if (typeof window.gf2API.backupRecordsBeforeImport === "function") {
        await window.gf2API.backupRecordsBeforeImport();
      }
    } else if (Array.isArray(parsedData)) {
      importedRecords = parsedData;
    } else if (parsedData.records && Array.isArray(parsedData.records)) {
      importedRecords = parsedData.records;
    } else {
      alert("格式錯誤：僅支援本程式備份或 gfl2help 匯出 JSON");
      return;
    }

    const looksLikeManualImport = importedRecords.some(record => {
      return (
        record.manual === undefined &&
        record.poolId === undefined &&
        record.itemId === undefined &&
        record.pageOrder === undefined &&
        record.pageIndex === undefined &&
        record.time &&
        record.source &&
        record.type &&
        record.name &&
        record.rarity
      );
    });

    if (looksLikeManualImport) {
      alert(
        "偵測到這可能是手動紀錄模板。\n\n" +
        "請使用「匯入/匯出」→「匯入手動紀錄」匯入，" +
        "不要使用一般「匯入 JSON」。"
      );
      return;
    }

    const result = await addRecords(importedRecords);
    let importedExternalCount = 0;
    if (Array.isArray(parsedData?.externalAcquisitions)) {
      const entryKey = entry => entry.id || [entry.itemType, entry.itemName, entry.quantity, entry.sourceType, entry.acquiredAt].join("|");
      const knownKeys = new Set(externalAcquisitions.map(entryKey));
      parsedData.externalAcquisitions.forEach((entry, index) => {
        const itemType = entry?.itemType === "weapon" ? "weapon" : "character";
        const itemName = String(entry?.itemName || "").trim();
        const quantity = Math.max(1, Math.min(20, Number(entry?.quantity) || 1));
        if (!itemName || !getExternalItemNames(itemType).includes(itemName)) return;
        const sourceKey = entryKey({ ...entry, itemType, itemName, quantity });
        if (knownKeys.has(sourceKey)) return;
        const normalized = {
          id: String(entry.id || `external_import_${Date.now()}_${index}`),
          itemType,
          itemName,
          quantity,
          sourceType: externalSourceLabels[entry.sourceType] ? entry.sourceType : "other",
          acquiredAt: String(entry.acquiredAt || ""),
          note: String(entry.note || "").slice(0, 80),
          createdAt: String(entry.createdAt || new Date().toISOString())
        };
        knownKeys.add(sourceKey);
        externalAcquisitions.push(normalized);
        importedExternalCount += 1;
      });
      if (importedExternalCount) await window.gf2API.saveExternalAcquisitions(externalAcquisitions);
    }

    alert(
      `匯入完成（${importDescription}）\n新增 ${result.addedCount} 筆，跳過重複 ${result.skippedCount} 筆${importedExternalCount ? `\n額外取得 ${importedExternalCount} 筆` : ""}`
    );
  } catch (error) {
    console.error(error);
    alert(`匯入失敗：${error.message || "請確認 JSON 格式正確"}`);
  }
});



document.getElementById("exportManualTemplateBtn").addEventListener("click", async () => {
  const success = await window.gf2API.exportManualTemplate();

  if (success) {
    alert("手動紀錄模板已下載");
  }
});

document.getElementById("importManualBtn").addEventListener("click", async () => {
  try {
    const parsedData = await window.gf2API.importManualRecords();

    if (!parsedData) {
      return;
    }

    if (!Array.isArray(parsedData)) {
      alert("格式錯誤：手動紀錄必須是 JSON 陣列");
      return;
    }

    const {
      validRecords,
      skippedApiRange,
      skippedInvalid
    } = normalizeManualRecords(parsedData);

    const result = await addRecords(validRecords);

    let message =
      `手動紀錄匯入完成\n\n` +
      `新增：${result.addedCount} 筆\n` +
      `重複：${result.skippedCount} 筆\n` +
      `API 範圍內跳過：${skippedApiRange.length} 筆\n` +
      `格式錯誤跳過：${skippedInvalid.length} 筆`;

    if (skippedApiRange.length > 0) {
      message +=
        `\n\nAPI 範圍內資料不會匯入，避免覆蓋或干擾官方同步資料。`;
    }

    if (skippedInvalid.length > 0) {
      message +=
        `\n\n格式錯誤資料請檢查 time/source/type/name/rarity 欄位。`;
    }

    alert(message);
  } catch (error) {
    console.error(error);
    alert(`匯入手動紀錄失敗：${error.message}`);
  }
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  const confirmed = confirm("確定要清除目前帳號的全部抽卡紀錄嗎？\n其他帳號不受影響，這個動作無法復原。");

  if (!confirmed) {
    return;
  }

  records = [];
  currentRecordPage = 1;

  await window.gf2API.saveRecords(records);

  renderRecords();
  renderStats();
  renderSpecialRecords();
  renderOrangeHistory();
  renderTargetCharacterStats();
  renderAppearanceAnalysis();
  updateStatsDate();

  alert("已清除目前帳號的全部紀錄");
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const success = await window.gf2API.exportRecords();

  if (success) {
    alert("匯出成功");
  }
});

document.getElementById("updateItemMapBtn").addEventListener("click", async () => {
  const confirmed = confirm(
    "即將從 GitHub 下載最新版資料表與美術資源。\n\n" +
    "更新內容包含角色、武器、新裝採購資料及新增圖片，不會影響抽卡紀錄。\n是否繼續？"
  );

  if (!confirmed) {
    return;
  }

  try {
    const result = await window.gf2API.updateItemMap();
    await loadRecords();

    alert(
      `資料內容更新完成\n` +
      `版本：${result.version}\n` +
      `資料表：${result.count} 筆\n` +
      `更新檔案：${result.fileCount} 個（圖片 ${result.imageCount} 張）`
    );
  } catch (error) {
    console.error(error);
    alert(`資料內容更新失敗：${error.message || "請確認網路連線或稍後再試"}`);
  }
});

document.getElementById("checkUpdateBtn").addEventListener("click", async () => {
  try {
    const result = await window.gf2API.checkAppUpdate();

    if (!result.latestVersion) {
      alert("無法取得最新版本資訊。");
      return;
    }

    if (result.hasUpdate) {
      const goDownload = confirm(
        `發現新版本 v${result.latestVersion}\n` +
        `目前版本 v${result.currentVersion}\n\n` +
        "是否前往 GitHub 下載？"
      );

      if (goDownload) {
        await window.gf2API.openExternalUrl(result.releaseUrl);
      }
    } else {
      alert(`目前已是最新版本 v${result.currentVersion}`);
    }
  } catch (error) {
    console.error(error);
    alert("檢查更新失敗，請確認網路連線或稍後再試。");
  }
});

document.getElementById("syncSettingBtn").addEventListener("click", () => {
  const panel = document.getElementById("syncSettingPanel");
  panel.classList.toggle("hidden");
});

document.getElementById("recordPrevBtn").addEventListener("click", () => {
  if (currentRecordPage > 1) {
    currentRecordPage--;
    renderRecords();
  }
});

document.getElementById("recordNextBtn").addEventListener("click", () => {
  const filteredRecords = getFilteredRecordList();

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / recordsPerPage)
  );

  if (currentRecordPage < totalPages) {
    currentRecordPage++;
    renderRecords();
  }
});

document.getElementById("recordFirstBtn").addEventListener("click",()=>{

    currentRecordPage=1;

    renderRecords();

});

document.getElementById("recordLastBtn").addEventListener("click",()=>{
    const filteredRecords = getFilteredRecordList();

    currentRecordPage=Math.max(
        1,
        Math.ceil(filteredRecords.length/recordsPerPage)
    );

    renderRecords();

});

document.getElementById("recordPoolFilter").addEventListener("change", event => {
  pendingRecordFocusId = null;
  currentPoolFilter = event.target.value;
  currentRecordPage = 1;
  renderRecords();
});

document.getElementById("recordRarityFilter").addEventListener("change", event => {
  pendingRecordFocusId = null;
  currentRarityFilter = event.target.value;
  currentRecordPage = 1;
  renderRecords();
});

document.getElementById("recordSearchInput").addEventListener("input", event => {
  pendingRecordFocusId = null;
  currentRecordSearch = event.target.value;
  currentRecordPage = 1;
  renderRecords();
});

function clearRecordFilters() {
  pendingRecordFocusId = null;
  currentPoolFilter = "全部";
  currentRarityFilter = "全部";
  currentRecordSearch = "";
  currentRecordPage = 1;
  document.getElementById("recordPoolFilter").value = "全部";
  document.getElementById("recordRarityFilter").value = "全部";
  document.getElementById("recordSearchInput").value = "";
  renderRecords();
}

document.getElementById("clearRecordFiltersBtn").addEventListener("click", clearRecordFilters);
document.getElementById("emptyClearFiltersBtn").addEventListener("click", clearRecordFilters);

document.getElementById("realSyncBtn").addEventListener("click", async () => {
  const config = await window.gf2API.loadConfig();
  const gachaUrl = config.gachaUrl;
  const accessToken = config.accessToken;

  if (!gachaUrl || !accessToken) {
    alert("請先按「同步設定」，輸入 gachaUrl 與 Authorization 後儲存。");
    document.getElementById("syncSettingPanel").classList.remove("hidden");
    return;
  }

  const confirmed = confirm(
    "即將使用已儲存的 Authorization 同步抽卡紀錄。\n\n請確認這個資訊只保存在本機，不要分享給他人。"
  );

  if (!confirmed) {
    return;
  }

  try {
    setSyncStatus("同步準備中...");

    const result = await syncAllPoolsReal(gachaUrl, accessToken);



    const importResult = await addRecords(result.records);

    setSyncProgress(10, 10, "同步完成", `新增 ${importResult.addedCount} 筆，略過 ${importResult.skippedCount} 筆重複紀錄`);
    document.getElementById("syncProgress").classList.add("sync-progress-complete");

    document.getElementById("accessTokenInput").value = "";
    showToast(`同步完成：新增 ${importResult.addedCount} 筆，略過 ${importResult.skippedCount} 筆重複紀錄`);
  } catch (error) {
    console.error(error);
    setSyncStatus("同步失敗");
    const progress = document.getElementById("syncProgress");
    progress.classList.remove("hidden");
    progress.classList.add("sync-progress-error");
    document.getElementById("syncProgressTitle").textContent = "同步失敗";
    document.getElementById("syncProgressDetail").textContent = "請檢查紀錄網址與身分驗證碼是否正確或已過期。";
    showToast("同步失敗，請檢查同步設定或稍後再試。", "error", 5200);
  }
});

function updateStatsDate() {

  const statsDate =
    document.getElementById("statsDate");

  if (records.length === 0) {
    statsDate.textContent = "尚無資料";
    return;
  }

  const sorted = [...records].sort(
    (a, b) => new Date(a.time) - new Date(b.time)
  );

  const firstDate =
    sorted[0].time.split(" ")[0];

  const lastDate =
    sorted[sorted.length - 1].time.split(" ")[0];

  const totalDays = Math.floor(
    (
      new Date(sorted[sorted.length - 1].time)
      - new Date(sorted[0].time)
    ) / 86400000
  );

  statsDate.textContent =
    `統計期間：${firstDate} ~ ${lastDate}（${totalDays}天）`;
}

function getPoolTypeFromSource(source) {
  const map = {
    "常規採購": 1,
    "定向採購": 3,
    "軍備提升": 4,
    "新手採購": 5,
    "自選人形": 6,
    "自選武器": 7,
    "神秘箱": 8,
    "服裝池": 9,
    "新裝採購": 9,
    "外觀補給": 9
  };

  return map[source] || "unknown";
}

function getTimestampFromRecord(record) {
  if (record.id) {
    const parts = String(record.id).split("_");

    if (parts.length >= 6 && /^\d+$/.test(parts[3])) {
      return parts[3];
    }
  }

  const time = new Date(record.time).getTime();

  if (Number.isNaN(time)) {
    return record.time;
  }

  return String(Math.floor(time / 1000));
}

function normalizeRecordIds() {
  const sortedRecords = sortByGameOrder(records, "oldToNew");
  const duplicateCounter = new Map();

  sortedRecords.forEach(record => {
    if (record.manual === true) {
      return;
    }

    const poolType = getPoolTypeFromSource(record.source);
    const poolId = record.poolId || "";
    const itemId = record.itemId || "";
    const timestamp = getTimestampFromRecord(record);

    const baseKey = `${poolType}_${poolId}_${itemId}_${timestamp}`;
    const drawIndex = duplicateCounter.get(baseKey) || 0;

    duplicateCounter.set(baseKey, drawIndex + 1);

    record.drawIndex = drawIndex;
    record.id = `${baseKey}_${drawIndex}`;
  });
}

function initCardScroll() {
  document.querySelectorAll(".card-slider").forEach(slider => {
    const grid = slider.querySelector(".overview-grid");

    if (!grid) return;

    const prevBtn = slider.querySelector(".slider-prev");
    const nextBtn = slider.querySelector(".slider-next");

    const scrollAmount = () => grid.clientWidth * 0.9;

    prevBtn?.addEventListener("click", () => {
      grid.scrollBy({
        left: -scrollAmount(),
        behavior: "smooth"
      });
    });

    nextBtn?.addEventListener("click", () => {
      grid.scrollBy({
        left: scrollAmount(),
        behavior: "smooth"
      });
    });

    function updateButtons() {
      const maxScroll = grid.scrollWidth - grid.clientWidth;

      if (prevBtn) {
        prevBtn.disabled = grid.scrollLeft <= 5;
      }

      if (nextBtn) {
        nextBtn.disabled = grid.scrollLeft >= maxScroll - 5;
      }
    }

    grid.addEventListener("scroll", updateButtons);

    window.addEventListener("resize", updateButtons);

    updateButtons();
  });
}

const pageMeta = {
    overviewPage: ["統計總覽", "帳號整體招募狀況與各卡池表現"],
    specialPage: ["特殊紀錄", "值得分享的卡池運氣與養成成本紀錄"],
    historyPage: ["招募分析", "卡池效率、圖表、歷史與特殊招募"],
    progressPage: ["人形與軍備", "人形、武器與專武組合的完整統計"],
    appearancePage: ["特殊招募", "新裝採購與神秘箱的限定、稀有獎品分析"],
    recordsPage: ["資料中心", "同步、帳號、匯入匯出與原始紀錄"]
};

function getDetailStatByName(name) {
  return mergeProgressStats(
    getLimitedPoolStats("定向採購"), getSelectedPoolStats("自選人形"),
    getLimitedPoolStats("軍備提升"), getSelectedPoolStats("自選武器")
  ).find(item => item.name === name);
}

function closeDetailDrawer() {
  const shell = document.getElementById("detailDrawerShell");
  shell.classList.add("hidden");
  shell.setAttribute("aria-hidden", "true");
}

function openDetailDrawer(name) {
  const stat = getDetailStatByName(name);
  if (!stat) return;
  const shell = document.getElementById("detailDrawerShell");
  const itemRecords = sortByGameOrder(records.filter(record => record.name === name && !record.summaryOnly), "newToOld");
  const artPath = characterArtMap.roles?.[name]?.illustration || weaponArtMap.weapons?.[name];
  const efficiency = getStatEfficiency(stat);
  document.getElementById("detailDrawerTitle").textContent = name;
  document.getElementById("detailDrawerSubtitle").textContent = `${stat.poolIds.size || 1} 期卡池｜${stat.upCount} 次 UP｜${stat.offRateCount} 次歪`;
  document.getElementById("drawerOverview").innerHTML = `
    <div class="drawer-hero">${artPath ? `<img src="${escapeHtml(artPath)}" alt="">` : ""}<div><span>平均 UP 取得成本</span><strong>${stat.upCount ? `${(stat.acquisitionPulls / stat.upCount).toFixed(1)} 抽` : "-"}</strong><small>只計已取得的 UP</small></div></div>
    <div class="drawer-kpis"><div><span>已取得 UP 累計抽數</span><strong>${stat.acquisitionPulls}</strong></div><div><span>出橙機率</span><strong>${efficiency.rate}</strong></div><div><span>UP 命中率</span><strong>${efficiency.upRate}</strong></div><div><span>已取得 UP</span><strong>${stat.upCount}</strong></div></div>
    <div class="drawer-mini-chart">${stat.upPullDetails.map((item, index) => `<div><i style="height:${Math.max(8, Math.min(item.count, 100))}%"></i><span>${item.count}</span><small>#${index + 1}</small></div>`).join("") || `<p>尚未取得 UP</p>`}</div>`;
  const poolGroups = [...stat.poolIds].map(poolId => {
    const details = stat.upPullDetails.filter(item => String(item.poolId) === String(poolId));
    return `<article><span>POOL ${escapeHtml(poolId)}</span><strong>${details.length} 次 UP</strong><small>${details.reduce((sum, item) => sum + item.count, 0)} 抽｜${details.map(item => item.count).join("、") || "無出貨"}</small></article>`;
  });
  document.getElementById("drawerPools").innerHTML = `<div class="drawer-pool-list">${poolGroups.join("") || "尚無卡池履歷"}</div>`;
  document.getElementById("drawerRecords").innerHTML = `<div class="drawer-record-list">${itemRecords.slice(0, 50).map(record => `<button data-record-name="${escapeHtml(name)}"><span>${escapeHtml(record.time)}</span><strong>${escapeHtml(record.source)}</strong><small>POOL ${escapeHtml(record.poolId || "-")}</small></button>`).join("") || "尚無原始出貨紀錄"}</div>`;
  document.querySelectorAll("[data-drawer-tab]").forEach((button, index) => button.classList.toggle("active", index === 0));
  document.querySelectorAll(".drawer-panel").forEach((panel, index) => panel.classList.toggle("active", index === 0));
  shell.classList.remove("hidden");
  shell.setAttribute("aria-hidden", "false");
}

function initArchitecturePrototype() {
  document.body.classList.add("overview-active");
  [
    ["targetAverage", "targetUpAverage"], ["weaponAverage", "weaponUpAverage"],
    ["selectCharAverage", "selectCharUpAverage"], ["selectWeaponAverage", "selectWeaponUpAverage"]
  ].forEach(([averageId, upAverageId]) => {
    const averageValue = document.getElementById(averageId);
    if (!averageValue) return;
    const row = averageValue.closest(".stat-row");
    row.querySelector(".stat-label").textContent = "菁英平均";
    row.insertAdjacentHTML("afterend", `<div class="stat-row up-cost-row"><span class="stat-label">UP 平均成本</span><span class="stat-value" id="${upAverageId}">-</span></div>`);
  });
  const standardAverageRow = document.getElementById("standardAverage")?.closest(".stat-row");
  standardAverageRow?.insertAdjacentHTML("afterend", `<div id="standardUpAverageRow" class="stat-row neutral-mechanic-row"><span class="stat-label">UP 平均成本</span><span class="stat-value">不適用</span></div><div id="standardUpRateRow" class="stat-row neutral-mechanic-row"><span class="stat-label">UP 命中率</span><span class="stat-value">不適用</span></div><div id="standardUpSummaryRow" class="stat-row neutral-mechanic-row"><span class="stat-label">UP／歪</span><span class="stat-value">不適用</span></div>`);

  ["target", "weapon", "selectChar", "selectWeapon"].forEach(prefix => {
    const upAverageRow = document.getElementById(`${prefix}UpAverage`)?.closest(".stat-row");
    upAverageRow?.insertAdjacentHTML("afterend", `<div class="stat-row" data-up-rate-row><span class="stat-label">UP 命中率</span><span class="stat-value" id="${prefix}UpRate">-</span></div>`);
  });
  document.getElementById("standardWorst")?.closest(".stat-row")?.insertAdjacentHTML("afterend", `<div id="standardLuckNotice" class="stat-row neutral-mechanic-row"><span class="stat-label">最非含歪</span><span class="stat-value">不適用</span></div>`);

  const poolNames = ["定向採購", "軍備提升", "常規採購", "自選人形", "自選武器"];
  const poolIcons = ["◇", "⌁", "▦", "◎", "⬡"];
  document.querySelectorAll("#overviewPage .pool-overview-grid .overview-card").forEach((card, index) => {
    const poolName = poolNames[index];
    card.dataset.poolName = poolName;
    const heading = card.querySelector("h3");
    heading.innerHTML = `<span class="pool-title"><span class="pool-icon" aria-hidden="true">${poolIcons[index]}</span><span>${poolName}</span></span>`;
    if (poolName.startsWith("自選")) {
      heading.insertAdjacentHTML("beforeend", `<span class="pool-mechanic-tag" title="實際 UP 率包含首橙保底；現有紀錄不足時不推算排除保底後的勝率。">首橙保底 UP</span>`);
    }
    card.insertAdjacentHTML("beforeend", `<div class="card-analysis-footer"><span>查看分析</span><b aria-hidden="true">→</b></div>`);
    const firstStatRow = card.querySelector(".stat-row");
    const lastCoreId = poolName === "常規採購" ? "standardUpSummaryRow" : {
      "定向採購": "targetUpSummary", "軍備提升": "weaponUpSummary",
      "自選人形": "selectCharUpSummary", "自選武器": "selectWeaponUpSummary"
    }[poolName];
    const lastCoreElement = document.getElementById(lastCoreId);
    const lastCoreRow = lastCoreElement?.classList.contains("stat-row") ? lastCoreElement : lastCoreElement?.closest(".stat-row");
    firstStatRow?.classList.add("core-stat-start");
    lastCoreRow?.classList.add("core-stat-end");
    lastCoreRow?.insertAdjacentHTML("afterend", `<div class="card-section-divider"><span>補充紀錄</span></div>`);
  });
  const appearancePage = document.getElementById("appearancePage");
  const embedded = document.getElementById("embeddedAppearanceAnalysis");
  if (appearancePage && embedded) {
    [...appearancePage.children].forEach(child => embedded.appendChild(child));
    appearancePage.remove();
  }
  document.getElementById("recentEliteList")?.addEventListener("click", event => {
    const item = event.target.closest("[data-elite-name]");
    if (!item) return;
    activatePage("recordsPage");
    currentRecordSearch = item.dataset.eliteName;
    document.getElementById("recordSearchInput").value = currentRecordSearch;
    renderRecords();
  });
  document.getElementById("progressPage")?.addEventListener("click", event => {
    const card = event.target.closest(".character-stat-card");
    const name = card?.querySelector("h3")?.textContent?.trim();
    if (name) openDetailDrawer(name);
  });
  document.getElementById("closeDetailDrawerBtn")?.addEventListener("click", closeDetailDrawer);
  document.querySelector("[data-close-detail-drawer]")?.addEventListener("click", closeDetailDrawer);
  document.querySelectorAll("[data-drawer-tab]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-drawer-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".drawer-panel").forEach(panel => panel.classList.toggle("active", panel.id === button.dataset.drawerTab));
  }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.getElementById("detailDrawerShell").classList.contains("hidden")) closeDetailDrawer();
  });
  document.querySelector("[data-data-action='sync']")?.addEventListener("click", () => document.getElementById("realSyncBtn").click());
  document.querySelector("[data-data-action='account']")?.addEventListener("click", () => document.getElementById("accountSwitcherBtn").click());
  document.querySelector("[data-data-action='import']")?.addEventListener("click", () => document.getElementById("importBtn").click());
  document.querySelector("[data-data-action='export']")?.addEventListener("click", () => document.getElementById("exportBtn").click());
  document.querySelector("[data-data-action='external']")?.addEventListener("click", openExternalAcquisitionModal);
}

const OVERVIEW_MODE_STORAGE_KEY = "gf2.overview.statMode";
const OVERVIEW_FIELDS_STORAGE_KEY = "gf2.overview.customFields";
const OVERVIEW_CUSTOM_COLLAPSED_STORAGE_KEY = "gf2.overview.customCollapsed";

function initOverviewCardModesAndSlider() {
  const cards = [...document.querySelectorAll("#overviewPage .pool-overview-grid .overview-card")];
  const modeRows = {
    efficiency: [
      ["targetTotal", "targetOrange", "targetAverage"], ["weaponTotal", "weaponOrange", "weaponAverage"],
      ["standardTotal", "standardOrange", "standardAverage"], ["selectCharTotal", "selectCharOrange", "selectCharAverage"],
      ["selectWeaponTotal", "selectWeaponOrange", "selectWeaponAverage"]
    ],
    up: [
      ["targetUpAverage", "targetUpRate", "targetUpSummary"], ["weaponUpAverage", "weaponUpRate", "weaponUpSummary"],
      ["standardUpAverageRow", "standardUpRateRow", "standardUpSummaryRow"], ["selectCharUpAverage", "selectCharUpRate", "selectCharUpSummary"],
      ["selectWeaponUpAverage", "selectWeaponUpRate", "selectWeaponUpSummary"]
    ],
    luck: [
      ["targetBest", "targetWorst", "targetWorstWithOffRate"], ["weaponBest", "weaponWorst", "weaponWorstWithOffRate"],
      ["standardBest", "standardWorst", "standardLuckNotice"], ["selectCharBest", "selectCharWorst", "selectCharWorstWithOffRate"],
      ["selectWeaponBest", "selectWeaponWorst", "selectWeaponWorstWithOffRate"]
    ]
  };
  const modeFields = {
    efficiency: [{ key: "total", label: "總抽數" }, { key: "elite", label: "菁英數／出橙資訊" }, { key: "eliteAverage", label: "菁英平均" }],
    up: [{ key: "upAverage", label: "UP 平均成本" }, { key: "upRate", label: "UP 命中率" }, { key: "upSummary", label: "UP／歪" }],
    luck: [{ key: "best", label: "最歐" }, { key: "worst", label: "最非" }, { key: "worstWithOff", label: "最非含歪" }]
  };
  const allFields = Object.entries(modeFields).flatMap(([group, fields]) => fields.map(field => ({ ...field, group })));
  let customFields = modeFields.efficiency.map(field => field.key);
  try {
    const saved = JSON.parse(localStorage.getItem(OVERVIEW_FIELDS_STORAGE_KEY) || "[]");
    const allowed = new Set(allFields.map(field => field.key));
    const selected = Array.isArray(saved) ? saved.filter((key, index) => allowed.has(key) && saved.indexOf(key) === index) : [];
    if (selected.length) customFields = selected;
  } catch (_) {}

  cards.forEach(card => card.querySelectorAll(".stat-row").forEach(row => row.classList.add("overview-mode-row")));
  Object.entries(modeRows).forEach(([mode, groups]) => groups.forEach((ids, cardIndex) => ids.forEach((id, fieldIndex) => {
    const element = document.getElementById(id);
    const row = element?.classList.contains("stat-row") ? element : element?.closest(".stat-row");
    if (row && cards[cardIndex]?.contains(row)) {
      row.dataset.overviewModes = `${row.dataset.overviewModes || ""} ${mode}`.trim();
      row.dataset.overviewFields = `${row.dataset.overviewFields || ""} ${mode}:${modeFields[mode][fieldIndex].key}`.trim();
    }
  })));
  document.querySelectorAll("#overviewPage .card-section-divider").forEach(item => item.hidden = true);

  const buttons = [...document.querySelectorAll("[data-overview-mode]")];
  const customPanel = document.getElementById("overviewCustomPanel");
  const customOptions = document.getElementById("overviewCustomOptions");
  const customCount = document.getElementById("overviewCustomCount");
  const customSummary = document.getElementById("overviewCustomSummary");
  const customTab = document.getElementById("overviewCustomTab");
  const customChevron = document.getElementById("overviewCustomChevron");
  const customReset = document.getElementById("overviewCustomReset");
  let customCollapsed = false;
  try { customCollapsed = localStorage.getItem(OVERVIEW_CUSTOM_COLLAPSED_STORAGE_KEY) === "true"; } catch (_) {}
  const applyCustomCollapsed = () => {
    const expanded = activeMode === "custom" && !customCollapsed;
    customPanel.hidden = !expanded;
    customTab.setAttribute("aria-expanded", String(expanded));
  };
  let activeMode = "efficiency";
  const renderCustomOptions = () => {
    const selected = new Set(customFields);
    const groupLabels = { efficiency: "出貨效率", up: "UP 表現", luck: "歐非紀錄" };
    customOptions.innerHTML = allFields.map(field => {
      const order = customFields.indexOf(field.key);
      return `<label data-field-group="${field.group}"><input type="checkbox" value="${field.key}"${selected.has(field.key) ? " checked" : ""}><b>${order >= 0 ? order + 1 : ""}</b><span><small>${groupLabels[field.group]}</small>${field.label}</span></label>`;
    }).join("");
    customCount.textContent = String(customFields.length);
    customSummary.textContent = `依勾選順序顯示 ${customFields.length} 項`;
    customOptions.querySelectorAll("input").forEach(input => {
      input.disabled = customFields.length === 1 && input.checked;
    });
  };
  const applyMode = mode => {
    const selected = ["efficiency", "up", "luck", "custom"].includes(mode) ? mode : "efficiency";
    activeMode = selected;
    const orderedFields = selected === "custom" ? customFields : modeFields[selected].map(field => field.key);
    const allowedFields = new Set(orderedFields);
    cards.forEach(card => {
      card.dataset.statMode = selected;
      card.querySelectorAll(".overview-mode-row").forEach(row => {
        const tokens = (row.dataset.overviewFields || "").split(/\s+/).filter(Boolean);
        row.hidden = !tokens.some(token => allowedFields.has(token.split(":")[1]));
      });
      const footer = card.querySelector(".card-analysis-footer");
      orderedFields.forEach(fieldKey => {
        const row = [...card.querySelectorAll(".overview-mode-row")].find(item => (item.dataset.overviewFields || "").split(/\s+/).some(token => token.endsWith(`:${fieldKey}`)));
        if (row && footer) card.insertBefore(row, footer);
      });
    });
    buttons.forEach(button => {
      const active = button.dataset.overviewMode === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    renderCustomOptions();
    applyCustomCollapsed();
    try { localStorage.setItem(OVERVIEW_MODE_STORAGE_KEY, selected); } catch (_) {}
  };
  let savedMode = "efficiency";
  try { savedMode = localStorage.getItem(OVERVIEW_MODE_STORAGE_KEY) || savedMode; } catch (_) {}
  applyMode(savedMode);
  applyCustomCollapsed();
  buttons.forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    if (button.dataset.overviewMode === "custom") {
      customCollapsed = activeMode === "custom" ? !customCollapsed : false;
      try { localStorage.setItem(OVERVIEW_CUSTOM_COLLAPSED_STORAGE_KEY, String(customCollapsed)); } catch (_) {}
    }
    applyMode(button.dataset.overviewMode);
  }));
  customOptions.addEventListener("change", event => {
    const input = event.target.closest("input[type='checkbox']");
    if (!input) return;
    if (input.checked) {
      if (!customFields.includes(input.value)) customFields.push(input.value);
    } else if (customFields.length > 1) {
      customFields = customFields.filter(key => key !== input.value);
    } else {
      input.checked = true;
      return;
    }
    try { localStorage.setItem(OVERVIEW_FIELDS_STORAGE_KEY, JSON.stringify(customFields)); } catch (_) {}
    applyMode("custom");
  });
  customReset.addEventListener("click", event => {
    event.stopPropagation();
    customFields = ["total"];
    try { localStorage.setItem(OVERVIEW_FIELDS_STORAGE_KEY, JSON.stringify(customFields)); } catch (_) {}
    applyMode("custom");
  });

  const viewport = document.getElementById("poolSliderViewport");
  const prev = document.getElementById("poolSliderPrev");
  const next = document.getElementById("poolSliderNext");
  const indicator = document.getElementById("poolSliderIndicator");
  const getStep = () => {
    const first = cards[0];
    if (!first) return viewport.clientWidth;
    const gap = parseFloat(getComputedStyle(viewport.querySelector(".pool-overview-grid")).columnGap) || 0;
    return first.getBoundingClientRect().width + gap;
  };
  const updateSlider = () => {
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const hidden = max < 2;
    prev.hidden = next.hidden = indicator.hidden = hidden;
    prev.disabled = viewport.scrollLeft <= 2;
    next.disabled = viewport.scrollLeft >= max - 2;
    const step = getStep();
    const gap = parseFloat(getComputedStyle(viewport.querySelector(".pool-overview-grid")).columnGap) || 0;
    const visibleCount = Math.max(1, Math.min(cards.length, Math.round((viewport.clientWidth + gap) / step)));
    const totalPositions = Math.max(1, cards.length - visibleCount + 1);
    const page = Math.max(1, Math.min(totalPositions, Math.round(viewport.scrollLeft / step) + 1));
    indicator.querySelector("small").textContent = `${page} / ${totalPositions}`;
    indicator.classList.toggle("at-end", page === totalPositions);
  };
  const move = direction => viewport.scrollBy({ left: direction * getStep(), behavior: "smooth" });
  prev.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  viewport.addEventListener("wheel", event => {
    if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    viewport.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, { passive: false });
  viewport.addEventListener("scroll", updateSlider, { passive: true });
  window.addEventListener("resize", updateSlider);
  requestAnimationFrame(updateSlider);
}

function navigateToPage(targetId, options = {}) {
  document.body.classList.toggle("overview-active", targetId === "overviewPage");
  document.body.classList.toggle("analysis-active", ["historyPage", "progressPage"].includes(targetId));
  document.querySelectorAll("[data-page-target]").forEach(item => {
    item.classList.toggle("active", item.dataset.pageTarget === targetId);
  });
  document.querySelectorAll(".page-section").forEach(section => {
    section.classList.toggle("active", section.id === targetId);
  });
  const [title, subtitle] = pageMeta[targetId];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;

  if (targetId === "historyPage" && options.poolName) {
    recruitmentAnalysisState.category = getPoolCategory(options.poolName);
    recruitmentAnalysisState.poolName = options.poolName;
    recruitmentAnalysisState.selectedEventId = null;
    recruitmentAnalysisState.selectedPeriodKey = null;
    syncRecruitmentSelectors();
    renderRecruitmentAnalysis();
    document.getElementById("historyPage").dataset.poolType = options.poolType || "";
  }

  const targetSection = options.section ? document.getElementById(options.section) : null;
  if (targetSection) {
    requestAnimationFrame(() => targetSection.scrollIntoView({ behavior: "smooth", block: "start" }));
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function activatePage(targetId) {
  navigateToPage(targetId);
}

function openAnalysisForPool(poolName) {
  const poolType = {
    "定向採購": "限定招募", "軍備提升": "限定招募", "常規採購": "常規招募",
    "自選人形": "自選招募", "自選武器": "自選招募"
  }[poolName];
  navigateToPage("historyPage", {
    poolType,
    poolName,
    section: "analysisPoolFilter"
  });
  showToast(`已開啟「${poolName}」招募分析`, "info", 2400);
}

function initOverviewInteractions() {
  const poolNames = ["定向採購", "軍備提升", "常規採購", "自選人形", "自選武器"];
  document.querySelectorAll("#overviewPage .pool-overview-grid .overview-card").forEach((card, index) => {
    const poolName = poolNames[index];
    if (!poolName) return;
    card.classList.add("interactive-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `查看${poolName}招募分析`);
    const open = () => openAnalysisForPool(poolName);
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function initRecruitmentAnalysisInteractions() {
  try {
    const saved = JSON.parse(localStorage.getItem(ANALYSIS_PREF_KEY) || "{}");
    if (recruitmentPoolGroups[saved.category]) recruitmentAnalysisState.category = saved.category;
    if (Object.values(recruitmentPoolGroups).flat().includes(saved.poolName)) recruitmentAnalysisState.poolName = saved.poolName;
    if (["portrait", "timeline"].includes(saved.historyView)) recruitmentAnalysisState.historyView = saved.historyView;
    if (["all", "up", "off"].includes(saved.eliteFilter)) recruitmentAnalysisState.eliteFilter = saved.eliteFilter;
    if (["elite", "up"].includes(saved.distributionView)) recruitmentAnalysisState.distributionView = saved.distributionView;
    recruitmentAnalysisState.advancedExpanded = saved.advancedExpanded === true;
  } catch (_) {}
  syncRecruitmentSelectors();

  document.getElementById("analysisCategoryTabs")?.addEventListener("click", event => {
    const button = event.target.closest("[data-analysis-category]");
    if (!button) return;
    recruitmentAnalysisState.category = button.dataset.analysisCategory;
    recruitmentAnalysisState.poolName = recruitmentPoolGroups[recruitmentAnalysisState.category][0];
    recruitmentAnalysisState.selectedEventId = null;
    recruitmentAnalysisState.selectedPeriodKey = null;
    renderRecruitmentAnalysis();
  });
  document.getElementById("analysisPoolFilter")?.addEventListener("change", event => {
    recruitmentAnalysisState.poolName = event.target.value;
    recruitmentAnalysisState.selectedEventId = null;
    recruitmentAnalysisState.selectedPeriodKey = null;
    renderRecruitmentAnalysis();
  });
  document.querySelector(".elite-history-actions")?.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-elite-view]");
    const filterButton = event.target.closest("[data-elite-filter]");
    if (!viewButton && !filterButton) return;
    if (viewButton) recruitmentAnalysisState.historyView = viewButton.dataset.eliteView;
    if (filterButton && !filterButton.disabled) recruitmentAnalysisState.eliteFilter = filterButton.dataset.eliteFilter;
    renderRecruitmentAnalysis();
  });
  document.querySelector(".elite-history-shell")?.addEventListener("click", event => {
    const eventButton = event.target.closest("[data-analysis-event]");
    if (eventButton) {
      recruitmentAnalysisState.selectedEventId = eventButton.dataset.analysisEvent;
      renderRecruitmentAnalysis();
      return;
    }
    if (event.target.closest("[data-close-event-detail]")) {
      recruitmentAnalysisState.selectedEventId = null;
      renderEliteEventDetail(null);
      return;
    }
    const openRecord = event.target.closest("[data-open-record]");
    if (openRecord) {
      const selected = getOrangeHistory(recruitmentAnalysisState.poolName).history.find(item => item.eventId === openRecord.dataset.openRecord);
      if (!selected) return;
      navigateToPage("recordsPage");
      currentRecordSearch = selected.name;
      currentPoolFilter = selected.source || recruitmentAnalysisState.poolName;
      pendingRecordFocusId = selected.eventId;
      document.getElementById("recordSearchInput").value = currentRecordSearch;
      document.getElementById("recordPoolFilter").value = currentPoolFilter;
      const locatedRecords = sortByGameOrder(getFilteredRecordList(), "newToOld");
      const locatedIndex = locatedRecords.findIndex(record => createRecordId(record) === pendingRecordFocusId);
      currentRecordPage = locatedIndex >= 0 ? Math.floor(locatedIndex / recordsPerPage) + 1 : 1;
      renderRecords();
      return;
    }
    const openUnit = event.target.closest("[data-open-unit]");
    if (openUnit) openDetailDrawer(openUnit.dataset.openUnit);
  });
  document.getElementById("advancedAnalysisDetails")?.addEventListener("click", event => {
    const button = event.target.closest("[data-distribution-view]");
    if (!button) return;
    event.preventDefault();
    recruitmentAnalysisState.distributionView = button.dataset.distributionView;
    renderRecruitmentAnalysis();
  });
  document.getElementById("recruitmentCompositionChart")?.addEventListener("pointermove", event => {
    const segment = event.target.closest?.(".composition-segment");
    const chart = event.currentTarget;
    const tooltip = chart.querySelector(".composition-tooltip");
    if (!tooltip) return;
    if (!segment) {
      tooltip.hidden = true;
      return;
    }
    const bounds = tooltip.closest(".composition-donut").getBoundingClientRect();
    tooltip.innerHTML = `<strong>${segment.dataset.label}</strong><span>${segment.dataset.count} 次｜${segment.dataset.percent}%</span>`;
    tooltip.style.left = `${event.clientX - bounds.left + 12}px`;
    tooltip.style.top = `${event.clientY - bounds.top + 12}px`;
    tooltip.hidden = false;
  });
  document.getElementById("recruitmentCompositionChart")?.addEventListener("pointerleave", event => {
    const tooltip = event.currentTarget.querySelector(".composition-tooltip");
    if (tooltip) tooltip.hidden = true;
  });
  document.getElementById("advancedAnalysisDetails")?.addEventListener("toggle", event => {
    recruitmentAnalysisState.advancedExpanded = event.currentTarget.open;
    event.currentTarget.querySelector("summary b").textContent = event.currentTarget.open ? "收合" : "展開";
    saveRecruitmentAnalysisPreference();
  });
  document.getElementById("periodHistoryList")?.addEventListener("toggle", event => {
    const card = event.target.closest?.("[data-period-key]");
    if (!card) return;
    recruitmentAnalysisState.selectedPeriodKey = card.open ? card.dataset.periodKey : null;
  }, true);
  renderRecruitmentAnalysis();
}

function initAppNavigation() {

  document.querySelectorAll("[data-page-target]").forEach(button => {
    button.addEventListener("click", () => {
      navigateToPage(button.dataset.pageTarget);
    });
  });
}

function initPanelTabs(buttonSelector, panelSelector, dataKey) {
  document.querySelectorAll(buttonSelector).forEach(button => {
    button.addEventListener("click", () => {
      const targetId = button.dataset[dataKey];
      document.querySelectorAll(buttonSelector).forEach(item => {
        item.classList.toggle("active", item === button);
      });
      document.querySelectorAll(panelSelector).forEach(panel => {
        panel.classList.toggle("active", panel.id === targetId);
      });
    });
  });
}

function initLayoutControls() {
  initArchitecturePrototype();
  initOverviewCardModesAndSlider();
  initAppNavigation();
  initOverviewInteractions();
  initRecruitmentAnalysisInteractions();
  initPanelTabs("[data-progress-target]", ".progress-panel", "progressTarget");
  initPanelTabs("[data-appearance-target]", ".appearance-panel", "appearanceTarget");
  initDropdownMenus();
  initExternalAcquisitionUI();
  initBrandLogoSelector();
}

function initDropdownMenus() {
  const dropdowns = [...document.querySelectorAll(".dropdown")];

  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector(".dropdown-btn");
    trigger?.addEventListener("click", event => {
      event.stopPropagation();
      const willOpen = !dropdown.classList.contains("open");
      dropdowns.forEach(item => item.classList.remove("open"));
      dropdown.classList.toggle("open", willOpen);
    });

    dropdown.querySelectorAll(".dropdown-content button").forEach(item => {
      item.addEventListener("click", () => dropdown.classList.remove("open"));
    });
  });

  document.addEventListener("click", () => {
    dropdowns.forEach(dropdown => dropdown.classList.remove("open"));
  });
}

initLayoutControls();
initCardScroll();
async function initializeApp() {
  await refreshAccountSwitcher();
  await loadRecords();
  await loadConfigToUI();
}
initializeApp().catch(error => {
  console.error(error);
  alert(`程式初始化失敗：${error.message}`);
});
