<div align="center">
  <img src="frontend/public/favicon/sela.svg" width="120" alt="SELA"/>
  <h1>Switch Vault</h1>
  <p>SELA 遊戲管理租借系統 — 實體遊戲卡帶收藏、借出管理、多用戶共享</p>
</div>

---

## 簡介

Switch Vault 是一個個人實體遊戲卡帶管理系統，整合巴哈商城中文遊戲名稱與封面，支援多用戶公開收藏與跨用戶借用申請。

**核心功能：**
- 🎮 遊戲收藏牆（支援 Switch / PS / Xbox / PC）
- 🔍 巴哈商城即時搜尋（中文名稱 + 封面自動帶入）
- 📤 借出管理（借出人、日期、逾期提醒）
- 🌐 多用戶探索（公開收藏互看、跨用戶借用申請）
- 📋 遊戲複製、封面自訂（搜尋 / 上傳 / 網址）

## 安裝（本機開發）

```bash
# 後端
pip install -r requirements.txt

# 前端
cd frontend
npm install
npm run build
```

## 啟動

```bash
# 後端（會自動 serve 前端 dist/）
DB_PATH=./local.db ADMIN_PIN=1234 uvicorn main:app --reload --port 8080
```

## 環境變數

| 變數 | 說明 | 必填 |
|------|------|------|
| `DB_PATH` | SQLite 路徑（Railway: `/data/switch_vault.db`）| ✓ |
| `ADMIN_PIN` | 管理員 PIN | ✓ |
| `RAWG_API_KEY` | RAWG.io API key（封面搜尋）| 選填 |

## 部署（Railway）

1. 推送到 GitHub（`Sela1227/switch` → `main`）
2. Railway 自動偵測 `Dockerfile` 並部署
3. Volume 掛載到 `/data`，確保 DB 持久化

## 目錄結構

```
switch/
├── main.py              FastAPI 後端（API + 靜態 serve）
├── requirements.txt
├── Dockerfile           兩階段 build（Node → Python）
├── railway.toml
├── frontend/
│   ├── src/App.jsx      React 前端（單檔 SPA）
│   ├── public/
│   │   └── favicon/     SELA favicon 套組
│   └── index.html
├── CLAUDE.md            給 Claude 的工作上下文
├── README.md            本檔
└── .gitignore
```

## 版本歷程

| 版本 | 重點 |
|------|------|
| V1.14.0 | 對齊 SELA Starter Kit 規範 |
| V1.13.x | 巴哈商城整合（爬蟲 + 即時搜尋 + 封面）|
| V1.12.x | 多用戶架構、探索頁籤、跨用戶借用 |
| V1.11.x | 手機 UI 優化、響應式欄數 |
| V1.10.x | 遊戲詳情 modal、換封面功能 |
| V1.0.0  | 初版單用戶收藏管理 |

---

> Made by **SELA** · V1.14.0
