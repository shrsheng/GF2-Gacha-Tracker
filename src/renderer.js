let records = [];
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
  "緋"
];

const permanentWeaponNames = [
  "斯摩希克",
  "獵心者",
  "光學幻境",
  "游星",
  "金石奏",
  "梅扎露娜",
  "赫斯提亞"
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

  if (record.source === "定向採購") {
    return permanentTargetCharacters.includes(record.name);
  }

  if (record.source === "軍備提升") {
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

async function addRecords(newRecords) {
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
  updateStatsDate();

  return { addedCount, skippedCount };
}

function setSyncStatus(message) {
  document.getElementById("syncStatus").textContent = message;
}

async function syncAllPoolsReal(gachaUrl, accessToken) {
  const poolTypes = [1, 2, 3, 4, 5, 6, 7];

  const poolNameMap = {
    1: "常規採購",
    2: "未知卡池",
    3: "定向採購",
    4: "軍備提升",
    5: "新手採購",
    6: "自選人形",
    7: "自選武器"
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

function renderRecords() {
  const table = document.getElementById("recordTable");
  table.innerHTML = "";

  let filteredRecords = records;

  if (currentPoolFilter !== "全部") {
    filteredRecords = records.filter(record => {
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
    `;

    table.appendChild(tr);
  });

  document.getElementById("recordPageInfo").textContent =
    `第 ${currentRecordPage} / ${totalPages} 頁`;

  document.getElementById("recordPrevBtn").disabled =
    currentRecordPage <= 1;

  document.getElementById("recordNextBtn").disabled =
    currentRecordPage >= totalPages;
}

function getPoolStats(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");
  const eliteRecords = poolRecords.filter(record => record.rarity === "橙色");

  let pity = 0;

  poolRecords.forEach(record => {
    if (record.rarity === "橙色") {
      pity = 0;
    } else {
      pity++;
    }
  });

  return {
    total: poolRecords.length,
    elite: eliteRecords.length,
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

function getOrangeHistory(poolName) {
  const poolRecords = getGameRecords(poolName, "oldToNew");

  const history = [];
  let countSinceLastElite = 0;

  poolRecords.forEach(record => {
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
    countSinceLastUp++;

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

  const targetUpStats = getUpRateStats("定向採購");
  const weaponUpStats = getUpRateStats("軍備提升");

  const targetAdvanced = getAdvancedStats("定向採購");
  const weaponAdvanced = getAdvancedStats("軍備提升");
  const standardAdvanced = getAdvancedStats("常規採購");

  const targetWorstWithOffRate = getWorstWithOffRate("定向採購");
  const weaponWorstWithOffRate = getWorstWithOffRate("軍備提升");

  const standardEliteTypeStats = getStandardEliteTypeStats();

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
}

function renderOrangeHistoryBlock(elementId, poolName) {
  const container = document.getElementById(elementId);
  const result = getOrangeHistory(poolName);

  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.style.marginBottom = "12px";
  summary.innerHTML = `
    <p>菁英數：${result.history.length}</p>
    <p>目前墊池：${result.currentPity}</p>
    <hr>
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
      <span class="timeline-name">${item.name}</span>
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
  const poolRecords = getGameRecords(poolName, "oldToNew");

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

  const targetMaxEliteBatch = getMaxEliteInBatch("定向採購");
  const weaponMaxEliteBatch = getMaxEliteInBatch("軍備提升");
  const standardMaxEliteBatch = getMaxEliteInBatch("常規採購");

  document.getElementById("targetMaxUpStreak").textContent =
    targetMaxUpStreak > 0 ? `${targetMaxUpStreak} 次` : "-";

  document.getElementById("weaponMaxUpStreak").textContent =
    weaponMaxUpStreak > 0 ? `${weaponMaxUpStreak} 次` : "-";

  document.getElementById("targetMaxEliteBatch").innerHTML =
    formatEliteBatch(targetMaxEliteBatch);

  document.getElementById("weaponMaxEliteBatch").innerHTML =
    formatEliteBatch(weaponMaxEliteBatch);

  document.getElementById("standardMaxEliteBatch").innerHTML =
    formatEliteBatch(standardMaxEliteBatch);
}

async function loadRecords() {
  records = await window.gf2API.loadRecords();
  normalizeRecordIds();
  sortRecordsByTime();
  await window.gf2API.saveRecords(records);

  renderRecords();
  renderStats();
  renderSpecialRecords();
  renderOrangeHistory();
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

    const result = await addRecords(importedRecords);

    alert(
      `匯入完成\n新增 ${result.addedCount} 筆，跳過重複 ${result.skippedCount} 筆`
    );
  } catch (error) {
    console.error(error);
    alert("匯入失敗：請確認 JSON 格式正確");
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
  let filteredRecords = records;

  if (currentPoolFilter !== "全部") {
    filteredRecords = records.filter(record => {
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
    "自選武器": 7
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

loadRecords();
loadConfigToUI();