const assert = require("node:assert/strict");

global.window = {};
require("../src/overview-stats.js");

const stats = window.gf2OverviewStats;
const records = [
  { source: "定向採購", rarity: "藍色", pulls: 10 },
  { source: "定向採購", rarity: "橙色", name: "UP人形", pulls: 1 },
  { source: "常規採購", rarity: "橙色", name: "常駐人形", pulls: 20 },
  { source: "新手採購", rarity: "橙色", name: "新手人形", pulls: 10 },
  { source: "自選武器", rarity: "橙色", name: "歪武器", pulls: 5, offRate: true },
  { source: "神秘箱", rarity: "橙色", name: "限定獎品", pulls: 99 },
  { source: "新裝採購", rarity: "橙色", name: "限定衣裝", pulls: 88 }
];

const summary = stats.computeOverviewSummary(
  records,
  record => record.pulls,
  record => record.offRate === true
);

assert.equal(summary.totalPulls, 46, "一般招募總抽數應排除神秘箱與新裝採購");
assert.equal(summary.eliteCount, 4, "菁英總數應採用一般招募範圍");
assert.equal(summary.eliteAverage, 11.5, "菁英平均應為一般招募總抽數除以菁英總數");
assert.equal(summary.upCount, 1, "UP 分子應排除常規與新手採購");
assert.equal(summary.offRateCount, 1, "UP 分母只包含適用卡池的 UP 與歪");
assert.equal(summary.upRate, 0.5);

const upCost = stats.combineCompletedUpCosts([
  { spent: 120, upCount: 2 },
  { spent: 75, upCount: 1 },
  { spent: 0, upCount: 0 }
]);
assert.equal(upCost.spent, 195);
assert.equal(upCost.upCount, 3);
assert.equal(upCost.average, 65, "UP 平均只彙總已完成區間");

assert.equal(stats.getSelectedFirstEliteStatus(records).status, "unknown", "缺乏完整性標記時不得推測首橙事件");

console.log("overview-stats tests passed");
