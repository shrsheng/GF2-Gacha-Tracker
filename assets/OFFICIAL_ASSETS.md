# Official visual assets

The following assets were downloaded from the official SUNBORN Girls' Frontline 2 website on 2026-08-30 and are used only as interface decoration in this fan-made statistics tool.

- `gf2-official-logo.png`
  - https://gf2-us-cdn.sunborngame.com/prod/website/official_zf/pc/image/logo_8b397cc031.png
- `gf2-official-title-bg.png`
  - https://gf2-us-cdn.sunborngame.com/prod/website/official_zf/pc/image/title-bg_504ee0156f.png
- `gf2-official-texture.png`
  - https://gf2-us-cdn.sunborngame.com/prod/website/official_zf/pc/image/text-bg_25dba29906.png

Source website: https://gf2exilium.sunborngame.com/

Character artwork is sourced from the official CN character pages and stored as two distinct sets:

- `assets/roles/displays/`: character display renders used by the combined character + signature-weapon cards.
- `assets/roles/illustrations/`: character illustrations used by individual character statistics.
- Latest official character source: https://gf2.sunborngame.com/main/roleInfo?id=1081
- Refresh command: `node tools/update-cn-role-assets.js`

Elite weapon thumbnails are indexed from https://gf2.mcc.wiki/weapon and stored as optimized WebP files. Only rarity 5 (orange/elite) entries are downloaded by `node tools/download-weapon-assets.js`.

Girls' Frontline 2: Exilium and its visual assets are property of their respective rights holders. This project is unofficial and is not endorsed by SUNBORN.
