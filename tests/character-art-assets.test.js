const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const map = JSON.parse(fs.readFileSync("characterArtMap.json", "utf8"));
const itemMap = JSON.parse(fs.readFileSync("itemMap.json", "utf8"));
const signatureMap = JSON.parse(fs.readFileSync("signatureMap.json", "utf8"));
const rolesWithHeads = Object.entries(map.roles).filter(([, role]) => role.head);

assert.equal(rolesWithHeads.length, 69, "69 位角色都應使用官方獨立頭像");
for (const [name, role] of rolesWithHeads) {
  const localPath = path.join("src", role.head);
  assert.ok(fs.existsSync(localPath), `${name} 的頭像檔案不存在：${localPath}`);
  assert.ok(fs.statSync(localPath).size > 1000, `${name} 的頭像檔案可能下載不完整`);
}

for (const name of ["克羅麗科", "洛塔", "克萊妲", "阿斯緹亞", "伊格蕾塔"]) {
  const role = map.roles[name];
  assert.match(role?.head || "", /\/heads\/\d+\.png$/, `${name} 應使用以官方角色 ID 命名的新版頭像`);
}

for (const name of ["希麗雅", "代理人", "寇爾芙·鏡刻", "針", "破壞者"]) {
  const role = map.roles[name];
  assert.ok(role?.head && role?.display && role?.illustration, `${name} 必須包含頭像、展示圖與立繪`);
}

for (const [id, name, weapon] of [
  ["1082", "希麗雅", "斯諾特拉"],
  ["1083", "代理人", "惡兆之鑰"],
  ["1084", "寇爾芙·鏡刻", "畢宿五"]
]) {
  assert.equal(itemMap[id]?.name, name, `${name} 必須存在於新版 itemMap`);
  assert.equal(signatureMap[name], weapon, `${name} 必須正確配對專武 ${weapon}`);
}

assert.equal(itemMap["4079"]?.name, "克萊妲心智存檔", "新版語言表必須修正克萊妲心智存檔名稱");
assert.equal(itemMap["178603"]?.name, "木馬協議", "11/19 新增活動道具必須存在");

console.log("character art asset tests passed");
