from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, os, json, httpx
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
        platforms TEXT DEFAULT '[]', released TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS borrows (
        id TEXT PRIMARY KEY, game_id TEXT NOT NULL, borrower_name TEXT NOT NULL,
        borrow_date TEXT NOT NULL, expected_return TEXT NOT NULL, returned_at TEXT
    )""")
    for col, typedef in [
        ("number", "INTEGER"), ("fun_rating", "INTEGER"),
        ("platforms", "TEXT DEFAULT '[]'"), ("released", "TEXT")
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
    id: str
    name: str
    cover: Optional[str] = None
    genres: List[str] = []
    rating: Optional[float] = None
    number: Optional[int] = None
    fun_rating: Optional[int] = None
    platforms: List[str] = []
    released: Optional[str] = None

class GameUpdate(BaseModel):
    number: Optional[int] = None
    fun_rating: Optional[int] = None

class BorrowIn(BaseModel):
    id: str
    game_id: str
    borrower_name: str
    borrow_date: str
    expected_return: str

@app.get("/api/games")
def list_games():
    conn = get_db()
    rows = conn.execute("SELECT * FROM games ORDER BY added_at DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "cover": r["cover"],
             "genres": json.loads(r["genres"] or "[]"),
             "rating": r["rating"], "addedAt": r["added_at"],
             "number": r["number"], "funRating": r["fun_rating"],
             "platforms": json.loads(r["platforms"] or "[]"),
             "released": r["released"]} for r in rows]

@app.post("/api/games", dependencies=[Depends(verify_admin)])
def add_game(g: GameIn):
    conn = get_db()
    try:
        conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?)",
            (g.id, g.name, g.cover, json.dumps(g.genres), g.rating,
             datetime.now().isoformat(), g.number, g.fun_rating,
             json.dumps(g.platforms), g.released))
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
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def delete_game(game_id: str):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id=?", (game_id,))
    conn.commit()
    conn.close()
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
    conn.commit()
    conn.close()
    return {"ok": True}

@app.patch("/api/borrows/{borrow_id}/return", dependencies=[Depends(verify_admin)])
def return_borrow(borrow_id: str):
    conn = get_db()
    conn.execute("UPDATE borrows SET returned_at=? WHERE id=?",
        (datetime.now().isoformat(), borrow_id))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/config")
def get_config():
    return {"ok": True}

@app.get("/api/search")
async def search_games(q: str, platform: str = "7"):
    api_key = os.getenv("RAWG_API_KEY", "")
    key_param = f"&key={api_key}" if api_key else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    url = f"https://api.rawg.io/api/games?search={q}&page_size=12{plat_param}{key_param}"
    async with httpx.AsyncClient() as client:
        res = await client.get(url, timeout=10)
    data = res.json()
    return {"results": data.get("results", []), "selected": q}

@app.get("/api/smart-search")
async def smart_search(q: str, platform: str = "7", request: Request = None):
    claude_key = request.headers.get("x-claude-key", "")
    api_key    = os.getenv("RAWG_API_KEY", "")
    key_param  = f"&key={api_key}" if api_key else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""

    async with httpx.AsyncClient() as client:
        r1 = await client.get(
            f"https://api.rawg.io/api/games?search={q}&page_size=8{key_param}",
            timeout=10
        )
    candidates = r1.json().get("results", [])
    if not candidates:
        return {"results": [], "selected": q}

    selected = candidates[0]["name"]
    if claude_key:
        names_list = "\n".join(f"- {r['name']}" for r in candidates)
        try:
            async with httpx.AsyncClient() as client:
                cr = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": claude_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": "claude-haiku-4-5-20251001",
                        "max_tokens": 80,
                        "system": (
                            "你是 Nintendo Switch 玩家助理。"
                            "根據使用者的搜尋意圖，從 RAWG 的候選遊戲清單中，選出最符合的一個。"
                            "只回傳清單中的完整遊戲名稱，不加任何說明或標點。"
                        ),
                        "messages": [{"role": "user",
                            "content": f"使用者搜尋：{q}\n\nRAWG 候選清單：\n{names_list}\n\n請選出最符合的遊戲名稱："}]
                    },
                    timeout=10
                )
            picked = cr.json().get("content", [{}])[0].get("text", "").strip()
            if any(picked == r["name"] for r in candidates):
                selected = picked
        except Exception:
            pass

    async with httpx.AsyncClient() as client:
        r2 = await client.get(
            f"https://api.rawg.io/api/games?search={selected}&page_size=12{plat_param}{key_param}",
            timeout=10
        )
    results = r2.json().get("results", [])
    if not results:
        results = candidates

    return {"results": results, "selected": selected}

import os.path
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
