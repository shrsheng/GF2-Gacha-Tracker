const fs = require("fs");
const path = require("path");
const { Reader } = require("protobufjs/minimal");

function readFields(buffer) {
  const reader = Reader.create(buffer);
  const fields = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const number = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) fields.push({ number, wire, value: Number(reader.uint64().toString()) });
    else if (wire === 1) fields.push({ number, wire, value: reader.fixed64().toString() });
    else if (wire === 2) fields.push({ number, wire, value: Buffer.from(reader.bytes()) });
    else if (wire === 5) fields.push({ number, wire, value: reader.fixed32() });
    else throw new Error(`Unsupported protobuf wire type: ${wire}`);
  }
  return fields;
}

function first(fields, number, wire) {
  return fields.find(field => field.number === number && (wire === undefined || field.wire === wire));
}

function nestedVarint(fields, number) {
  const field = first(fields, number, 2);
  if (!field) return undefined;
  return first(readFields(field.value), 1, 0)?.value;
}

function text(fields, number) {
  const field = first(fields, number, 2);
  return field?.value.toString("utf8");
}

function loadIndexedTable(filename) {
  const file = fs.readFileSync(filename);
  if (file.length < 8) throw new Error(`${filename}: file is too small`);

  const indexLength = file.readUInt32LE(0);
  const dataStart = 4 + indexLength;
  if (dataStart >= file.length) throw new Error(`${filename}: invalid index length ${indexLength}`);

  const indexFields = readFields(file.subarray(4, dataStart));
  const locations = [];
  for (const field of indexFields) {
    if (field.number !== 3 || field.wire !== 2) continue;
    const entry = readFields(field.value);
    const locationField = first(entry, 2, 2);
    if (!locationField) continue;
    const location = readFields(locationField.value);
    const offset = first(location, 1, 0)?.value;
    const length = first(location, 2, 0)?.value;
    if (!Number.isInteger(offset) || !Number.isInteger(length)) continue;
    if (dataStart + offset + length > file.length) {
      throw new Error(`${filename}: record points outside the file`);
    }
    locations.push({ offset, length });
  }
  return { file, dataStart, locations };
}

function eachRow(table, callback) {
  for (const { offset, length } of table.locations) {
    const block = table.file.subarray(table.dataStart + offset, table.dataStart + offset + length);
    for (const field of readFields(block)) {
      if (field.number === 1 && field.wire === 2) callback(readFields(field.value));
    }
  }
}

function loadLanguageMap(filename) {
  const table = loadIndexedTable(filename);
  const language = new Map();
  eachRow(table, fields => {
    const id = first(fields, 1, 0)?.value;
    const value = text(fields, 2);
    if (Number.isInteger(id) && value !== undefined) language.set(id, value);
  });
  return language;
}

function localizedName(fields, language, previous) {
  const nameId = nestedVarint(fields, 2);
  return language.get(nameId) || previous || text(fields, 4) || "未知";
}

function localizedType(rawType, category) {
  if (rawType === "Character" && category === 10) return "人形";
  if (rawType === "Weapon" && category === 20) return "武器";
  return "未知";
}

function localizedRarity(rank) {
  if (rank === 5) return "橙色";
  if (rank === 4) return "紫色";
  if (rank === 3) return "藍色";
  return "未知";
}

const [itemFilename, languageFilename, outputFilename = "itemMap.generated.json", previousFilename] = process.argv.slice(2);
if (!itemFilename || !languageFilename) {
  console.error("Usage: node tools/generate-item-map.js ItemData.bytes LangPackageTableZhtcData.bytes [output.json] [previous.json]");
  process.exit(1);
}

const previous = previousFilename ? JSON.parse(fs.readFileSync(previousFilename, "utf8")) : {};
const language = loadLanguageMap(languageFilename);
const itemTable = loadIndexedTable(itemFilename);
// Retain IDs removed from the current client tables so previously synchronized
// pull history can still resolve its item names.
const itemMap = { ...previous };
const rawTypeCounts = {};

eachRow(itemTable, fields => {
  const id = first(fields, 1, 0)?.value;
  if (!Number.isInteger(id)) return;
  const rawType = text(fields, 19) || "";
  rawTypeCounts[rawType || "(empty)"] = (rawTypeCounts[rawType || "(empty)"] || 0) + 1;
  itemMap[id] = {
    name: localizedName(fields, language, previous[id]?.name),
    type: localizedType(rawType, first(fields, 5, 0)?.value),
    rarity: localizedRarity(first(fields, 8, 0)?.value),
    icon: text(fields, 7) || previous[id]?.icon || "Unknow"
  };
});

const sorted = Object.fromEntries(Object.entries(itemMap).sort(([a], [b]) => Number(a) - Number(b)));
fs.writeFileSync(outputFilename, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  itemRows: Object.keys(sorted).length,
  languageRows: language.size,
  rawTypeCounts,
  output: path.resolve(outputFilename)
}, null, 2));
