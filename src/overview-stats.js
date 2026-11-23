(function exposeOverviewStats(global) {
  "use strict";

  const GENERAL_RECRUITMENT_POOLS = new Set([
    "定向採購", "軍備提升", "常規採購", "新手採購", "自選人形", "自選武器"
  ]);

  const UP_POOLS = new Set(["定向採購", "軍備提升", "自選人形", "自選武器"]);

  function computeOverviewSummary(records, getPullCount, isOffRateRecord) {
    const generalRecords = records.filter(record => GENERAL_RECRUITMENT_POOLS.has(record.source));
    const upOrangeRecords = records.filter(record =>
      UP_POOLS.has(record.source) && record.rarity === "橙色"
    );
    const totalPulls = generalRecords.reduce((sum, record) => sum + getPullCount(record), 0);
    const eliteCount = generalRecords.filter(record => record.rarity === "橙色").length;
    const offRateCount = upOrangeRecords.filter(isOffRateRecord).length;
    const upCount = upOrangeRecords.length - offRateCount;

    return {
      totalPulls,
      eliteCount,
      eliteAverage: eliteCount > 0 ? totalPulls / eliteCount : null,
      upCount,
      offRateCount,
      upRate: upOrangeRecords.length > 0 ? upCount / upOrangeRecords.length : null,
      includedPools: [...GENERAL_RECRUITMENT_POOLS],
      upPools: [...UP_POOLS]
    };
  }

  function combineCompletedUpCosts(costs) {
    const spent = costs.reduce((sum, cost) => sum + (cost.spent || 0), 0);
    const upCount = costs.reduce((sum, cost) => sum + (cost.upCount || 0), 0);
    return {
      spent,
      upCount,
      average: upCount > 0 ? spent / upCount : null
    };
  }

  function getLuckTone(metricType) {
    if (metricType === "best") return { className: "luck-positive", label: "表現較佳" };
    if (metricType === "worst") return { className: "luck-negative", label: "較高成本" };
    if (metricType === "worstWithOffRate") return { className: "luck-warning", label: "含歪高成本" };
    return { className: "luck-neutral", label: "尚未建立可靠基準" };
  }

  function getSelectedFirstEliteStatus(records) {
    const selectedRecords = records.filter(record =>
      record.source === "自選人形" || record.source === "自選武器"
    );
    const poolCount = new Set(selectedRecords.map(record => String(record.poolId || "manual"))).size;
    return {
      status: "unknown",
      label: "首橙狀態：無法判定",
      detail: poolCount > 0
        ? `現有資料涵蓋 ${poolCount} 個 pool_id，但沒有能證明紀錄從第一抽開始的完整性標記。`
        : "尚無自選池紀錄，無法判定首橙事件。"
    };
  }

  global.gf2OverviewStats = Object.freeze({
    GENERAL_RECRUITMENT_POOLS,
    UP_POOLS,
    computeOverviewSummary,
    combineCompletedUpCosts,
    getLuckTone,
    getSelectedFirstEliteStatus
  });
})(window);
