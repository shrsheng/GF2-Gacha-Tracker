let records = [];
let itemMap = {};
let signatureMap = {};
let characterArtMap = { roles: {}, wallpapers: {} };
let weaponArtMap = { weapons: {} };
const defaultOutfitPoolMap = {
  version: 1,
  pools: {
    "221001": {
      name: "熱力運動",
      featuredOutfit: "衣裝·熱力運動",
      image: "../assets/special-recruit/pool-221001.png",
      rareItems: ["交叉熱浪", "密網遐思"]
    },
    "188001": {
      name: "暮色絮語",
      featuredOutfit: "衣裝·暮色絮語",
      image: "../assets/special-recruit/pool-188001.png",
      rareItems: ["早安惡作劇", "甜莓心事", "雪化跡"]
    },
    "98001": {
      name: "蔚藍軌跡",
      featuredOutfit: "衣裝·蔚藍軌跡",
      image: "../assets/special-recruit/pool-98001.png",
      rareItems: []
    }
  }
};
let outfitPoolMap = defaultOutfitPoolMap;
let currentRecordPage = 1;
let currentPoolFilter = "全部";
const recordsPerPage = 6;

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
  newRecords.forEach(normalizeSpecialRecruitRecord);
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

  for (const poolType of poolTypes) {
    const poolName = poolNameMap[poolType] || `卡池${poolType}`;

    setSyncStatus(`同步中：${poolName}...`);

    const result = await window.gf2API.syncPool({
      gachaUrl,
      accessToken,
      poolType
    });

    allSyncedRecords = allSyncedRecords.concat(result.records);
    messages.push(`${poolName}：${result.count} 筆`);
  }

  setSyncStatus("同步完成");

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
  const getOutfitDefinition = record => outfitPoolMap.pools?.[String(record.poolId)] || {};
  const isLimitedOutfitReward = record => {
    const featuredName = getOutfitDefinition(record).featuredOutfit;
    return Boolean(featuredName && record.name === featuredName);
  };
  const isRareOutfitReward = record => {
    if (isLimitedOutfitReward(record)) return false;
    const name = String(record.name || "");
    const definition = getOutfitDefinition(record);
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
    const definition = outfitPoolMap.pools?.[poolId] || {};
    const poolLimited = poolRecords.filter(isLimitedOutfitReward);
    const poolRare = poolRecords.filter(isRareOutfitReward);
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
      ? `<img class="outfit-hero-art" style="display:block;flex:0 0 58%;width:58%;height:340px;min-width:0;object-fit:cover;object-position:center 36%;" src="${escapeHtml(definition.image)}" alt="${escapeHtml(definition.name || "新裝採購")}" loading="lazy">`
      : "";

    return `<article class="outfit-pool-card" style="display:block;overflow:hidden;width:100%;min-width:0;">
      <div class="outfit-hero" style="display:flex;overflow:hidden;width:100%;height:340px;min-width:0;"><div class="outfit-hero-copy" style="flex:0 0 42%;width:42%;height:340px;min-width:0;"><span class="outfit-code">POOL // ${poolId}</span><h3>${definition.name || `新裝採購 ${poolId}`}</h3><small>${dateStart} ～ ${dateEnd}</small><div class="outfit-total"><strong>${poolRecords.length}</strong><span>總抽數</span></div><div class="outfit-core-stats"><div><span>限定</span><strong>${poolLimited.length}</strong><small>${formatRate(poolLimited.length, poolRecords.length)}／官方 1.18%</small></div><div><span>稀有</span><strong>${poolRare.length}</strong><small>${formatRate(poolRare.length, poolRecords.length)}／官方 16.02%</small></div></div></div>${poolArt}</div>
      <div class="outfit-result-grid" style="position:relative;clear:both;width:100%;min-width:0;background:#eef1f2;">
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

function renderRecords() {
  const table = document.getElementById("recordTable");
  table.innerHTML = "";

  let filteredRecords = records.filter(record => !record.summaryOnly);

  if (currentPoolFilter !== "全部") {
    filteredRecords = filteredRecords.filter(record => {
      return record.source === currentPoolFilter;
    });
  }

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

  pageRecords.forEach(record => {
    const tr = document.createElement("tr");
    const nameClass = getRarityClass(record.rarity);

    tr.innerHTML = `
      <td>${record.time}</td>
      <td>${record.source}</td>
      <td>${record.type}</td>
      <td class="${nameClass}">${record.name}</td>
      <td>${record.itemNum ?? 1}</td>
      <td>${record.poolId ?? "-"}</td>
    `;

    table.appendChild(tr);
  });

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
          <span class="loadout-status">${item.completed ? "6＋1 COMPLETE" : "IN PROGRESS"}</span>
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
    average: orange > 0 ? `${(pulls / orange).toFixed(1)} 抽` : "-",
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
        <div><span>平均抽數</span><strong>${stat.average}</strong></div>
        <div><span>UP 率</span><strong>${stat.upRate}</strong></div>
      </div>
    </div>
  `;
}

