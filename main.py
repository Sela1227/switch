from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, os, json
from datetime import datetime
from typing import Optional, List

app = FastAPI(title="Switch Vault API")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ADMIN_PIN = os.getenv("ADMIN_PIN", "1234")
DB_PATH   = os.getenv("DB_PATH", "/data/switch_vault.db")

# ── DB ────────────────────────────────────────────────────────────────────
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cover TEXT,
        genres TEXT DEFAULT '[]',
        rating REAL,
        added_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS borrows (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        borrower_name TEXT NOT NULL,
        borrow_date TEXT NOT NULL,
        expected_return TEXT NOT NULL,
        returned_at TEXT
    )""")
    conn.commit()
    conn.close()

init_db()

# ── Auth ──────────────────────────────────────────────────────────────────
def verify_admin(x_admin_pin: Optional[str] = Header(None)):
    # [AUTH-DISABLED] 測試階段：略過 PIN 驗證，所有人皆可操作
    # 啟用時移除下方 return，恢復 PIN 比對
    return
    if x_admin_pin != ADMIN_PIN:
        raise HTTPException(status_code=403, detail="Invalid PIN")

# ── Models ────────────────────────────────────────────────────────────────
class GameIn(BaseModel):
    id: str
    name: str
    cover: Optional[str] = None
    genres: List[str] = []
    rating: Optional[float] = None

class BorrowIn(BaseModel):
    id: str
    game_id: str
    borrower_name: str
    borrow_date: str
    expected_return: str

# ── Games ─────────────────────────────────────────────────────────────────
@app.get("/api/games")
def list_games():
    conn = get_db()
    rows = conn.execute("SELECT * FROM games ORDER BY added_at DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "cover": r["cover"],
             "genres": json.loads(r["genres"] or "[]"),
             "rating": r["rating"], "addedAt": r["added_at"]} for r in rows]

@app.post("/api/games", dependencies=[Depends(verify_admin)])
def add_game(g: GameIn):
    conn = get_db()
    try:
        conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?)",
            (g.id, g.name, g.cover, json.dumps(g.genres), g.rating,
             datetime.now().isoformat()))
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()
    return {"ok": True}

@app.delete("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def delete_game(game_id: str):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id=?", (game_id,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ── Borrows ───────────────────────────────────────────────────────────────
@app.get("/api/borrows")
def list_borrows():
    conn = get_db()
    rows = conn.execute("SELECT * FROM borrows ORDER BY borrow_date DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "gameId": r["game_id"],
             "borrowerName": r["borrower_name"], "borrowDate": r["borrow_date"],
             "expectedReturn": r["expected_return"],
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

# ── Settings（供前端讀取 RAWG key，避免明碼存前端）────────────────────────
@app.get("/api/config")
def get_config():
    return {"rawgApiKey": os.getenv("RAWG_API_KEY", "")}

# ── Serve React build（放最後，避免遮蓋 API 路由）────────────────────────
import os.path
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
