const assert = require("node:assert/strict");
const fs = require("node:fs");

const main = fs.readFileSync("main.js", "utf8");
const preload = fs.readFileSync("preload.js", "utf8");
const html = fs.readFileSync("src/index.html", "utf8");
const renderer = fs.readFileSync("src/renderer.js", "utf8");
const progress = fs.readFileSync("src/progress-v12.js", "utf8");

assert.match(main, /externalAcquisitions:\s*\[\]/, "新舊帳號都必須具備獨立的額外取得欄位");
assert.match(main, /load-external-acquisitions/);
assert.match(main, /save-external-acquisitions/);
assert.match(main, /version:\s*3[\s\S]*externalAcquisitions/, "v3 備份必須包含額外取得資料");
assert.match(preload, /loadExternalAcquisitions/);
assert.match(preload, /saveExternalAcquisitions/);

assert.match(html, /id="externalAcquisitionModal"/);
assert.match(html, /不會加入抽卡紀錄，也不影響機率、平均成本、命中率或歐非排名/);
assert.match(html, /data-data-action="external"/);
assert.match(renderer, /let externalAcquisitions = \[\]/);
assert.match(renderer, /function getExternalAcquisitionCount/);
assert.match(renderer, /Object\.values\(signatureMap \|\| \{\}\)/, "武器清單應使用專武白名單");
assert.match(renderer, /Object\.keys\(signatureMap \|\| \{\}\)/, "人形清單應使用菁英人形白名單");
assert.match(renderer, /generalSources\.has\(record\.source\)[\s\S]*mappedItem\?\.type === expectedType/, "正式紀錄補充項目仍須限制一般招募來源及正確類型");
assert.match(html, /名稱（僅菁英）/);
assert.match(html, /<select id="externalItemName" required>/, "名稱必須使用可捲動的原生下拉選單");
assert.match(renderer, /saveExternalAcquisitions/);
assert.match(renderer, /parsedData\?\.externalAcquisitions/);

assert.match(progress, /ownedCount=stat\.upCount\+externalCount/, "持有進度應合併正式 UP 與額外取得");
assert.match(progress, /completed:character\.ownedCount>=7&&signature\.ownedCount>=1/);
assert.match(progress, /sixSix:character\.ownedCount>=7&&signature\.ownedCount>=6/);
assert.match(progress, /function metricValuesV12\(item\)\{const completedCost=item\.acquisitionPulls/, "統計分母仍須使用正式抽卡成本");
assert.doesNotMatch(renderer, /records\.push\([^)]*external/i, "額外取得不得寫入原始抽卡紀錄");

console.log("external acquisitions isolation tests passed");