function getOrangeHistory(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");

  const history = [];
  let countSinceLastElite = 0;

  poolRecords.forEach(record => {
    if (record.summaryOnly && record.pullCount) {
      if (record.rarity === "橙色") {
        history.push({
          name: record.name,
          count: record.pullCount,
          time: record.time,
          isOffRate: isOffRateRecord(record),
          summaryOnly: true
        });

        countSinceLastElite = 0;
      }

      return;
    }

    if (record.rarity === "橙色") {
      history.push({
        name: record.name,
        count: countSinceLastElite + 1,
        time: record.time,
        isOffRate: isOffRateRecord(record)
      });

      countSinceLastElite = 0;
    } else {
      countSinceLastElite++;
    }
  });

  return {
    history,
    currentPity: countSinceLastElite
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

  return `${upStats.upCount}-${upStats.offRateCount}(${upStats.upRate})`;
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


  const standardEliteTypeStats = getStandardEliteTypeStats();
  const recruitmentSources = new Set([
    "定向採購", "軍備提升", "常規採購", "新手採購", "自選人形", "自選武器"
  ]);
  const recruitmentRecords = records.filter(record => recruitmentSources.has(record.source));
  const overallTotal = recruitmentRecords.reduce((sum, record) => sum + getRecordPullCount(record), 0);
  const overallOrange = recruitmentRecords.filter(record => record.rarity === "橙色").length;
  const overallUp = targetUpStats.upCount + weaponUpStats.upCount + selectCharUpStats.upCount + selectWeaponUpStats.upCount;
  const overallOff = targetUpStats.offRateCount + weaponUpStats.offRateCount + selectCharUpStats.offRateCount + selectWeaponUpStats.offRateCount;
  const overallLimitedOrange = overallUp + overallOff;

  document.getElementById("overallTotal").textContent = overallTotal.toLocaleString();
  document.getElementById("overallOrange").textContent = overallOrange.toLocaleString();
  document.getElementById("overallAverage").textContent = overallOrange > 0
    ? `${(overallTotal / overallOrange).toFixed(1)} 抽`
    : "-";
  document.getElementById("overallUpRate").textContent = overallLimitedOrange > 0
    ? `${((overallUp / overallLimitedOrange) * 100).toFixed(1)}%`
    : "-";
  document.getElementById("overallUpDetail").textContent = overallLimitedOrange > 0
    ? `${overallUp} UP／${overallOff} 歪`
    : "尚無資料";

  document.getElementById("targetTotal").textContent = `${target.total} 抽`;
  document.getElementById("targetOrange").textContent = getEliteRateText(target);
  document.getElementById("targetAverage").textContent = `${targetAdvanced.average} 抽`;
  document.getElementById("targetUpSummary").textContent = getUpSummaryText(targetUpStats);
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
  document.getElementById("weaponAverage").textContent = `${weaponAdvanced.average} 抽`;
  document.getElementById("weaponUpSummary").textContent = getUpSummaryText(weaponUpStats);
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
  document.getElementById("standardAverage").textContent =
    `${standardAdvanced.average} 抽`;
  document.getElementById("standardBest").textContent =
    formatPullWithName(standardAdvanced.best, standardAdvanced.bestName);
  document.getElementById("standardWorst").textContent =
    formatPullWithName(standardAdvanced.worst, standardAdvanced.worstName);

  document.getElementById("selectCharTotal").textContent = `${selectChar.total} 抽`;
  document.getElementById("selectCharOrange").textContent = getEliteRateText(selectChar);
  document.getElementById("selectCharAverage").textContent = `${selectCharAdvanced.average} 抽`;
  document.getElementById("selectCharUpSummary").textContent = getUpSummaryText(selectCharUpStats);
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
  document.getElementById("selectWeaponAverage").textContent = `${selectWeaponAdvanced.average} 抽`;
  document.getElementById("selectWeaponUpSummary").textContent = getUpSummaryText(selectWeaponUpStats);
  document.getElementById("selectWeaponBest").textContent =
    formatPullWithName(selectWeaponAdvanced.best, selectWeaponAdvanced.bestName);
  document.getElementById("selectWeaponWorst").textContent =
    formatPullWithName(selectWeaponAdvanced.worst, selectWeaponAdvanced.worstName);
  document.getElementById("selectWeaponWorstWithOffRate").textContent =
    formatPullWithName(
      selectWeaponWorstWithOffRate.count,
      selectWeaponWorstWithOffRate.name
    );
}

function renderOrangeHistoryBlock(elementId, poolName) {
  const container = document.getElementById(elementId);
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

  renderMilestoneRecords();
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

  const loaded = await Promise.all([
    window.gf2API.loadRecords(),
    itemMapPromise,
    signatureMapPromise,
    characterArtMapPromise,
    weaponArtMapPromise,
    outfitPoolMapPromise
  ]);
  [records, itemMap, signatureMap, characterArtMap, weaponArtMap] = loaded;
  const loadedOutfitPoolMap = loaded[5] || { pools: {} };
  outfitPoolMap = {
    ...defaultOutfitPoolMap,
    ...loadedOutfitPoolMap,
    pools: {
      ...defaultOutfitPoolMap.pools,
      ...(loadedOutfitPoolMap.pools || {})
    }
  };
  records.forEach(normalizeSpecialRecruitRecord);
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

    if (Array.isArray(parsedData)) {
      importedRecords = parsedData;
    } else if (parsedData.records && Array.isArray(parsedData.records)) {
      importedRecords = parsedData.records;
    } else {
      alert("格式錯誤：請選擇抽卡紀錄陣列，或包含 records 的備份 JSON");
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

    alert(
      `匯入完成\n新增 ${result.addedCount} 筆，跳過重複 ${result.skippedCount} 筆`
    );
  } catch (error) {
    console.error(error);
    alert("匯入失敗：請確認 JSON 格式正確");
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
  const confirmed = confirm("確定要清除全部抽卡紀錄嗎？這個動作無法復原。");

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

  alert("已清除全部紀錄");
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const success = await window.gf2API.exportRecords();

  if (success) {
    alert("匯出成功");
  }
});

document.getElementById("updateItemMapBtn").addEventListener("click", async () => {
  const confirmed = confirm(
    "即將從 GitHub 下載最新版資料表。\n\n更新後，新角色或新武器的名稱可能會正常顯示。\n是否繼續？"
  );

  if (!confirmed) {
    return;
  }

  try {
    const result = await window.gf2API.updateItemMap();

    alert(`資料表更新完成，共 ${result.count} 筆資料。`);
  } catch (error) {
    console.error(error);
    alert("資料表更新失敗，請確認網路連線或稍後再試。");
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
  let filteredRecords = records.filter(record => !record.summaryOnly);

  if (currentPoolFilter !== "全部") {
    filteredRecords = filteredRecords.filter(record => {
      return record.source === currentPoolFilter;
    });
  }

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

    let filteredRecords=records.filter(record=>!record.summaryOnly);

    if(currentPoolFilter!=="全部"){

        filteredRecords=filteredRecords.filter(record=>
            record.source===currentPoolFilter
        );

    }

    currentRecordPage=Math.max(
        1,
        Math.ceil(filteredRecords.length/recordsPerPage)
    );

    renderRecords();

});

document.getElementById("recordPoolFilter").addEventListener("change", event => {
  currentPoolFilter = event.target.value;
  currentRecordPage = 1;
  renderRecords();
});

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

    document.getElementById("accessTokenInput").value = "";

    alert(
      `正式同步完成\n` +
      result.messages.join("\n") +
      `\n\n新增 ${importResult.addedCount} 筆，跳過重複 ${importResult.skippedCount} 筆`
    );
  } catch (error) {
    console.error(error);
    setSyncStatus("同步失敗");
    alert("正式同步失敗，請檢查 gachaUrl / Authorization 是否正確或已過期");
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

function initAppNavigation() {
  const pageMeta = {
    overviewPage: ["統計總覽", "帳號整體招募狀況與各卡池表現"],
    specialPage: ["特殊紀錄", "值得分享的卡池運氣與養成成本紀錄"],
    historyPage: ["招募歷史", "依卡池檢視橙色出貨時間軸"],
    progressPage: ["UP 抽卡分析", "人形、武器與專武組合的個別統計"],
    appearancePage: ["特殊招募", "新裝採購與神秘箱的限定、稀有獎品分析"],
    recordsPage: ["抽卡紀錄", "瀏覽與篩選完整招募資料"]
  };

  document.querySelectorAll("[data-page-target]").forEach(button => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.pageTarget;
      document.querySelectorAll("[data-page-target]").forEach(item => {
        item.classList.toggle("active", item === button);
      });
      document.querySelectorAll(".page-section").forEach(section => {
        section.classList.toggle("active", section.id === targetId);
      });

      const [title, subtitle] = pageMeta[targetId];
      document.getElementById("pageTitle").textContent = title;
      document.getElementById("pageSubtitle").textContent = subtitle;
      window.scrollTo({ top: 0, behavior: "smooth" });
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
  initAppNavigation();
  initPanelTabs("[data-history-target]", ".history-panel", "historyTarget");
  initPanelTabs("[data-progress-target]", ".progress-panel", "progressTarget");
  initPanelTabs("[data-appearance-target]", ".appearance-panel", "appearanceTarget");
  initDropdownMenus();
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
loadRecords();
loadConfigToUI();
