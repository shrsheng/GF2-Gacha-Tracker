const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("src/index.html", "utf8");
const css = fs.readFileSync("src/style.css", "utf8");
const renderer = fs.readFileSync("src/renderer.js", "utf8");

const recordsPage = html.match(/<section id="recordsPage"[\s\S]*?<\/section>/)?.[0] || "";
assert.doesNotMatch(recordsPage, /<h2>資料中心<\/h2>/, "資料中心內容區不得重複頂部頁面標題");
assert.match(html, /搜尋人形、武器或卡池名稱/);
assert.match(css, /\.page-heading p\{font-size:13px\}/, "頁面副標應提高可讀性");
assert.match(css, /\.data-action-grid small\{font-size:11px/, "資料中心操作說明不可過小");

assert.match(html, /class="kpi-grid"/);
assert.match(html, /assets\/logos\/GF2GT_02_Ash_Hood\.png/);
assert.doesNotMatch(html, /<small>GACHA TRACKER<\/small>/, "新 Logo 已包含副標，不應重複顯示");
assert.match(html, /id="brandLogoModal"/);
assert.match(html, /id="brandLogoGrid"/);
assert.match(renderer, /const brandLogoOptions = \[/);
assert.match(renderer, /gf2gt\.ui\.brandLogo/);
assert.match(renderer, /localStorage\.setItem\(BRAND_LOGO_PREF_KEY/);
assert.match(renderer, /initBrandLogoSelector\(\)/);
assert.doesNotMatch(renderer, /id: "01"/, "主題 01 必須從 Logo 清單移除");
for (const characterName of ["OTs-14", "芙鈴", "克萊妲", "阿斯緹亞", "伊格蕾塔", "希麗雅", "代理人", "針", "破壞者"]) {
  assert.match(renderer, new RegExp(`label: "${characterName}"`), `Logo 選項應顯示角色名：${characterName}`);
}
assert.doesNotMatch(renderer, /label: "主題 \d+/, "Logo 選項不可再使用主題編號命名");
assert.match(renderer, /saved : "02"/);
assert.equal((html.match(/class="kpi-card/g) || []).length, 4, "總覽必須維持四張 KPI");
assert.match(html, /id="overallAverage"/);
assert.match(html, /id="overallUpAverage"/);
assert.doesNotMatch(html, /class="overview-notes"/, "底部統計口徑列必須移除");
assert.doesNotMatch(html, /一般招募池合計（包含新手採購）/, "KPI 可見副標必須精簡");
assert.doesNotMatch(html, /切換指標，快速比較五種招募池/, "卡池標題區不應保留多餘副標");
assert.equal((html.match(/data-overview-mode=/g) || []).length, 4, "必須提供三種預設模式與自訂顯示模式");
assert.match(html, /data-overview-mode="custom"/);
assert.match(html, /id="overviewCustomPanel"/);
assert.match(html, /id="overviewCustomOptions"/);
assert.match(html, /id="overviewCustomTab"/);
assert.match(html, /id="overviewCustomChevron"/);
assert.match(html, /id="overviewCustomReset"/);
assert.match(html, /aria-controls="overviewCustomBody"/);
assert.match(html, /id="poolSliderViewport"/);
assert.match(html, /id="poolSliderPrev"/);
assert.match(html, /id="poolSliderNext"/);
assert.doesNotMatch(html, /常規與新手採購不參與 UP 命中率/,
  "首頁不應直接放置過長備註句子");

assert.match(css, /container: appmain \/ inline-size/);
assert.match(css, /scroll-snap-type: x mandatory/);
assert.match(css, /--visible-cards: 3/);
assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(css, /#overviewPage \.kpi-card:nth-child\(4\) \.metric-info::after/);
assert.match(css, /font: 12px\/1\.6 "Microsoft JhengHei"/,
  "資訊提示文字必須提高至可閱讀字級");
assert.match(css, /\.overview-custom-panel/);
assert.match(css, /\.overview-custom-chevron/);
assert.match(css, /button\[aria-expanded="true"\] \.overview-custom-chevron/);
assert.match(css, /\.overview-custom-footer/);
assert.match(css, /grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /#overviewPage \.luck-positive \{ color: #1F7451/);
assert.match(css, /#overviewPage \.luck-warning \{ color: #965B22/);
assert.match(css, /#overviewPage \.luck-negative \{ color: #B43F44/);
assert.match(css, /clip-path: none/);
assert.match(css, /\.pool-slider-controls button[\s\S]*background: #243542/);
assert.match(css, /#overviewPage \.kpi-card \{ min-height: 116px/);
assert.match(css, /--overview-bg: #15222D/);
assert.match(css, /--stat-positive: #187A50/);
assert.match(css, /--stat-negative: #C43D3D/);

assert.match(renderer, /openAnalysisForPool\(poolName\)/);
assert.match(renderer, /gf2\.overview\.statMode/);
assert.match(renderer, /localStorage\.setItem\(OVERVIEW_MODE_STORAGE_KEY/);
assert.match(renderer, /gf2\.overview\.customFields/);
assert.match(renderer, /gf2\.overview\.customCollapsed/);
assert.match(renderer, /customTab\.setAttribute\("aria-expanded"/);
assert.match(renderer, /customFields = \["total"\]/,
  "重設後必須只保留總抽數");
assert.match(renderer, /customFields\.length === 1 && input\.checked/,
  "自訂欄位必須至少保留一項");
assert.match(renderer, /customFields\.push\(input\.value\)/,
  "新勾選欄位必須依勾選順序加入尾端");
assert.match(renderer, /orderedFields\.forEach/,
  "卡片欄位必須依自訂順序重新排列");
assert.match(renderer, /Object\.entries\(modeFields\)\.flatMap/,
  "自訂顯示必須提供三種模式的全部九項欄位");
assert.doesNotMatch(renderer, /customFields\.slice\(0,\s*3\)/,
  "自訂顯示不得限制最多三項");
assert.match(renderer, /localStorage\.setItem\(OVERVIEW_FIELDS_STORAGE_KEY/);
assert.match(renderer, /event\.shiftKey/);
assert.match(renderer, /scrollBy\(\{ left:/);
assert.doesNotMatch(renderer, /function openRecordsForPool/);
assert.match(renderer, /event\.key === "Enter" \|\| event\.key === " "/);

console.log("overview UI contract tests passed");
