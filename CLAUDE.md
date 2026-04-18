# CLAUDE.md — Switch Vault 開發規範

> 版本：V1.0.0  
> 改編自 DEV-GUIDELINES.md，保留適用條目，移除單一 HTML 專案特有內容。

---

## 零、開發方向與交付規則（最優先）

### 開發基準
- **唯一開發方向：Railway 部署版**
- Claude Artifact 版（`window.storage`）僅為歷史原型，不再維護
- 所有新功能、Bug fix 一律在 Railway 版本上進行

### 打包交付規則（強制）
每次提供下載時，**一定同時給兩個檔案**：

| 檔案 | 內容 | 用途 |
|------|------|------|
| `switch-vault-V1.X.X.zip` | 完整專案原始碼（含 Dockerfile、CLAUDE.md） | 推 GitHub → Railway 部署 |
| `SwitchVault-V1.X.X.jsx` | 轉換後的單檔 Artifact 版（`window.storage`） | 在 Claude 介面快速預覽 UI |

> **原則**：部署檔讓你上線，Source 讓你繼續開發。兩者缺一不可。

### Artifact 預覽版說明
- Artifact 版（`.jsx`）僅供 Claude 介面內快速預覽 UI，**不做本地開發**
- 開發一律在 Railway 版進行，改完 → 打包 → 推 GitHub → Railway 自動重新部署
- Artifact 版由 Claude 在打包時從 Railway 版轉換產出，不手動維護

---

## 一、Claude 工作方式

### 每次修改前必做
1. **先讀**要修改的檔案，確認當前狀態（不依賴對話記憶）
2. 確認修改目標字串確實存在於正確位置
3. 重大修改前備份：`cp frontend/src/App.jsx /tmp/App.backup.jsx`

### 修改後必做（後端）
```bash
# Python 語法檢查
python -m py_compile main.py && echo "OK"
```

### 修改後必做（前端）
```bash
# JS/JSX 語法檢查（需 node）
cd frontend && node --input-type=module < src/App.jsx 2>&1 | head -5
# 或直接 build 驗證
npm run build 2>&1 | tail -10
```

### 版本號命名規則（嚴格遵守）
| 類型 | 增量 | 範例 |
|------|------|------|
| Bug fix / Hotfix | +0.0.1 | V1.0.0 → V1.0.1 |
| 新功能 / 新欄位 | +0.1.0，patch 歸零 | V1.0.0 → V1.1.0 |
| 大改版 / 架構重構 | +1.0.0 | V1.0.0 → V2.0.0 |

版本號要同時更新：`README.md`、`CLAUDE.md`（本檔）、`frontend/src/App.jsx` 內的 title 或 version 常數。

### 命名規則（嚴格遵守）
- zip 檔名：`switch-V1.X.X.zip`
- zip 內資料夾名：`switch/`（不含版本號）
- Artifact 預覽檔名：`switch-V1.X.X.jsx`

### 打包流程（每次，一定產出兩個檔案）
```bash
cd /home/claude
VER="V1.X.X"
# 1. 更新版本號（README.md, CLAUDE.md）
# 2. 語法驗證（見上方）
# 3. 複製為 switch/（不含版本號）
cp -r switch-vault switch
# 4. 打包
zip -r switch-${VER}.zip switch/ \
  --exclude "switch/frontend/node_modules/*" \
  --exclude "switch/frontend/dist/*" \
  --exclude "switch/__pycache__/*" \
  --exclude "switch/*.db"
cp switch-${VER}.zip /mnt/user-data/outputs/
# 5. 產出 Artifact 預覽版
cp switch-vault/frontend/src/App.jsx /mnt/user-data/outputs/switch-${VER}.jsx
# 6. 清理暫存資料夾
rm -rf switch
# 7. present_files 同時給兩個檔案
```

---

## 二、專案架構

```
switch-vault/
├── main.py              # FastAPI 後端（API + 靜態服務）
├── requirements.txt     # Python 依賴
├── Dockerfile           # 多階段 build（Node → Python）
├── railway.toml         # Railway 部署設定
├── README.md            # 部署說明
├── CLAUDE.md            # 本檔
└── frontend/
    ├── index.html       # PWA 入口
    ├── vite.config.js   # dev proxy: /api → localhost:8000
    ├── package.json
    ├── public/
    │   └── manifest.json
    └── src/
        ├── main.jsx     # React 入口
        └── App.jsx      # 主元件（目前單檔）
```

