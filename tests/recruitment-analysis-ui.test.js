const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("src/index.html", "utf8");
const css = fs.readFileSync("src/style.css", "utf8");
const renderer = fs.readFileSync("src/renderer.js", "utf8");
const outfitPoolMap = JSON.parse(fs.readFileSync("outfitPoolMap.json", "utf8"));

assert.equal((html.match(/data-analysis-category=/g) || []).length, 4,
  "招募分析必須提供四種第一層分類");
assert.match(html, /id="analysisPoolFilter"/);
assert.equal((html.match(/data-elite-view=/g) || []).length, 2,
  "菁英歷史必須提供頭像與詳細時間軸兩種視圖");
assert.match(html, /id="eliteTimelineList" class="elite-timeline-list elite-bar-list hidden"/,
  "詳細時間軸必須合併抽數長條圖呈現");
assert.equal((html.match(/data-elite-filter=/g) || []).length, 3,
  "菁英歷史必須提供全部、UP、歪三種篩選");
assert.doesNotMatch(html, /id="recentEliteLimit"/,
  "已有滾動區時不得再限制只顯示 10／20／30 筆");
assert.match(html, /id="advancedAnalysisDetails"/);
assert.doesNotMatch(html, /id="analysisSampleInfo"/,
  "卡池選擇列不得重複顯示菁英數與總抽數");
assert.match(html, /id="recruitmentCompositionChart"/,
  "進階分析左側必須提供招募結果圓餅圖");
assert.match(html, /id="pullDistributionChart"/);
assert.equal((html.match(/data-distribution-view=/g) || []).length, 2,
  "抽數分布必須可切換菁英出貨與 UP 取得成本");
assert.match(html, /id="periodHistoryList"/);
assert.match(html, /id="recruitmentSpecialAnalysis"/);
assert.doesNotMatch(html, /data-history-target=/,
  "新版頁面不得保留第二套卡池頁籤狀態");

assert.match(renderer, /const recruitmentAnalysisState =/);
assert.match(renderer, /character\.head \|\| character\.display \|\| character\.illustration/,
  "出貨歷史必須優先使用獨立角色頭像");
assert.match(renderer, /assetKind: character\.head \? "head" : "fallback"/,
  "角色頭像與裁切備援必須使用不同樣式");
assert.match(renderer, /normalizedType === "武器"/,
  "缺少圖片映射的紫色武器仍必須依中文類型正確分類");
assert.match(renderer, /normalizedType\.includes\("weapon"\)/,
  "武器分類必須相容英文類型資料");
assert.match(renderer, /limited: \["定向採購", "軍備提升"\]/);
assert.match(renderer, /standard: \["常規採購", "新手採購"\]/);
assert.match(renderer, /special: \["新裝採購", "神秘箱"\]/);
assert.match(renderer, /missing:\$\{createRecordId\(record\)\}:\$\{index\}/,
  "缺少 pool_id 的紀錄必須使用逐筆唯一分組鍵");
assert.match(renderer, /getCompletedUpDetails\(poolName\)/);
assert.match(renderer, /\["常規採購", "新手採購"\]\.includes\(poolName\)/);
assert.match(renderer, /pendingRecordFocusId/);
assert.match(renderer, /getPoolCategory\(options\.poolName\)/,
  "總覽卡片導覽必須同步第一層與第二層選擇");
assert.match(renderer, /ANALYSIS_PREF_KEY/);
assert.match(renderer, /eliteFilter: "all"/);
assert.match(renderer, /const filteredHistory = history\.filter/,
  "篩選只能套用既有事件，不得重算出橙間隔");
assert.match(renderer, /const displayEvents = filteredHistory\.slice\(\)\.reverse\(\)/,
  "出貨歷史必須顯示篩選後的全部事件");
assert.match(renderer, /displayEvents\.map\(timelineButton\)/,
  "長條式詳細時間軸必須共用既有排序與篩選後事件");
assert.doesNotMatch(renderer, /event\.time \|\| "日期未知"\}\) · POOL/,
  "詳細時間軸不應顯示無助於閱讀的 pool_id");
assert.match(renderer, /compositionDefinitions/);
assert.match(renderer, /class="composition-segment"/,
  "圓餅圖必須使用可獨立互動的 SVG 分區");
assert.match(renderer, /segment\.dataset\.count/,
  "滑鼠移入圓餅分區時必須顯示數量");
assert.match(renderer, /菁英人形/);
assert.match(renderer, /紫色武器/);
assert.match(renderer, /distributionValues = recruitmentAnalysisState\.distributionView === "up"/,
  "抽數分布的 UP 模式必須使用完整 UP 取得成本");
