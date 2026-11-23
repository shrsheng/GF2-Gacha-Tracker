const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PAGE_URL = "https://gf2.mcc.wiki/weapon";
const ASSET_BASE = "https://gf2.mcc.wiki";
const outputDir = path.join(ROOT, "assets", "weapons");
const mapPath = path.join(ROOT, "weaponArtMap.json");

const traditionalNames = {
  "银翼匹丝缇": "銀翼匹絲緹", "忏悔罗盘": "懺悔羅盤", "切尔诺伯格": "切爾諾伯格",
  "森牙戾兽": "森牙戾獸", "缄默制裁": "緘默制裁", "绒鼠新星": "絨鼠新星",
  "碎穹嚎歌": "碎穹嚎歌", "卡庇托林": "卡庇托林", "暮色蔷薇": "暮色薔薇",
  "绝影": "絕影", "告死礼赞": "告死禮讚", "夜行豆蔻": "夜行豆蔻",
  "潮涌夜曲": "潮湧夜曲", "绯红契约": "緋紅契約", "因果律理": "因果律理",
  "谧语永护": "謐語永護", "玩具匠": "玩具匠", "刺棘法则": "刺棘法則",
  "伊阿索": "伊阿索", "骄阳构想": "驕陽構想", "流浪者赞歌": "流浪者讚歌",
  "狡狐": "狡狐", "护梦银翼": "護夢銀翼", "流光花火": "流光花火",
  "逐光": "逐光", "厄梅尼塔": "厄梅尼塔", "信仰棘光": "信仰棘光",
  "阿格莱亚": "阿格萊亞", "林野精灵": "林野精靈", "报丧轻语": "報喪輕語",
  "白日梦": "白日夢", "斯库拉": "斯庫拉", "不留行": "不留行",
  "传颂之诗": "傳頌之詩", "未言使命": "未言使命", "流羽白英": "流羽白英",
  "苦涩焦糖": "苦澀焦糖", "光学幻境": "光學幻境", "跃虎": "躍虎",
  "斯摩希克": "斯摩希克", "幼狮": "幼獅", "金石奏": "金石奏",
  "女仆准则": "女僕準則", "梅扎露娜": "梅扎露娜", "重弦": "重弦",
  "游星": "游星", "猎心者": "獵心者", "西比尔": "西比爾", "尼奥尔德": "尼奧爾德",
  "二律背反": "二律背反", "赫斯提亚": "赫斯提亞", "斯瓦罗格": "斯瓦羅格",
  "远行游鸽": "遠行遊鴿", "妙尔尼尔": "妙爾尼爾", "王冠鹿角兔": "王冠鹿角兔",
  "盖尔诺": "蓋爾諾", "阿尔克纳": "阿爾克納", "绝密手稿": "絕密手稿",
  "喧闹恶灵": "喧鬧惡靈"
};

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const html = await (await fetch(PAGE_URL)).text();
  const pattern = /<a href="\/weapon\/([^"]+_5)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+_5_1024\.png)"[^>]*>[\s\S]*?<div[^>]*>([^<]+)<\/div><\/a>/g;
  const entries = [];
  let match;
  while ((match = pattern.exec(html))) {
    entries.push({ id: match[1], source: match[2], sourceName: match[3].trim() });
  }
  if (!entries.length) throw new Error("No elite weapon entries found");

  const map = { weapons: {}, source: PAGE_URL, rarity: 5 };
  await Promise.all(entries.map(async entry => {
    const filename = `${entry.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.webp`;
    const target = path.join(outputDir, filename);
    if (!fs.existsSync(target)) {
      const png = await (await fetch(`${ASSET_BASE}${entry.source}`)).arrayBuffer();
      const temp = path.join(outputDir, `${entry.id}.png`);
      fs.writeFileSync(temp, Buffer.from(png));
      execFileSync("convert", [temp, "-resize", "520x260>", "-quality", "84", target]);
      fs.unlinkSync(temp);
    }
    const name = traditionalNames[entry.sourceName] || entry.sourceName;
    return [name, `../assets/weapons/${filename}`];
  })).then(items => items.forEach(([name, assetPath]) => { map.weapons[name] = assetPath; }));
  fs.writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`Downloaded/indexed ${entries.length} elite weapons.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