### API 路由一覽
| Method | Path | 說明 | 需 PIN |
|--------|------|------|--------|
| GET | /api/games | 取得所有遊戲 | ✗ |
| POST | /api/games | 新增遊戲 | ✅ |
| DELETE | /api/games/{id} | 刪除遊戲 | ✅ |
| GET | /api/borrows | 取得所有借出紀錄 | ✗ |
| POST | /api/borrows | 新增借出 | ✅ |
| PATCH | /api/borrows/{id}/return | 確認歸還 | ✅ |
| GET | /api/config | 取得 RAWG API Key | ✗ |

---

## 三、React 開發規則

### 本專案用 React，以下 DEV-GUIDELINES 條目**不適用**
- `data-action` + event delegation → React 直接用 `onClick`，不需 delegation
- `innerHTML` 注入 → 本專案不使用 innerHTML
- Brace 平衡計算 → JSX 由 Vite/Babel 編譯，語法錯誤會直接 build 失敗

### ✅ 本專案適用的 JS 規則

**函數修改原則（完整替換）**
```jsx
// ❌ 拼貼修改（易造成 brace 不平衡）
// 只修改函數中間幾行

// ✅ 完整替換整個函數
async function submitBorrow() {
  // 完整的函數體
}
```

**重複 const 宣告防範（BUG-E 對應）**
- 修改 `App.jsx` 前先確認 state 宣告，避免 `useState` 重複
- 新增 state 前用 `grep` 確認名稱不衝突：
```bash
grep "useState\|const \[" frontend/src/App.jsx | head -20
```

**`</script>` 拆寫規則（BUG-F 延伸）**
- 本專案為 JSX，無此問題，但 `index.html` 若需嵌入 JS 仍適用

---

## 四、後端規則（FastAPI）

### API 修改時確認
```bash
# 修改 main.py 後
python -m py_compile main.py && echo "Syntax OK"

# 確認 endpoint 沒衝突
grep "@app\." main.py
```

### SQLite 資料遷移規則
> 對應 DEV-GUIDELINES BUG-H（DEFAULT 資料更新對已存資料無效）

**Railway Volume 上的 SQLite 在 redeploy 後依然存在**，欄位若有異動需加遷移：

```python
# main.py 的 init_db() 中，新增欄位用 ALTER TABLE 而非重建
def init_db():
    conn = get_db()
    # 建表（新部署）
    conn.execute("CREATE TABLE IF NOT EXISTS games (...)")
    
    # 欄位遷移（舊部署升級）
    try:
        conn.execute("ALTER TABLE games ADD COLUMN new_field TEXT")
    except:
        pass  # 已存在則忽略
    conn.commit()
```

**規則**：任何 DB schema 變更，必須問：
> 「Railway Volume 上已有的資料庫會怎樣？」→ 必要時寫 ALTER TABLE。

---

## 五、環境變數

| 變數 | 必填 | 預設值 | 說明 |
|------|------|--------|------|
| `ADMIN_PIN` | ✅ | `1234` | 管理員 PIN（務必修改）|
| `RAWG_API_KEY` | 建議 | `""` | 遊戲封面搜尋 API |
| `DB_PATH` | ✅ | `/data/switch_vault.db` | SQLite 路徑 |

---

## 六、部署位置

| 項目 | 位址 |
|------|------|
| GitHub Repo | https://github.com/Sela1227/switch |
| Railway URL | https://switch-production-13a3.up.railway.app |

---

## 七、Railway 部署 Checklist

```
□ Railway Volume 掛載到 /data
□ ADMIN_PIN 已設定（非預設 1234）
□ RAWG_API_KEY 已設定
□ DB_PATH=/data/switch_vault.db
□ railway.toml healthcheckPath = "/api/config"
□ Dockerfile 多階段 build 正常
```

---

## 八、版本歷程

| 版本 | 日期 | 內容 |
|------|------|------|
| V1.0.0 | 2026-04-18 | 初始版本：收藏管理、借出追蹤、逾期警示、PIN 管理員 |

