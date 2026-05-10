# CLAUDE.md — Switch Vault（SELA 遊戲管理租借系統）

> **這份是給下次 Claude 看的工作上下文，不是文件。**
> 判斷標準只有一個：下次 Claude 讀完，能不能直接動手？
> 每升一版至少更新三處：踩過的坑、版本歷程、下版候選工作。

---

## 〇、當前狀態

- **版本：** V1.14.0
- **狀態：** 上線中（Railway）
- **一句話定位：** 實體遊戲卡帶收藏與借出管理，整合巴哈商城中文名稱與封面，支援多用戶公開收藏與跨用戶借用申請
- **技術棧：** Python 3.11 + FastAPI + SQLite / React 18 + Vite / 部署 Railway Hobby Plan
- **入口點：** `main.py`（FastAPI app），前端由 `frontend/src/App.jsx` 組成
- **線上網址：** https://switch-production-13a3.up.railway.app
- **GitHub：** https://github.com/Sela1227/switch

### Kit 衝突仲裁（V1.14.0 首次對齊 SELA Starter Kit）
- **配色保留現有方案**（`#e60012` 主紅 / `#f97316` 巴哈橘 / `#1d4ed8` 編號藍 / 深色背景），已有 10+ 版用戶驗證，不改色
- SELA Logo 已嵌入 header（base64 inline，於 `SELA_LOGO` 常數）；SVG 原始檔另放 `frontend/public/favicon/`
- 版本號 V1.13.x 的 `c` 超過 9 未進位（歷史遺留），V1.14.0 起從這個版本號繼續，之後遵守 Kit 三位數進位規則

---

## 一、技術棧決策

| 選擇 | 替代品 | 選這個的理由 |
|------|--------|------------|
| FastAPI + SQLite | Django / PostgreSQL | 輕量單人用、Railway Volume 持久化、部署簡單 |
| React + Vite | 純 HTML | 動態 UI 複雜度高（modal、即時搜尋、多 tab）|
| 單一 Railway service | 前後端分離 | 省費用（$1-2/月），靜態由 FastAPI serve |
| BeautifulSoup 爬蟲 | Playwright / Selenium | 巴哈 HTML 可靜態解析，不需 JS 渲染 |
| base64 封面直存 DB | S3 / Cloudflare R2 | 遊戲數量可控（< 5000 筆），URL 類封面幾乎不佔空間 |

---

## 二、業務對映表

| 業務概念 | 程式實作 | 改這個動哪 |
|---------|---------|----------|
| 遊戲 | `games` 表 + `GameIn` model | `main.py` init_db + GameIn + list_games 回傳 dict |
| 用戶 | `users` 表（id, name, is_public） | `main.py` + `App.jsx` myUserId() / loadAll() |
| 借出記錄 | `borrows` 表 | `main.py` borrows CRUD + `App.jsx` BorrowRow |
| 跨用戶借用申請 | `borrow_requests` 表 | `main.py` borrow-requests API + `App.jsx` 探索頁籤 |
| 巴哈遊戲名稱庫 | `game_name_map` 表 + `gamer_search` API | `main.py` 爬蟲 + `App.jsx` translateGameName |
| 社群封面 | `game_covers` 表 | `main.py` game-covers API + `App.jsx` 換封面 modal |

**改業務欄位時同步三處：**
1. `init_db()` 的 `CREATE TABLE` + `ALTER TABLE` 遷移
2. Pydantic Model（`GameIn` / `BorrowIn` 等）
3. `App.jsx` 的 POST body 和 state 對映（camelCase ↔ snake_case）

---

## 三、關鍵檔案路徑

| 想改什麼 | 動哪些檔 |
|---------|---------|
| DB schema / 欄位 | `main.py` → `init_db()` |
| API 路由 | `main.py` → `@app.get/post/patch/delete` |
| 搜尋邏輯（巴哈） | `main.py` → `gamer_search()` + `get_acg_detail()` |
| 翻譯退回流程 | `App.jsx` → `translateGameName()` |
| 卡片 UI | `App.jsx` → `function GameCard()` |
| 詳情 Modal | `App.jsx` → `{modal === "gameDetail" && ...}` |
| 換封面 Modal | `App.jsx` → `{showCoverPicker && selGame && ...}` |
| 設定頁 | `App.jsx` → `{modal === "settings" && ...}` + `GamerCrawlSection` |
| Header logo / 版本 | `App.jsx` → `SELA_LOGO` 常數 + `VERSION` 常數 |
| 底部 Nav | `App.jsx` → `<nav>` + `NavItem` |
| 探索頁籤 | `App.jsx` → `{tab === "explore" && ...}` |

---

## 四、踩過的坑（編號累積，永不重排）

**#1. @app.get 裝飾器被 str_replace 移位**
- 症狀：`GET /api/gamer-search?q=` 回傳 422 Unprocessable Entity
- 原因：str_replace 範圍太大，裝飾器從 `gamer_search` 移位到 `clean_gamer_name`，FastAPI 把清理函數當路由
- 做法：`grep -n "@app.get.*路由名" main.py` 確認裝飾器位置；str_replace 前先 view 確認完整邊界

**#2. Railway sandbox 封網 ≠ 正式環境也封**
- 症狀：本機爬蟲測試全部 403，誤以為巴哈封鎖了 Railway
- 原因：Claude bash_tool sandbox 有網路白名單，Railway 正式服務不受此限制
- 做法：加 `/api/admin/gamer-debug` endpoint，部署後直接打 URL 確認

