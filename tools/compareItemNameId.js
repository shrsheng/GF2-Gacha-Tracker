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

function readItemNameIdMap(server) {
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
    const nameId = item.name ? String(item.name.id) : "";

    map[id] = {
      id,
      nameId,
      icon: item.icon || ""
    };
  }

  return map;
}

const maps = {};

for (const server of servers) {
  maps[server] = readItemNameIdMap(server);
}

const baseServer = "intl";
const baseMap = maps[baseServer];

const result = {
  baseServer,
  servers,
  summary: {},
  missingInServer: {},
  extraInServer: {},
  differentNameId: {},
  differentIcon: {}
};

for (const server of servers) {
  const map = maps[server];

  result.summary[server] = {
    itemCount: Object.keys(map).length
  };

  result.missingInServer[server] = [];
  result.extraInServer[server] = [];
  result.differentNameId[server] = [];
  result.differentIcon[server] = [];

  for (const id of Object.keys(baseMap)) {
    if (!map[id]) {
      result.missingInServer[server].push(id);
      continue;
    }

    if (baseMap[id].nameId !== map[id].nameId) {
      result.differentNameId[server].push({
        id,
        intlNameId: baseMap[id].nameId,
        [`${server}NameId`]: map[id].nameId
      });
    }

    if (baseMap[id].icon !== map[id].icon) {
      result.differentIcon[server].push({
        id,
        intlIcon: baseMap[id].icon,
        [`${server}Icon`]: map[id].icon
      });
    }
  }

  for (const id of Object.keys(map)) {
    if (!baseMap[id]) {
      result.extraInServer[server].push(id);
    }
  }
}

const outputPath = path.join(rootDir, "compare-item-nameid-result.json");

fs.writeFileSync(
  outputPath,
  JSON.stringify(result, null, 2),
  "utf-8"
);

console.log("比較完成：compare-item-nameid-result.json");
console.log("");

for (const server of servers) {
  console.log(`[${server}]`);
  console.log("item 數量：", result.summary[server].itemCount);
  console.log("缺少 item：", result.missingInServer[server].length);
  console.log("額外 item：", result.extraInServer[server].length);
  console.log("nameId 不同：", result.differentNameId[server].length);
  console.log("icon 不同：", result.differentIcon[server].length);
  console.log("");
}