# SELA-handoff.md — Switch Vault

> 首次對齊 Kit（V1.14.0）產出。給 Kit Claude 升 Kit 用，不是給專案 Claude 看的。

---

## 〇、專案速覽

- **專案名稱：** Switch Vault（SELA 遊戲管理租借系統）
- **專案類型：** FastAPI 後端 + React PWA，Railway 部署
- **技術棧：** Python 3.11 + FastAPI + SQLite / React 18 + Vite / BeautifulSoup 爬蟲
- **規模：** ~950 行 main.py，~1800 行 App.jsx
- **使用 Kit 版本：** V1.8.0（首次對齊）
- **完成版本：** V1.14.0
- **完成日期：** 2026-04-19

---

## 一、用 Kit 的整體感受

### 預期外的順利

- 對齊動作本身快（CLAUDE.md 章法明確，填格子就好）
- Kit 衝突仲裁「配色不主動改」規則直接可用，省掉一輪討論

### 預期外的卡住

- 本案是既有長對話專案首次對齊，CLAUDE.md 之前是純版本歷程流水帳，需要完整重寫而不是修改

### 整體評價

- ✓ 章法手冊讓 CLAUDE.md 有明確結構，未來 Claude 接手明顯更快
- ✗ Kit 對「既有專案首次對齊」的流程描述稍少，handoff 模板才是主要指引

---

## 二、跨專案通用坑（建議進 Kit）

### 1. str_replace 後沒有驗證裝飾器位置

- **症狀：** `GET /api/gamer-search?q=pokopia` 回傳 422 Unprocessable Entity，路由存在但行為異常
- **原因：** str_replace 替換範圍太大，`@app.get("/api/gamer-search")` 從正確位置移位到 `def clean_gamer_name(raw: str)` 上方。FastAPI 把清理函數當路由，收到 `q` 參數就 422
- **做法：** str_replace 後立刻 `grep -n "@app.get\|@app.post\|def " main.py` 確認裝飾器緊接在正確函數上方；不只 FastAPI，Flask / Flet `@ft.app.route` 等同樣危險
- **影響範圍：** 所有使用裝飾器的 Python web framework（FastAPI / Flask / Flet route）
- **證據：** 本專案 CLAUDE.md 坑 #1；V1.13.16 / V1.13.17 連續兩版修同一問題
- **檢查 1 結果：** grep Kit「decorator」「裝飾器」→ 無重複條目

---

## 三、設計模式（建議進 sela-philosophy / 規範）

### 1. `/api/admin/{tool}-debug` 作為早期基礎建設

- **本案發生情境：** 爬蟲在 Claude sandbox 環境全部 403，無法確認 Railway 正式環境的 HTML 結構。加了 `/api/admin/gamer-debug` endpoint 後，部署即可直接打 URL 看實際回傳，省掉大量猜測
- **可推廣的原則：** 任何依賴外部服務的爬蟲 / API 整合，V0.1.0 就加 debug endpoint，不等到出問題才補
- **代價：** 多一個 endpoint，需注意不要暴露敏感資料（本案加了 `dependencies=[Depends(verify_admin)]`）
- **建議寫入：** `conventions/cross-project-pitfalls.md` 或 `start-project-decisions.md`

---

## 四、Kit 調整建議

### 既有專案首次對齊的流程說明可以補充

- **現狀：** handoff 模板有說「首次對齊 Kit 時必產出」，但 CLAUDE.md 主文對「既有專案對齊」的操作步驟較少
- **建議：** 在 `templates/claude-init.md` 或 CLAUDE.md 主文補一節「既有專案對齊 SOP」，列明：確認衝突仲裁 → 保留配色 → 重寫 CLAUDE.md → 補 handoff → 打包

---

## 五、不要回流 Kit 的東西

- 巴哈三個子站架構（acg / buy / search 用途區別）— 巴哈特有
- atmItem sn ≠ ACG sn（封面用不同數字）— 巴哈特有
- CDN 封面 URL 規律（`p2.bahamut.com.tw/B/ACG/c/{sn%100:02d}/{sn:010d}.{JPG|PNG}`）— 巴哈特有
- `og:title` / `og:image` 取名稱封面 — 通用 HTML meta 知識，不是坑
- `translateGameName` 四段退回邏輯（巴哈 → 本地庫 → 任天堂官方 → Claude 通用翻譯）— 業務邏輯
- `game_name_map` / `game_covers` / `borrow_requests` schema — 業務模型
- 白邊裁切演算法（220 閾值 + 95% 多數判斷）— 業務邏輯

---

## 六、行動清單

### 建議升 Kit 版本

V1.8.1（c+1，新增一條坑 + 一條設計模式，屬 bug fix / 小補充層級）

### 必做

- [ ] `cross-project-pitfalls.md` 新增坑：「str_replace 後未驗證裝飾器位置 → 422」（裝飾器移位問題，跨 framework 通用）

### 暫緩

- [ ] `/api/admin/debug` 早期基礎建設 → 等第二個專案有類似觀察再決定是否進 Kit

### 不做

- [ ] 巴哈相關所有技術細節進 Kit（業務特定，無法通用）
- [ ] `og:title` / `og:image` 進坑庫（這是正常 HTML 用法，不是坑）

---

## 七、備註

本案是從長對話（150+ 輪）直接對齊 Kit，CLAUDE.md 從流水帳重寫為章法格式。
版本號 V1.13.x 的 `c` 超過 9 未進位屬歷史遺留，V1.14.0 起遵守 Kit 規則，已在 CLAUDE.md 仲裁區塊記錄。
