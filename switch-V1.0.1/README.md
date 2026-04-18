# Switch Vault 🎮

Nintendo Switch 卡匣收藏管理系統

## 技術架構

```
FastAPI (Python) + SQLite  ← 後端 + 資料庫
React + Vite               ← 前端（由 FastAPI 靜態服務）
Docker                     ← 容器化
Railway                    ← 雲端部署
```

## Railway 部署步驟

### 1. 建立 GitHub Repo

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/你的帳號/switch-vault.git
git push -u origin main
```

### 2. Railway 設定

1. 前往 https://railway.com → New Project → Deploy from GitHub
2. 選擇 `switch-vault` repo
3. Railway 會自動偵測 Dockerfile 並開始 build

### 3. 環境變數設定（必填）

在 Railway → 你的服務 → Variables 頁面新增：

| 變數名稱 | 說明 | 範例 |
|---|---|---|
| `ADMIN_PIN` | 管理員密碼 | `mypin2024` |
| `RAWG_API_KEY` | 遊戲封面 API | 至 rawg.io/apidocs 申請 |
| `DB_PATH` | SQLite 路徑 | `/data/switch_vault.db` |

### 4. 掛載 Volume（資料持久化）

Railway → 你的服務 → Volumes → Add Volume
- Mount Path：`/data`

> ⚠️ 不掛 Volume 的話，每次 deploy 資料會消失！

### 5. 完成

Railway 會給你一個網址，例如：
`https://switch-vault-production.up.railway.app`

把這個網址分享給家人朋友，他們就能查看你的收藏。

---

## 本地開發

```bash
# 後端
pip install -r requirements.txt
ADMIN_PIN=1234 uvicorn main:app --reload

# 前端（另一個 terminal）
cd frontend
npm install
npm run dev
# 開啟 http://localhost:5173
```

## 環境變數說明

- `ADMIN_PIN`：管理員 PIN，預設 `1234`（部署後請改掉）
- `RAWG_API_KEY`：搜尋遊戲封面用，免費申請
- `DB_PATH`：SQLite 檔案位置，預設 `/data/switch_vault.db`
