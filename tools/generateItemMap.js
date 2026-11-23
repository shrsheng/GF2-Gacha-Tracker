const fs = require("node:fs");
const path = require("node:path");
const protobuf = require("protobufjs/minimal");

function getTableBody(filePath) {
  const file = fs.readFileSync(filePath);
  if (file.length < 4) throw new Error(`${filePath} 不是有效的資料表`);
  const bodyOffset = 4 + file.readUInt32LE(0);
  if (bodyOffset >= file.length) throw new Error(`${filePath} 的索引長度異常`);
  return file.subarray(bodyOffset);
}

function decodeFields(buffer) {
  const reader = protobuf.Reader.create(buffer);
  const result = {};
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    let value;
    if (wireType === 0) value = Number(reader.uint64().toString());
    else if (wireType === 2) value = Buffer.from(reader.bytes());
    else {
      reader.skipType(wireType);
      continue;
    }
    (result[field] ||= []).push(value);
  }
  return result;
}

function decodeRows(filePath) {
  const reader = protobuf.Reader.create(getTableBody(filePath));
  const rows = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if ((tag >>> 3) === 1 && (tag & 7) === 2) rows.push(decodeFields(reader.bytes()));
    else reader.skipType(tag & 7);
  }
  return rows;
}

function nestedVarint(buffer) {
  return buffer ? decodeFields(buffer)?.[1]?.[0] ?? null : null;
}

function generateItemMap(itemDataPath, languageDataPath) {
  const languageMap = new Map(
    decodeRows(languageDataPath)
      .filter(row => row[1]?.[0] != null && row[2]?.[0])
      .map(row => [row[1][0], row[2][0].toString("utf8")])
  );
  const rarityMap = { 2: "綠色", 3: "藍色", 4: "紫色", 5: "橙色" };
  const generated = {};
  for (const row of decodeRows(itemDataPath)) {
    const id = String(row[1]?.[0] ?? "");
    if (!id) continue;
    const itemKind = row[20]?.[0]?.toString("utf8");
    generated[id] = {
      name: languageMap.get(nestedVarint(row[2]?.[0])) || row[5]?.[0]?.toString("utf8") || `未知道具 ${id}`,
      type: itemKind === "Character" ? "人形" : itemKind === "Weapon" ? "武器" : "未知",
      rarity: rarityMap[row[9]?.[0]] || "未知",
      icon: row[8]?.[0]?.toString("utf8") || ""
    };
  }
  return generated;
}

const [itemDataPath, languageDataPath, outputPath = path.resolve("itemMap.json")] = process.argv.slice(2);
if (!itemDataPath || !languageDataPath) {
  console.error("用法：node tools/generateItemMap.js <ItemData.bytes> <LangPackageTableZhtcData.bytes> [itemMap.json]");
  process.exit(1);
}

const previous = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : {};
const generated = generateItemMap(itemDataPath, languageDataPath);
const merged = { ...previous, ...generated };
const added = Object.keys(generated).filter(id => !previous[id]).length;
const changed = Object.keys(generated).filter(id => previous[id] && JSON.stringify(previous[id]) !== JSON.stringify(generated[id])).length;
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`itemMap 更新完成：解析 ${Object.keys(generated).length}、新增 ${added}、更新 ${changed}、保留舊 ID ${Object.keys(previous).filter(id => !generated[id]).length}`);
