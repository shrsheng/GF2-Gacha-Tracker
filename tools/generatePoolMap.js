const fs = require("node:fs");
const path = require("node:path");
const protobuf = require("protobufjs/minimal");

function tableBody(filePath) {
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
  const reader = protobuf.Reader.create(tableBody(filePath));
  const rows = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if ((tag >>> 3) === 1 && (tag & 7) === 2) rows.push(decodeFields(reader.bytes()));
    else reader.skipType(tag & 7);
  }
  return rows;
}

function nestedVarint(buffer) {
  return Buffer.isBuffer(buffer) ? decodeFields(buffer)?.[1]?.[0] ?? null : null;
}

function text(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value == null ? "" : String(value);
}

function isoDate(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : null;
}

function parseRarityItems(value, itemMap) {
  const result = {};
  for (const part of text(value).split(",")) {
    const [rarity, ...ids] = part.split(":");
    if (!rarity || !ids.length) continue;
    result[rarity] = ids.map(id => ({ id, name: itemMap.get(id)?.name || null })).filter(item => item.id);
  }
  return result;
}

function stageNumber(asset) {
  return text(asset).match(/(?:Avatar|Weapon|SelectAvatar|SelectWeapon)(\d+)$/)?.[1] || null;
}

function packedVarints(buffer) {
  if (!Buffer.isBuffer(buffer)) return [];
  const reader = protobuf.Reader.create(buffer);
  const values = [];
  while (reader.pos < reader.len) values.push(reader.uint32());
  return values;
}

function csvCell(value) {
  const source = Array.isArray(value) ? value.join("、") : value ?? "";
  return `"${String(source).replaceAll('"', '""')}"`;
}

function generate(dataDir) {
  const lang = new Map(
    decodeRows(path.join(dataDir, "LangPackageTableZhtcData.bytes"))
      .map(row => [row[1]?.[0], text(row[2]?.[0])])
  );
  const itemMap = new Map(
    decodeRows(path.join(dataDir, "ItemData.bytes")).map(row => [
      String(row[1]?.[0]),
      {
        name: lang.get(nestedVarint(row[2]?.[0])) || text(row[5]?.[0]) || null,
        kind: text(row[20]?.[0]) || null,
        rarity: row[9]?.[0] || null,
        icon: text(row[8]?.[0]) || null
      }
    ])
  );
  const clothes = new Map(
    decodeRows(path.join(dataDir, "GachaClothesData.bytes")).map(row => [
      String(row[1]?.[0]),
      {
        name: lang.get(nestedVarint(row[2]?.[0])) || null,
        featuredItemId: String(row[11]?.[0] || ""),
        characterCode: text(row[14]?.[0]) || null,
        backgroundAsset: text(row[46]?.[0]) || null
      }
    ])
  );
  const typeNames = {
    1: "常規採購",
    2: "新手採購",
    3: "定向採購",
    4: "軍備提升",
    5: "預留／未確認",
    6: "自選人形",
    7: "自選武器",
    8: "神秘箱",
    9: "新裝採購"
  };

  const pools = decodeRows(path.join(dataDir, "GachaData.bytes")).map(row => {
    const poolId = String(row[1]?.[0] ?? "");
    const poolType = row[4]?.[0] ?? null;
    const categoryName = lang.get(nestedVarint(row[9]?.[0])) || typeNames[poolType] || `未知類型 ${poolType}`;
    const characterRateUp = parseRarityItems(row[27]?.[0], itemMap);
    const weaponRateUp = parseRarityItems(row[29]?.[0], itemMap);
    const clothesInfo = clothes.get(poolId);
    const directFeaturedId = text(row[30]?.[0]) || clothesInfo?.featuredItemId || "";
    const directFeatured = directFeaturedId ? itemMap.get(directFeaturedId) : null;
    const featuredFiveStar = [
      ...(characterRateUp[5] || []),
      ...(weaponRateUp[5] || []),
      ...(directFeaturedId && ![...(characterRateUp[5] || []), ...(weaponRateUp[5] || [])].some(item => item.id === directFeaturedId)
        ? [{ id: directFeaturedId, name: directFeatured?.name || null }]
        : [])
    ];
    const featuredFourStar = [...(characterRateUp[4] || []), ...(weaponRateUp[4] || [])];
    const featuredNames = featuredFiveStar.map(item => item.name).filter(Boolean);
    const selectionCandidates = packedVarints(row[36]?.[0]).map(id => ({
      id: String(id),
      name: itemMap.get(String(id))?.name || null
    }));
    const defaultSelectionId = row[37]?.[0] ? String(row[37][0]) : null;
    const phase = stageNumber(row[35]?.[0]);
    let displayName = clothesInfo?.name || categoryName;
    if (!clothesInfo && [3, 4].includes(poolType) && featuredNames.length) displayName = `${categoryName}｜${featuredNames.join("／")}`;
    else if ([6, 7].includes(poolType) && phase) displayName = `${typeNames[poolType]}｜第 ${phase} 期`;

    return {
      poolId,
      poolType,
      categoryName: typeNames[poolType] || categoryName,
      sourceTitle: categoryName,
      displayName,
      startDate: isoDate(row[7]?.[0]),
      endDate: isoDate(row[8]?.[0]),
      featuredFiveStar,
      featuredFourStar,
      featuredItemId: directFeaturedId || null,
      featuredItemName: directFeatured?.name || featuredFiveStar[0]?.name || (clothesInfo?.featuredItemId ? itemMap.get(clothesInfo.featuredItemId)?.name : null) || null,
      selectionCandidates,
      defaultSelectionId,
      defaultSelectionName: defaultSelectionId ? itemMap.get(defaultSelectionId)?.name || null : null,
      phase: phase ? Number(phase) : null,
      bannerAsset: text(row[35]?.[0]) || null,
      detailAsset: text(row[10]?.[0]) || null,
      characterShowAsset: text(row[32]?.[0]) || null,
      clothes: clothesInfo || null
    };
  }).sort((a, b) => (a.startDate || "0000").localeCompare(b.startDate || "0000") || Number(a.poolId) - Number(b.poolId));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "GachaData.bytes + GachaClothesData.bytes + ItemData.bytes + LangPackageTableZhtcData.bytes",
    poolTypeNames: typeNames,
    poolCount: pools.length,
    pools
  };
}

const [dataDir, jsonOutput = "poolMap.generated.json", csvOutput = "poolMap.generated.csv"] = process.argv.slice(2);
if (!dataDir) {
  console.error("用法：node tools/generatePoolMap.js <資料表目錄> [JSON 輸出] [CSV 輸出]");
  process.exit(1);
}

const result = generate(path.resolve(dataDir));
fs.writeFileSync(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
const headers = ["pool_id", "pool_type", "卡池分類", "顯示名稱", "開始日期", "結束日期", "五星UP", "四星UP", "主視覺資源"];
const csvRows = result.pools.map(pool => [
  pool.poolId,
  pool.poolType,
  pool.categoryName,
  pool.displayName,
  pool.startDate,
  pool.endDate,
  pool.featuredFiveStar.map(item => item.name || item.id),
  pool.featuredFourStar.map(item => item.name || item.id),
  pool.bannerAsset
].map(csvCell).join(","));
fs.writeFileSync(csvOutput, `\uFEFF${headers.map(csvCell).join(",")}\n${csvRows.join("\n")}\n`, "utf8");
console.log(`卡池對照表完成：${result.poolCount} 筆 → ${jsonOutput}、${csvOutput}`);
