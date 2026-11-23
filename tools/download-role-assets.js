const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const pageUrl = "https://gf2.pde.tw/roleinfo/?role=55";
const roleRoot = path.join(projectRoot, "assets", "roles");
const illustrationDir = path.join(roleRoot, "illustrations");
const displayDir = path.join(roleRoot, "displays");
const wallpaperDir = path.join(roleRoot, "wallpapers");
const manifestFile = path.join(projectRoot, "characterArtMap.json");
const missingOnly = process.argv.includes("--missing-only");

const wallpaperUrls = {
  roleBackground: "https://res.17996cdn.net/gf2/kr/images/home/role-bg.png",
  illustrationBackground: "https://res.17996cdn.net/gf2/kr/images/home/ilus-bg.png",
  allRolesBackground: "https://res.17996cdn.net/gf2/kr/images/home/allroles-bg.png",
  allRolesPanel: "https://res.17996cdn.net/gf2/kr/images/home/allroles-roles-bg.png",
  roleDescriptionBackground: "https://res.17996cdn.net/gf2/tw/images/home/role-des-bg.png"
};

function parseRoles(html) {
  return html
    .split(/<div class="swiper-slide swiper-slide[^"]*">/)
    .slice(1)
    .map(body => ({
      name: body.match(/<div class="role-name">([^<]+)</)?.[1]?.trim(),
      illustrationUrl: body.match(/data-src="([^"]*\/ilus-[^"]+)"/)?.[1],
      displayUrl: body.match(/<div class="role-img[^"]*">[\s\S]*?<img class="[^"]*uk-visible@m[^"]*" src="([^"]+)"/)?.[1]
    }))
    .filter(role => role.name && role.illustrationUrl)
    .map(role => ({
      ...role,
      illustrationUrl: role.illustrationUrl.replace(/&amp;/g, "&"),
      displayUrl: role.displayUrl?.replace(/&amp;/g, "&") || null
    }));
}

async function downloadAndOptimize(url, destination, maxSize, quality = 82) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);

  const inputFile = path.join(os.tmpdir(), `gf2-role-${process.pid}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(inputFile, Buffer.from(await response.arrayBuffer()));
  const result = spawnSync("convert", [inputFile, "-resize", `${maxSize}x${maxSize}>`, "-quality", String(quality), destination], {
    encoding: "utf8"
  });
  fs.unlinkSync(inputFile);

  if (result.status !== 0) {
    throw new Error(`ImageMagick failed for ${url}: ${result.stderr}`);
  }
  if (!fs.existsSync(destination) || fs.statSync(destination).size === 0) {
    throw new Error(`Optimized image is empty: ${url}`);
  }
}

async function runQueue(tasks, concurrency = 4) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function main() {
  fs.mkdirSync(illustrationDir, { recursive: true });
  fs.mkdirSync(displayDir, { recursive: true });
  fs.mkdirSync(wallpaperDir, { recursive: true });

  const response = await fetch(pageUrl);
  if (!response.ok) throw new Error(`Unable to load ${pageUrl}: ${response.status}`);
  const roles = parseRoles(await response.text());
  const existingManifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : { roles: {}, wallpapers: {} };
  const legacyNames = new Set(roles.map(role => role.name));
  const manifest = {
    source: pageUrl,
    generatedAt: new Date().toISOString(),
    roles: Object.fromEntries(
      Object.entries(existingManifest.roles || {}).filter(([name]) => !legacyNames.has(name))
    ),
    wallpapers: existingManifest.wallpapers || {},
    sources: existingManifest.sources || [pageUrl]
  };
  const tasks = [];

  roles.forEach((role, index) => {
    const id = String(index).padStart(3, "0");
    const illustrationRelative = `../assets/roles/illustrations/${id}.webp`;
    const illustrationFile = path.join(illustrationDir, `${id}.webp`);
    manifest.roles[role.name] = { illustration: illustrationRelative };
    if (!missingOnly || !fs.existsSync(illustrationFile) || fs.statSync(illustrationFile).size === 0) {
      tasks.push(async () => {
        console.log(`[${index + 1}/${roles.length}] illustration ${role.name}`);
        await downloadAndOptimize(role.illustrationUrl, illustrationFile, 820, 82);
      });
    }

    if (role.displayUrl) {
      const displayRelative = `../assets/roles/displays/${id}.webp`;
      const displayFile = path.join(displayDir, `${id}.webp`);
      manifest.roles[role.name].display = displayRelative;
      if (!missingOnly || !fs.existsSync(displayFile) || fs.statSync(displayFile).size === 0) {
        tasks.push(async () => {
          console.log(`[${index + 1}/${roles.length}] display ${role.name}`);
          await downloadAndOptimize(role.displayUrl, displayFile, 900, 82);
        });
      }
    }
  });

  Object.entries(wallpaperUrls).forEach(([name, url]) => {
    const relative = `../assets/roles/wallpapers/${name}.webp`;
    manifest.wallpapers[name] = relative;
    const wallpaperFile = path.join(wallpaperDir, `${name}.webp`);
    if (!missingOnly || !fs.existsSync(wallpaperFile) || fs.statSync(wallpaperFile).size === 0) {
      tasks.push(async () => {
        console.log(`[wallpaper] ${name}`);
        await downloadAndOptimize(url, wallpaperFile, 1920, 80);
      });
    }
  });

  await runQueue(tasks);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Saved ${roles.length} roles to ${manifestFile}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