| V1.13.13 | 2026-04-18 | 卡片完整邊框 + 名稱/平台/好玩度顯示 |
| V1.13.13 | 2026-04-18 | 詳情可編輯名稱/平台/類別中文；卡片增加微格(5欄) |
| V1.13.13 | 2026-04-18 | 格數 4/6/8/12；卡片緊湊；UI 字體加大 |
| V1.13.13 | 2026-04-18 | 平台篩選依 ownedPlatform；卡牌風格設計 |
| V1.13.13 | 2026-04-18 | 搜尋列表緊湊化；版本選擇平台色；編號badge重設計 |
| V1.13.13 | 2026-04-18 | 詳情modal緊湊化；編號badge更明顯 |
| V1.13.13 | 2026-04-18 | 編號右下角更明顯；按鈕重組成一列 |
| V1.13.13 | 2026-04-18 | GameCard 重設計，封面乾淨，資訊區獨立不重疊 |
| V1.13.13 | 2026-04-18 | Modal置中；借出紀錄展開/刪除；手動新增+封面上傳 |
| V1.13.13 | 2026-04-18 | 修復 Railway 啟動失敗；DB路徑自動 fallback |
| V1.13.13 | 2026-04-18 | 編號移左上有框；好玩度移右上透明框 |
| V1.13.13 | 2026-04-18 | 手機UI重整；編號藍底白框正方形 |
| V1.13.13 | 2026-04-18 | Header不換行；編號真正方形；資訊區比例縮放 |
| V1.13.13 | 2026-04-18 | 遊戲詳情可更換封面（搜尋或上傳）|
| V1.13.13 | 2026-04-18 | SELA logo；更名；欄數6/9/12；換封面獨立modal |
| V1.13.13 | 2026-04-18 | 手機大/中/小=2/4/6欄，桌機=6/9/12欄 |
| V1.13.13 | 2026-04-18 | 多用戶架構；探索頁籤；跨用戶借用申請；公開/私人設定 |
| V1.13.13 | 2026-04-18 | 共用遊戲目錄；搜尋優先顯示收藏庫；一鍵導入 |
| V1.13.13 | 2026-04-18 | 目錄導入允許重複(confirm)；每份獨立可自訂封面 |
| V1.13.13 | 2026-04-18 | 社群封面庫；上傳可分享；換封面 tab 切換 |
| V1.13.13 | 2026-04-18 | 加入收藏時自動翻譯為繁中遊戲名稱 |
| V1.13.13 | 2026-04-18 | 加入收藏優先查任天堂台灣官方中文名，再 Claude 翻譯 |
| V1.13.13 | 2026-04-18 | 任天堂台灣官方名查詢改用Claude知識庫；第三方遊戲Claude通用翻譯 |
| V1.13.13 | 2026-04-18 | 巴哈商城爬蟲+名稱庫；翻譯三段退回；設定頁可觸發 |
| V1.13.13 | 2026-04-18 | 爬蟲策略改強健版+debug endpoint；換封面加URL輸入 |
| V1.13.13 | 2026-04-18 | 即時搜尋巴哈商城取中文名+封面；封面URL規律解析 |
| V1.13.13 | 2026-04-18 | 設定頁新增巴哈搜尋測試，即時看封面有沒有抓到 |
| V1.13.13 | 2026-04-18 | 改搜 acg.gamer.com.tw；試 PNG/JPG；修中文 URL 編碼 |
| V1.13.13 | 2026-04-18 | 卡片封面改 contain+150%，巴哈圖片不再裁切 |
| V1.13.13 | 2026-04-18 | 巴哈封面優先；清理[Switch]前綴 |
| V1.13.13 | 2026-04-18 | 搜尋同時查巴哈，結果最上方顯示巴哈中文名+封面 |
| V1.13.13 | 2026-04-19 | 用翻譯後的英文名搜巴哈，確保能找到 |
| V1.13.13 | 2026-04-19 | 搜巴哈改用buy主站；中英文都試；加debug log |
| V1.13.13 | 2026-04-19 | 修 gamer-search syntax error；前端中英文都試 |
| V1.13.13 | 2026-04-19 | 搜尋改純巴哈；不用RAWG/Claude；中文直搜多筆 |
| V1.13.13 | 2026-04-19 | 封面直接從HTML抓img；名稱清理購物資訊 |
| V1.13.13 | 2026-04-19 | 並行fetch atmItem取真正ACG sn；封面URL正確 |
| V1.13.13 | 2026-04-19 | 改搜 acg.gamer.com.tw 作品庫；buy作退路 |
| V1.13.13 | 2026-04-19 | 強化 debug endpoint，可看實際 HTML 連結 |
| V1.13.13 | 2026-04-19 | 從 acgDetail 頁取正確名稱(og:title)+封面(og:image) |
