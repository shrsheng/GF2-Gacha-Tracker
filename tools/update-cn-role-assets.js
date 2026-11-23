const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const officialPage = "https://gf2.sunborngame.com/main/roleInfo?id=1081";
const roleRoot = path.join(projectRoot, "assets", "roles");
const manifestFile = path.join(projectRoot, "characterArtMap.json");

const traditionalNameMap = {
  "伊格蕾塔": "伊格蕾塔",
  "阿斯缇亚": "阿斯緹亞",
  "克莱妲": "克萊妲",
  "芙铃": "芙鈴",
  "维尔德": "維爾德"
};

function extractArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Unable to locate ${marker}`);
  const start = source.indexOf("[", markerIndex);
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth++;
    else if (character === "]" && --depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Unclosed array after ${marker}`);
}

function splitObjects(arrayText) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;

  for (let index = 1; index < arrayText.length - 1; index++) {
    const character = arrayText[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" && depth++ === 0) start = index;
    else if (character === "}" && --depth === 0) objects.push(arrayText.slice(start, index + 1));
  }

  return objects;
}

function parseLatestRoles(bundle) {
  const assetModules = new Map(
    [...bundle.matchAll(/(?:^|[,{}])(\d+):function\(e\)\{e\.exports="(https:[^"]+)"\}/g)]
      .map(match => [match[1], match[2]])
  );
  const list = extractArray(bundle, "mainList:[{id:");

  return splitObjects(list).map(objectText => {
    const id = objectText.match(/^\{id:(\d+)/)?.[1];
    const simplifiedName = objectText.match(/name:"([^"]+)"/)?.[1];
    const displayModule = objectText.match(/roleImg:__webpack_require__\((\d+)\)/)?.[1];
    const illustrationModule = objectText.match(/ilusUrl:__webpack_require__\((\d+)\)/)?.[1];
    return {
      id,
      name: traditionalNameMap[simplifiedName] || simplifiedName,
      displayUrl: assetModules.get(displayModule),
      illustrationUrl: assetModules.get(illustrationModule)
    };
  }).filter(role => role.id && role.name && role.displayUrl && role.illustrationUrl);
}

async function downloadAndOptimize(url, destination, maxSize) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);

  const inputFile = path.join(os.tmpdir(), `gf2-cn-input-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const outputFile = path.join(os.tmpdir(), `gf2-cn-output-${process.pid}-${Math.random().toString(16).slice(2)}.webp`);
  fs.writeFileSync(inputFile, Buffer.from(await response.arrayBuffer()));
  const result = spawnSync("convert", [
    inputFile,
    "-resize", `${maxSize}x${maxSize}>`,
    "-channel", "A", "-level", "12%,100%", "+channel",
    "-quality", "82",
    outputFile
  ], { encoding: "utf8" });
  fs.rmSync(inputFile, { force: true });

  if (result.status !== 0 || !fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
    fs.rmSync(outputFile, { force: true });
    throw new Error(`Unable to optimize ${url}: ${result.stderr}`);
  }
  fs.renameSync(outputFile, destination);
}

async function main() {
  const pageResponse = await fetch(officialPage);
  if (!pageResponse.ok) throw new Error(`${pageResponse.status} ${officialPage}`);
  const page = await pageResponse.text();
  const bundleUrl = page.match(/<script defer="defer" src="([^"]+bundle[^"]+\.js)"/)?.[1];
  if (!bundleUrl) throw new Error("Official bundle URL not found");

  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) throw new Error(`${bundleResponse.status} ${bundleUrl}`);
  const roles = parseLatestRoles(await bundleResponse.text());
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  fs.mkdirSync(path.join(roleRoot, "illustrations"), { recursive: true });
  fs.mkdirSync(path.join(roleRoot, "displays"), { recursive: true });

  for (const role of roles) {
    const illustrationName = `cn-${role.id}.webp`;
    const displayName = `cn-${role.id}.webp`;
    console.log(`[${role.id}] ${role.name}`);
    await Promise.all([
      downloadAndOptimize(role.illustrationUrl, path.join(roleRoot, "illustrations", illustrationName), 820),
      downloadAndOptimize(role.displayUrl, path.join(roleRoot, "displays", displayName), 900)
    ]);
    manifest.roles[role.name] = {
      illustration: `../assets/roles/illustrations/${illustrationName}`,
      display: `../assets/roles/displays/${displayName}`,
      officialId: Number(role.id)
    };
  }

  manifest.sources = [...new Set([...(manifest.sources || [manifest.source].filter(Boolean)), officialPage])];
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Updated ${roles.length} latest official roles.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
