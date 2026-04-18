from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, os, json, httpx, time as _time
from datetime import datetime
from typing import Optional, List

app = FastAPI(title="Switch Vault API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ADMIN_PIN = os.getenv("ADMIN_PIN", "1234")
DB_PATH   = os.getenv("DB_PATH", "/data/switch_vault.db")

def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, cover TEXT,
        genres TEXT DEFAULT '[]', rating REAL, added_at TEXT,
        number INTEGER, fun_rating INTEGER,
        platforms TEXT DEFAULT '[]', released TEXT,
        owned_platform TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS borrows (
        id TEXT PRIMARY KEY, game_id TEXT NOT NULL, borrower_name TEXT NOT NULL,
        borrow_date TEXT NOT NULL, expected_return TEXT NOT NULL, returned_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
    )""")
    # 永久遊戲名稱資料庫（累積，不覆蓋）
    conn.execute("""CREATE TABLE IF NOT EXISTS rawg_games (
        name TEXT PRIMARY KEY,
        released TEXT,
        first_seen TEXT
    )""")
    for col, typedef in [
        ("number", "INTEGER"), ("fun_rating", "INTEGER"),
        ("platforms", "TEXT DEFAULT '[]'"), ("released", "TEXT"),
        ("owned_platform", "TEXT")
    ]:
        try:
            conn.execute(f"ALTER TABLE games ADD COLUMN {col} {typedef}")
        except Exception:
            pass
    conn.commit()
    conn.close()

init_db()

def verify_admin(x_admin_pin: Optional[str] = Header(None)):
    # [AUTH-DISABLED] 測試階段：略過 PIN 驗證
    return
    if x_admin_pin != ADMIN_PIN:
        raise HTTPException(status_code=403, detail="Invalid PIN")

class GameIn(BaseModel):
    id: str; name: str; cover: Optional[str] = None
    genres: List[str] = []; rating: Optional[float] = None
    number: Optional[int] = None; fun_rating: Optional[int] = None
    platforms: List[str] = []; released: Optional[str] = None
    owned_platform: Optional[str] = None

class GameUpdate(BaseModel):
    number: Optional[int] = None; fun_rating: Optional[int] = None

class BorrowIn(BaseModel):
    id: str; game_id: str; borrower_name: str
    borrow_date: str; expected_return: str

@app.get("/api/games")
def list_games():
    conn = get_db()
    rows = conn.execute("SELECT * FROM games ORDER BY added_at DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "cover": r["cover"],
             "genres": json.loads(r["genres"] or "[]"), "rating": r["rating"],
             "addedAt": r["added_at"], "number": r["number"], "funRating": r["fun_rating"],
             "platforms": json.loads(r["platforms"] or "[]"), "released": r["released"],
             "ownedPlatform": r["owned_platform"]} for r in rows]

@app.post("/api/games", dependencies=[Depends(verify_admin)])
def add_game(g: GameIn):
    conn = get_db()
    try:
        conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (g.id, g.name, g.cover, json.dumps(g.genres), g.rating,
             datetime.now().isoformat(), g.number, g.fun_rating,
             json.dumps(g.platforms), g.released, g.owned_platform))
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()
    return {"ok": True}

@app.patch("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def update_game(game_id: str, g: GameUpdate):
    conn = get_db()
    if g.number is not None:
        conn.execute("UPDATE games SET number=? WHERE id=?", (g.number, game_id))
    if g.fun_rating is not None:
        conn.execute("UPDATE games SET fun_rating=? WHERE id=?", (g.fun_rating, game_id))
    conn.commit(); conn.close()
    return {"ok": True}

@app.delete("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def delete_game(game_id: str):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id=?", (game_id,))
    conn.commit(); conn.close()
    return {"ok": True}

@app.get("/api/borrows")
def list_borrows():
    conn = get_db()
    rows = conn.execute("SELECT * FROM borrows ORDER BY borrow_date DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "gameId": r["game_id"], "borrowerName": r["borrower_name"],
             "borrowDate": r["borrow_date"], "expectedReturn": r["expected_return"],
             "returnedAt": r["returned_at"]} for r in rows]

@app.post("/api/borrows", dependencies=[Depends(verify_admin)])
def add_borrow(b: BorrowIn):
    conn = get_db()
    conn.execute("INSERT INTO borrows VALUES (?,?,?,?,?,NULL)",
        (b.id, b.game_id, b.borrower_name, b.borrow_date, b.expected_return))
    conn.commit(); conn.close()
    return {"ok": True}

@app.patch("/api/borrows/{borrow_id}/return", dependencies=[Depends(verify_admin)])
def return_borrow(borrow_id: str):
    conn = get_db()
    conn.execute("UPDATE borrows SET returned_at=? WHERE id=?",
        (datetime.now().isoformat(), borrow_id))
    conn.commit(); conn.close()
    return {"ok": True}

@app.get("/api/config")
def get_config():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM rawg_games").fetchone()[0]
    conn.close()
    return {"ok": True, "rawgDbSize": total}

# ── 永久遊戲資料庫：每 48 小時抓新遊戲，累積不覆蓋 ──────────────────────
CACHE_TTL = 48 * 3600

async def refresh_rawg_games(api_key: str):
    """抓最新 40 款 Switch 遊戲，INSERT OR IGNORE 加入永久資料庫"""
    try:
        key_param = f"&key={api_key}" if api_key else ""
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.rawg.io/api/games?platforms=7&ordering=-released&page_size=40{key_param}",
                timeout=10
            )
        conn = get_db()
        now = datetime.now().isoformat()
        for g in res.json().get("results", []):
            conn.execute(
                "INSERT OR IGNORE INTO rawg_games (name, released, first_seen) VALUES (?,?,?)",
                (g["name"], g.get("released", ""), now)
            )
        conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES ('rawg_refresh', '1', ?)",
            (now,)
        )
        conn.commit(); conn.close()
    except Exception:
        pass

async def get_rawg_games_for_prompt(api_key: str) -> list:
    """取近 18 個月的遊戲（Claude 知識不完整的區段）供 prompt 使用"""
    # 檢查是否需要更新
    conn = get_db()
    meta = conn.execute("SELECT updated_at FROM metadata WHERE key='rawg_refresh'").fetchone()
    total = conn.execute("SELECT COUNT(*) FROM rawg_games").fetchone()[0]
    conn.close()

    needs_refresh = True
    if meta and total > 0:
        age = _time.time() - datetime.fromisoformat(meta["updated_at"]).timestamp()
        needs_refresh = age > CACHE_TTL

    if needs_refresh:
        await refresh_rawg_games(api_key)

    # 從資料庫取近 18 個月遊戲（2024-10 之後），最多 60 筆
    cutoff = "2024-10-01"
    conn = get_db()
    rows = conn.execute(
        "SELECT name, released FROM rawg_games WHERE released >= ? ORDER BY released DESC LIMIT 60",
        (cutoff,)
    ).fetchall()
    conn.close()
    return [{"name": r["name"], "released": r["released"]} for r in rows]

# ── helpers ───────────────────────────────────────────────────────────────
async def rawg_search(q: str, plat_param: str, key_param: str) -> list:
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"https://api.rawg.io/api/games?search={q}&page_size=12{plat_param}{key_param}",
            timeout=10
        )
    return res.json().get("results", [])

async def claude_query(system: str, user_msg: str, claude_key: str) -> str:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": claude_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": "claude-haiku-4-5-20251001", "max_tokens": 60,
                  "system": system, "messages": [{"role": "user", "content": user_msg}]},
            timeout=10
        )
    return res.json().get("content", [{}])[0].get("text", "").strip()

# ── 直接搜尋（無 Claude，前端手動修改後用）───────────────────────────────
@app.get("/api/search")
async def search_games(q: str, platform: str = "7"):
    api_key   = os.getenv("RAWG_API_KEY", "")
    key_param = f"&key={api_key}" if api_key else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    results = await rawg_search(q, plat_param, key_param)
    if not results and plat_param:
        results = await rawg_search(q, "", key_param)
    return {"results": results, "selected": q}

# ── 智慧搜尋（Claude 翻譯 + 三段退回）───────────────────────────────────
@app.get("/api/smart-search")
async def smart_search(q: str, platform: str = "7", request: Request = None):
    claude_key = request.headers.get("x-claude-key", "")
    api_key    = os.getenv("RAWG_API_KEY", "")
    key_param  = f"&key={api_key}" if api_key else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    search_query = q

    # Step 1：取近期遊戲清單（補充 Claude 知識盲區的 2025 年後新遊戲）
    recent_ctx = ""
    if claude_key:
        try:
            recent = await get_rawg_games_for_prompt(api_key)
            if recent:
                lines = "\n".join(f"- {g['name']} ({g['released']})" for g in recent)
                recent_ctx = (
                    "\n\n以下是 RAWG 收錄的近期 Switch 遊戲（補充參考，適用於 2024 年底以後的新遊戲）：\n"
                    + lines
                )
        except Exception:
            pass

    # Step 2：Claude 翻譯（自身知識優先，清單補充新遊戲）
    if claude_key:
        try:
            system_translate = (
                "你是資深遊戲玩家助理，熟悉 2000 年至今各平台遊戲。\n"
                "任務：將使用者的遊戲搜尋關鍵字，轉換成最適合在 RAWG 搜尋的官方英文遊戲名稱。\n\n"
                "規則（依優先順序）：\n"
                "1. 優先使用你自己的遊戲知識，尤其是 2024 年以前的遊戲\n"
                "2. 若輸入已是正確英文名稱，原樣回傳，不要修改\n"
                "3. 中文/日文遊戲名，找出對應的官方英文名稱\n"
                "4. 暱稱或簡稱，推斷最可能的正式遊戲名\n"
                "5. 只回傳英文遊戲名稱，不加任何說明或標點\n\n"
                "範例：\n"
                "- 瑪利歐 驚奇 → Super Mario Bros. Wonder\n"
                "- 薩爾達 王國之淚 → The Legend of Zelda Tears of the Kingdom\n"
                "- 寶可夢朱 → Pokemon Scarlet\n"
                "- 瑪利歐賽車世界 → Mario Kart World\n"
                "- 勇者鬥惡龍 7 重製版 → Dragon Quest VII Reimagined"
                + recent_ctx
            )
            translated = await claude_query(system_translate, q, claude_key)
            if translated:
                search_query = translated
        except Exception:
            pass

    # Step 3：用翻譯後名稱 + 平台篩選
    results = await rawg_search(search_query, plat_param, key_param)

    # Step 4：退回 — 去掉平台篩選
    if not results and plat_param:
        results = await rawg_search(search_query, "", key_param)

    # Step 5：退回 — Claude 放寬關鍵字
    if not results and claude_key and search_query != q:
        try:
            simplified = await claude_query(
                "把遊戲搜尋關鍵字縮短成最核心的系列名稱，去掉副標題、版本號、年份。只回傳英文名稱。",
                search_query, claude_key
            )
            if simplified and simplified != search_query:
                results = await rawg_search(simplified, "", key_param)
                if results:
                    search_query = simplified
        except Exception:
            pass

    return {"results": results, "selected": search_query}

import os.path
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
