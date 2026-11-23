# GF2 官方獨立角色頭像

來源：

- https://gf2.pde.tw/roleinfo/
- https://gf2.sunborngame.com/main/roleInfo
- https://gf2-cn.cdn.sunborngame.com/

共收錄 69 位角色詳情頁切換器使用的獨立透明 PNG 頭像。圖片保留官方原檔尺寸（79 × 79 或 82 × 82），不使用 `allroles-roles-*` 列表圖片，也不是從立繪裁切產生。

## 程式映射

將壓縮檔內的 `assets` 資料夾複製到 GF2-Gacha-Tracker 專案根目錄並允許合併。

正式程式需在 `characterArtMap.json` 的角色項目中加入：

```json
{
  "head": "../assets/roles/heads/角色ID.png",
  "officialId": 角色ID
}
```

`head-map.json` 已提供繁體角色名稱、官方 ID 及檔案路徑對照。

全部頭像以官方角色 ID 命名；`head-map.json` 保存繁中名稱、角色 ID、檔案名稱及官方原始來源。

本資源僅供 GF2-Gacha-Tracker 非官方統計工具使用，圖片著作權屬原權利人所有。
