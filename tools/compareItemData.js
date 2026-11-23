const fs = require("fs");
const path = require("path");
const protobuf = require("protobufjs");

const rootDir = path.join(__dirname, "..");
const serverDataDir = path.join(rootDir, "server-data");

const servers = ["intl", "jp", "kr", "tw", "us"];

const proto = `
syntax = "proto3";

message LanguageStringData {
  int64 id = 1;
}

message ItemData {
  repeated ItemDataUnit Units = 1;
}

message ItemDataUnit {
  int64 id = 1;
  LanguageStringData name = 2;
  int64 type = 5;
  string icon = 7;
  int64 rank = 8;
}
`;

function rarityText(rank) {
  if (rank === 5) return "橙色";
  if (rank === 4) return "紫色";
  if (rank === 3) return "藍色";
  return "未知";
}

function typeText(type) {
  if (type === 10) return "人形";
  if (type === 20) return "武器";
  return "未知";
}

function readItemMap(server) {
  const filePath = path.join(serverDataDir, server, "ItemData.bytes");

  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到檔案：${filePath}`);
  }

  const root = protobuf.parse(proto).root;
  const ItemData = root.lookupType("ItemData");

  const buffer = fs.readFileSync(filePath).subarray(4);
  const itemData = ItemData.decode(buffer);

  const map = {};

  for (const item of itemData.Units) {
    const id = String(item.id);

    map[id] = {
      id,
      typeRaw: Number(item.type),
      rankRaw: Number(item.rank),
      type: typeText(Number(item.type)),
      rarity: rarityText(Number(item.rank)),
      icon: item.icon || ""
    };
  }

  return map;
}

const maps = {};
for (const server of servers) {
  maps[server] = readItemMap(server);
}

const baseServer = "intl";
const baseMap = maps[baseServer];

const result = {
  baseServer,
  servers,
  summary: {},
  missingInServer: {},
  extraInServer: {},
  differentType: {},
  differentRarity: {}
};

for (const server of servers) {
  const map = maps[server];

  result.summary[server] = {
    itemCount: Object.keys(map).length
  };

  result.missingInServer[server] = [];
  result.extraInServer[server] = [];
  result.differentType[server] = [];
  result.differentRarity[server] = [];

  for (const id of Object.keys(baseMap)) {
    if (!map[id]) {
      result.missingInServer[server].push(id);
      continue;
    }

    if (baseMap[id].typeRaw !== map[id].typeRaw) {
      result.differentType[server].push({
        id,
        intl: baseMap[id],
        [server]: map[id]
      });
    }

    if (baseMap[id].rankRaw !== map[id].rankRaw) {
      result.differentRarity[server].push({
        id,
        intl: baseMap[id],
        [server]: map[id]
      });
    }
  }

  for (const id of Object.keys(map)) {
    if (!baseMap[id]) {
      result.extraInServer[server].push(id);
    }
  }
}

const outputPath = path.join(rootDir, "compare-item-result.json");

fs.writeFileSync(
  outputPath,
  JSON.stringify(result, null, 2),
  "utf-8"
);

console.log("比較完成：compare-item-result.json");
console.log("");

for (const server of servers) {
  console.log(`[${server}]`);
  console.log("item 數量：", result.summary[server].itemCount);
  console.log("缺少 item：", result.missingInServer[server].length);
  console.log("額外 item：", result.extraInServer[server].length);
  console.log("type 不同：", result.differentType[server].length);
  console.log("rarity 不同：", result.differentRarity[server].length);
  console.log("");
}