assert.match(renderer, /const eliteDistributionRanges = Array\.from\(\{ length: 8 \}/,
  "菁英分布必須以 1–80 抽呈現，不得保留 81+ 分組");
assert.match(renderer, /const upDistributionRanges = Array\.from\(\{ length: 8 \}/,
  "UP 取得成本必須以每 20 抽一組呈現至 160 抽");
assert.doesNotMatch(renderer, /label: "81\+"/,
  "菁英 80 抽必保底，不得顯示 81+ 區間");
assert.match(renderer, /definition\?\.displayName/,
  "各期卡池履歷必須優先顯示正式卡池名稱");
assert.doesNotMatch(renderer, /POOL \/\/ \$\{escapeHtml\(group\.poolId\)\}/,
  "各期卡池履歷不得向使用者顯示 pool_id");
assert.match(renderer, /noUpMechanic \? "is-neutral" : event\.isOffRate \? "is-off" : "is-up"/,
  "長條圖必須區分無 UP、歪與命中三種狀態");
assert.match(renderer, /const isolateByPool = poolName\.startsWith\("自選"\)/,
  "自選池出貨間隔必須依 pool_id 獨立計算");
assert.match(renderer, /countByPool\.set\(poolKey, 0\)/,
  "自選池出橙後只重設該 pool_id 的間隔");
assert.doesNotMatch(renderer, /recentLimit/);
assert.doesNotMatch(renderer, /eliteEventDetail"\)\?\.scrollIntoView/,
  "事件詳情不得強制改變頁面捲動位置");
assert.match(renderer, /data-close-event-detail/);
assert.match(renderer, /outfitPoolMap\.itemMatchers\?\.\[String\(record\.itemId\)\]/,
  "濯浪焦點正式 pool_id 未知時，必須能以限定衣裝 ID 安全辨識卡池");
assert.equal(outfitPoolMap.itemMatchers?.["31115"]?.featuredOutfit, "衣裝·濯浪焦點");
assert.equal(outfitPoolMap.itemMatchers?.["31115"]?.image,
  "../assets/special-recruit/pool-koleda-wave-focus-preview.png");
assert.equal(outfitPoolMap.pools?.["254001"]?.featuredOutfit, "衣裝·濯浪焦點",
  "正式 pool_id 254001 必須對應濯浪焦點");
assert.equal(outfitPoolMap.pools?.["254001"]?.exchangeItemId, "276",
  "濯浪代幣 itemId 必須保存於正式卡池定義");
assert.notEqual(outfitPoolMap.pools?.["254001"]?.provisional, true,
  "正式卡池不得顯示 ITEM MATCH 暫定標記");
assert.ok(fs.existsSync("assets/special-recruit/pool-koleda-wave-focus-preview.png"),
  "濯浪焦點暫用主視覺必須隨程式一併提供");
assert.match(renderer, /isRareOutfitReward\(record, definition\)/,
  "新裝採購稀有獎品分類必須使用該期卡池定義");

assert.match(css, /body\.analysis-active \.app-content/);
assert.match(html, /class="recent-elite-list portrait-elite-grid"/);
assert.match(css, /\.elite-portrait-item\.is-character \.elite-avatar \{ width: 56px; height: 56px;[^}]*border-radius: 50%/);
assert.match(css, /\.elite-portrait-item\.is-weapon \.elite-avatar \{[^}]*border: 0;[^}]*background: transparent/,
  "武器不得套用圓框或深色底");
assert.match(css, /\.elite-portrait-item\.is-weapon \.elite-avatar img \{[^}]*rotate\(-45deg\)/,
  "武器圖片必須使用斜向展示");
assert.match(css, /\.elite-pull-badge/);
assert.match(css, /\.elite-timeline-list/);
assert.match(css, /\.elite-bar-list/);
assert.match(css, /\.elite-bar-list \{ display: grid; max-height: 430px/,
  "詳細時間軸必須加高以顯示更多出貨事件");
assert.match(css, /\.elite-bar-event \{[^}]*min-height: 60px/,
  "時間條與文字必須保持足夠高度");
assert.match(css, /\.elite-bar-event\.is-weapon \.elite-bar-avatar img \{[^}]*brightness\(1\.18\)/,
  "深色武器圖片必須提升辨識度");
assert.match(css, /\.composition-donut/);
assert.match(css, /\.composition-segment:hover/,
  "圓餅分區必須支援滑鼠凸顯");
assert.match(css, /\.composition-tooltip/);
assert.match(css, /\.distribution-view-tabs/);
assert.match(css, /\.pull-distribution-chart/);
assert.match(css, /\.elite-bar-event\.is-off \.elite-bar-track i/);
assert.match(css, /\.elite-bar-event\.is-neutral \.elite-bar-track i/);
assert.match(css, /\.period-history-list/);
assert.match(css, /\.analysis-kpi-grid article:not\(\.pity-kpi\):hover/,
  "目前墊抽以外的 KPI 必須支援滑鼠移入深色狀態");
assert.match(css, /\.portrait-elite-grid \{ display: grid; max-height: 210px; overflow-x: hidden; overflow-y: auto/,
  "頭像歷史必須使用固定高度滾動區");
assert.match(css, /\.period-history-list \{ display: grid; max-height: 244px; overflow-x: hidden; overflow-y: auto/,
  "卡池履歷必須使用固定高度滾動區");
assert.match(css, /\.outfit-result-grid \{[^}]*color: #243341;[^}]*background: #eef1f2/,
  "新裝採購淺色內容區必須指定深色文字，不能繼承招募分析的白字");
assert.match(css, /\.visual-reward-list li \{[^}]*color: #243341;[^}]*background: #fff/,
  "衣裝出貨名稱必須在白底維持可讀對比");
assert.match(css, /\.mystery-panel > \.panel-heading h2 \{ color: #243341; \}/,
  "神秘箱淺色標題列不可使用白字");
assert.match(css, /\.mystery-breakdown li \{[^}]*color: #243341;/,
  "神秘箱獎品名稱必須明確指定深色文字");
assert.match(renderer, /<span>菁英機率<\/span><strong>\$\{rate/,
  "菁英機率必須作為 KPI 主值");
assert.match(renderer, /\$\{poolStats\.elite\} 位菁英/,
  "菁英總數必須移至 KPI 副標");
assert.match(renderer, /class="cost-kpi-values"/,
  "菁英平均與 UP 平均必須合併在相同 KPI");
assert.match(css, /@media \(max-width: 900px\)/);
assert.doesNotMatch(html + renderer + fs.readFileSync("src/progress-v12.js", "utf8"), /完成區間|UP 區間|取得區間|區間抽數/,
  "使用者介面不應再以區間描述 UP 取得成本");

console.log("recruitment analysis UI tests passed");
