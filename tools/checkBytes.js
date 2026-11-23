const fs = require("fs");

const file = "E:/GF2Exilium/GF2 Game/GF2_Exilium_Data/LocalCache/Data/Table/intl/ItemData.bytes";

const buffer = fs.readFileSync(file);

console.log(buffer.slice(0, 32));
console.log([...buffer.slice(0, 32)].map(b => b.toString(16).padStart(2, "0")).join(" "));