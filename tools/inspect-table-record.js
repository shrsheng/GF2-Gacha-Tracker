const fs = require("fs");
const { Reader } = require("protobufjs/minimal");

function readFields(buffer) {
  const reader = Reader.create(buffer);
  const fields = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const number = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) fields.push({ number, wire, value: reader.uint64().toString() });
    else if (wire === 1) fields.push({ number, wire, value: reader.fixed64().toString() });
    else if (wire === 2) fields.push({ number, wire, value: Buffer.from(reader.bytes()) });
    else if (wire === 5) fields.push({ number, wire, value: reader.fixed32() });
    else throw new Error(`Unsupported wire type ${wire}`);
  }
  return fields;
}

function display(buffer, depth = 0) {
  return readFields(buffer).map(({ number, wire, value }) => {
    if (wire !== 2) return { number, value };
    const text = value.toString("utf8");
    const printable = text && !text.includes("\ufffd") && [...text].filter(c => c >= " ").length / text.length > 0.85;
    let nested;
    if (!printable && depth < 4) {
      try { nested = display(value, depth + 1); } catch {}
    }
    return { number, length: value.length, text: printable ? text : undefined, nested };
  });
}

function loadTable(filename) {
  const file = fs.readFileSync(filename);
  const indexLength = file.readUInt32LE(0);
  const index = readFields(file.subarray(4, 4 + indexLength));
  const entries = new Map();
  for (const field of index.filter(x => x.number === 3 && x.wire === 2)) {
    const entry = readFields(field.value);
    const idField = entry.find(x => x.number === 1 && x.wire === 0);
    const locationField = entry.find(x => x.number === 2 && x.wire === 2);
    if (!idField || !locationField) continue;
    const id = idField.value;
    const location = readFields(locationField.value);
    const offsetField = location.find(x => x.number === 1 && x.wire === 0);
    const lengthField = location.find(x => x.number === 2 && x.wire === 0);
    if (!offsetField || !lengthField) continue;
    entries.set(id, {
      offset: Number(offsetField.value),
      length: Number(lengthField.value)
    });
  }
  return { file, dataStart: 4 + indexLength, entries };
}

const [filename, ...ids] = process.argv.slice(2);
const table = loadTable(filename);
console.log({ dataStart: table.dataStart, entries: table.entries.size });
for (const id of ids) {
  const location = table.entries.get(id);
  console.log(`\nID ${id}`, location);
  if (!location) continue;
  const record = table.file.subarray(table.dataStart + location.offset, table.dataStart + location.offset + location.length);
  console.dir(display(record), { depth: 10, maxArrayLength: 100 });
}