**#3. atmItem sn ≠ ACG sn（封面用不同數字）**
- 症狀：封面 URL 組出來的圖片是錯的
- 原因：`buy.gamer.com.tw/atmItem.php?sn=38966` 是商品編號；CDN 封面用 `acg.gamer.com.tw/acgDetail.php?s=142248`，兩個完全不同
- 做法：fetch atmItem 頁找 acgDetail 連結，取真正的 ACG sn 再組 CDN URL

**#4. 巴哈封面副檔名 JPG/PNG 不固定**
- 症狀：部分遊戲封面破圖
- 原因：CDN URL 格式固定但副檔名沒規律，`find_acg_cover()` 需兩種都試
- 做法：依序 HEAD request 試 `.JPG` → `.PNG`，200 就用

**#5. asyncio.gather 在 FastAPI async endpoint 內不穩定**
- 症狀：搜尋結果有時空白有時正常
- 原因：`gather` 包 async lambda 在 FastAPI event loop 下行為不確定（對應跨專案坑 #25）
- 做法：改普通 for loop + await，不用 gather；加詳細 print log 確認每步

**#6. acg / buy / search 三個子站用途不同（預埋）**
- 症狀：用 `search.gamer.com.tw` 爬不到結果（Google CSE 渲染，httpx 拿不到 JS 渲染後資料）
- 原因：`search.gamer.com.tw` 是 Google Custom Search；`acg.gamer.com.tw/search.php?keyword=` 才是直接可爬的作品資料庫
- 做法：永遠用 `acg.gamer.com.tw/search.php?keyword=`，`buy.gamer.com.tw` 作退路

**#7. DB 欄位新增忘了同步三處（預埋）**
- 症狀：SQLite `column count mismatch` 或 API 回傳少欄位
- 原因：`init_db` 加欄位、但 INSERT 語句欄位數或 Pydantic model 沒同步
- 做法：每次加欄位，`init_db` + model + endpoint 三處同時更新

---

## 五、煙霧測試

```bash
# 後端語法檢查
python -m py_compile main.py

# 確認路由全部註冊
python -c "from main import app; routes=[r.path for r in app.routes]; print(len(routes),'routes'); print(routes)"

# 前端 build 測試（打包前必跑）
cd frontend && npm run build

# 找不該存在的 debug 訊息
grep -rn "console.log" frontend/src/ || true

# 部署後驗證（替換為實際 URL）
curl https://switch-production-13a3.up.railway.app/api/config
curl "https://switch-production-13a3.up.railway.app/api/gamer-search?q=pikmin"
curl "https://switch-production-13a3.up.railway.app/api/admin/gamer-debug?q=pokopia"
```

---

## 六、版本歷程（最近 10 版）

| 版本 | 重點 |
|------|------|
| V1.14.0 | 對齊 SELA Starter Kit：補 CLAUDE.md 章法 / README 品牌格式 / .gitignore / favicon 套組 |
| V1.13.26 | 編號移至右下角；刪除加確認；借出後回詳情 modal；modal 關閉重置狀態 |
| V1.13.25 | 多個 UX 修正：複製遊戲功能、儲存自動關閉 |
| V1.13.23 | gamer_search 裝飾器修復（422 bug），acg keyword 參數，og:title 取正確名稱 |
| V1.13.19 | 搜尋帶平台參數過濾非 Switch 結果 |
| V1.13.17 | 修 @app.get 誤掛 clean_gamer_name；搜尋改純巴哈中文直搜 |
| V1.13.13 | fetch acgDetail 取 og:title + og:image；三層退回搜尋策略 |
| V1.13.10 | 並行 fetch atmItem 取真正 ACG sn；封面 URL 正確 |
| V1.12.9 | 即時搜尋巴哈商城取中文名+封面；封面 URL 規律解析 |
| V1.12.0 | 多用戶架構；探索頁籤；跨用戶借用申請；公開/私人設定 |

> V1.0.0–V1.11.x：單用戶收藏管理基礎建設（RAWG/IGDB 搜尋、巴哈名稱庫、卡片 UI 迭代）

---

## 七、下版候選工作

1. **Google OAuth 登入** — 現在 userId 用 localStorage，架構已預留（`users` 表已建），串接後只需把 `myUserId()` 改為 OAuth token 解碼的 sub，其餘邏輯不動
2. **借出提醒推播**（LINE Notify 或 Web Push）— 逾期遊戲自動通知借出者
3. **搜尋支援英文關鍵字時自動查 RAWG** — 現在純巴哈中文，英文遊戲名（如 indie 遊戲）找不到
4. **封面 base64 超過 5MB 警告** — 防止 Railway Volume 被大量 base64 撐爆
5. **IGDB 串接恢復** — 直式高品質封面（dev.twitch.tv 申請，需開 2FA）

---

## 八、升版必讀

### V1.14.0 部署動作
- [ ] 推 main（僅 .gitignore / CLAUDE.md / README.md / favicon 更動，無 DB schema 變更）
- [ ] 等待 Railway 重新部署（約 3-5 分鐘）
- [ ] 部署後測：訪問首頁確認 favicon 顯示正確

### Railway 環境變數（必須設定）
| 變數 | 說明 |
|------|------|
| `ADMIN_PIN` | 管理員 PIN（目前 auth 已停用，未來啟用時需要） |
| `DB_PATH` | `/data/switch_vault.db`（Railway Volume 掛載點）|
| `RAWG_API_KEY` | RAWG.io API key（搜尋封面用）|

---

## 九、一句話總結

V1.14.0 完成 SELA Starter Kit 對齊（CLAUDE.md 章法 / README 品牌格式 / .gitignore / favicon），核心功能已可用（巴哈中文搜尋 + 封面 + 多用戶借用）；下版第一優先是串接 Google OAuth 讓多用戶身分識別從 localStorage 升級為正式登入。
