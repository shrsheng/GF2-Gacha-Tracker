const fs = require("fs");
const { Reader } = require("protobufjs/minimal");

function printable(buffer) {
  const text = buffer.toString("utf8");
  if (!text || text.includes("\ufffd")) return null;
  let visible = 0;
  for (const ch of text) {
    if (ch >= " " || ch === "\n" || ch === "\r" || ch === "\t") visible++;
  }
  return visible / text.length > 0.85 ? text : null;
}

function decode(buffer, depth = 0) {
  const reader = Reader.create(buffer);
  const fields = [];
  try {
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      const field = tag >>> 3;
      const wire = tag & 7;
      if (!field || wire === 3 || wire === 4 || wire > 5) throw new Error("invalid tag");
      if (wire === 0) fields.push([field, "varint", reader.uint64().toString()]);
      else if (wire === 1) fields.push([field, "fixed64", reader.fixed64().toString()]);
      else if (wire === 5) fields.push([field, "fixed32", reader.fixed32()]);
      else {
        const bytes = Buffer.from(reader.bytes());
        const text = printable(bytes);
        let nested = null;
        if (depth < 4) {
          try { nested = decode(bytes, depth + 1); } catch {}
        }
        fields.push([field, "bytes", text, nested, bytes.length]);
      }
    }
  } catch (error) {
    throw error;
  }
  return fields;
}

const filename = process.argv[2];
const offset = Number(process.argv[3] || 4);
const data = fs.readFileSync(filename).subarray(offset);
console.dir(decode(data), { depth: 10, maxArrayLength: 20 });
