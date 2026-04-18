from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, os, json, httpx, time as _time
from datetime import datetime
from typing import Optional, List

app = FastAPI(title="Switch Vault API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ADMIN_PIN          = os.getenv("ADMIN_PIN", "1234")
DB_PATH            = os.getenv("DB_PATH", "/data/switch_vault.db")
IGDB_CLIENT_ID     = os.getenv("IGDB_CLIENT_ID", "")
IGDB_CLIENT_SECRET = os.getenv("IGDB_CLIENT_SECRET", "")
RAWG_API_KEY       = os.getenv("RAWG_API_KEY", "")

def igdb_enabled(): return bool(IGDB_CLIENT_ID and IGDB_CLIENT_SECRET)

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
        platforms TEXT DEFAULT '[]', released TEXT, owned_platform TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS borrows (
        id TEXT PRIMARY KEY, game_id TEXT NOT NULL, borrower_name TEXT NOT NULL,
        borrow_date TEXT NOT NULL, expected_return TEXT NOT NULL, returned_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS rawg_games (
        name TEXT PRIMARY KEY, released TEXT, first_seen TEXT
    )""")
    for col, typedef in [
        ("number","INTEGER"),("fun_rating","INTEGER"),
        ("platforms","TEXT DEFAULT '[]'"),("released","TEXT"),("owned_platform","TEXT")
    ]:
        try: conn.execute(f"ALTER TABLE games ADD COLUMN {col} {typedef}")
        except: pass
    conn.commit(); conn.close()

init_db()

def verify_admin(x_admin_pin: Optional[str] = Header(None)):
    return  # [AUTH-DISABLED]
    if x_admin_pin != ADMIN_PIN:
        raise HTTPException(status_code=403, detail="Invalid PIN")

class GameIn(BaseModel):
    id: str; name: str; cover: Optional[str] = None
    genres: List[str] = []; rating: Optional[float] = None
    number: Optional[int] = None; fun_rating: Optional[int] = None
    platforms: List[str] = []; released: Optional[str] = None
    owned_platform: Optional[str] = None

class GameUpdate(BaseModel):
    number: Optional[int] = None
    fun_rating: Optional[int] = None
    name: Optional[str] = None
    owned_platform: Optional[str] = None

class BorrowIn(BaseModel):
    id: str; game_id: str; borrower_name: str
    borrow_date: str; expected_return: str

# ── CRUD ──────────────────────────────────────────────────────────────────
@app.get("/api/games")
def list_games():
    conn = get_db()
    rows = conn.execute("SELECT * FROM games ORDER BY added_at DESC").fetchall()
    conn.close()
    return [{"id":r["id"],"name":r["name"],"cover":r["cover"],
             "genres":json.loads(r["genres"] or "[]"),"rating":r["rating"],
             "addedAt":r["added_at"],"number":r["number"],"funRating":r["fun_rating"],
             "platforms":json.loads(r["platforms"] or "[]"),"released":r["released"],
             "ownedPlatform":r["owned_platform"]} for r in rows]

@app.post("/api/games", dependencies=[Depends(verify_admin)])
def add_game(g: GameIn):
    conn = get_db()
    try:
        conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (g.id, g.name, g.cover, json.dumps(g.genres), g.rating,
             datetime.now().isoformat(), g.number, g.fun_rating,
             json.dumps(g.platforms), g.released, g.owned_platform))
        conn.commit()
    except sqlite3.IntegrityError: pass
    conn.close(); return {"ok": True}

@app.patch("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def update_game(game_id: str, g: GameUpdate):
    conn = get_db()
    if g.number is not None: conn.execute("UPDATE games SET number=? WHERE id=?",(g.number,game_id))
    if g.fun_rating is not None: conn.execute("UPDATE games SET fun_rating=? WHERE id=?",(g.fun_rating,game_id))
    if g.name is not None and g.name.strip(): conn.execute("UPDATE games SET name=? WHERE id=?",(g.name.strip(),game_id))
    if g.owned_platform is not None: conn.execute("UPDATE games SET owned_platform=? WHERE id=?",(g.owned_platform or None,game_id))
    conn.commit(); conn.close()
    return {"ok": True}

@app.delete("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def delete_game(game_id: str):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id=?",(game_id,))
    conn.commit(); conn.close(); return {"ok": True}

@app.get("/api/borrows")
def list_borrows():
    conn = get_db()
    rows = conn.execute("SELECT * FROM borrows ORDER BY borrow_date DESC").fetchall()
    conn.close()
    return [{"id":r["id"],"gameId":r["game_id"],"borrowerName":r["borrower_name"],
             "borrowDate":r["borrow_date"],"expectedReturn":r["expected_return"],
             "returnedAt":r["returned_at"]} for r in rows]

@app.post("/api/borrows", dependencies=[Depends(verify_admin)])
def add_borrow(b: BorrowIn):
    conn = get_db()
    conn.execute("INSERT INTO borrows VALUES (?,?,?,?,?,NULL)",
        (b.id,b.game_id,b.borrower_name,b.borrow_date,b.expected_return))
    conn.commit(); conn.close(); return {"ok": True}

@app.patch("/api/borrows/{borrow_id}/return", dependencies=[Depends(verify_admin)])
def return_borrow(borrow_id: str):
    conn = get_db()
    conn.execute("UPDATE borrows SET returned_at=? WHERE id=?",(datetime.now().isoformat(),borrow_id))
    conn.commit(); conn.close(); return {"ok": True}

@app.delete("/api/borrows/{borrow_id}", dependencies=[Depends(verify_admin)])
def delete_borrow(borrow_id: str):
    conn = get_db()
    conn.execute("DELETE FROM borrows WHERE id=?",(borrow_id,))
    conn.commit(); conn.close(); return {"ok": True}
def get_config():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM rawg_games").fetchone()[0]
    conn.close()
    return {"ok": True, "igdbEnabled": igdb_enabled(), "rawgDbSize": total}

# ── IGDB ──────────────────────────────────────────────────────────────────
# 平台對照：我們的 rawg platform string → IGDB platform IDs
IGDB_PLAT = {
    "7":      "(130)",       # Nintendo Switch
    "18,187": "(48,167)",    # PS4 + PS5
    "1,186":  "(49,169)",    # Xbox One + Xbox Series X
    "4":      "(6)",         # PC
}

def igdb_plat_slug(name: str) -> str:
    n = name.lower()
    if "switch" in n: return "nintendo-switch"
    if "playstation 5" in n: return "playstation5"
    if "playstation 4" in n: return "playstation4"
    if "xbox series" in n: return "xbox-series-x"
    if "xbox one" in n: return "xbox-one"
    if "windows" in n or n == "pc": return "pc"
    if "ios" in n: return "ios"
    if "android" in n: return "android"
    return n.replace(" ", "-")

async def get_igdb_token() -> str:
    now = _time.time()
    conn = get_db()
    row = conn.execute("SELECT value FROM metadata WHERE key='igdb_token'").fetchone()
    conn.close()
    if row:
        d = json.loads(row["value"])
        if now < d.get("expires", 0) - 300:
            return d["token"]
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://id.twitch.tv/oauth2/token",
            params={"client_id":IGDB_CLIENT_ID,"client_secret":IGDB_CLIENT_SECRET,"grant_type":"client_credentials"},
            timeout=10
        )
    d = res.json()
    token_data = {"token": d["access_token"], "expires": now + d["expires_in"]}
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO metadata VALUES ('igdb_token',?,?)",
        (json.dumps(token_data), datetime.now().isoformat()))
    conn.commit(); conn.close()
    return d["access_token"]

async def igdb_search(q: str, platform: str) -> list:
    token = await get_igdb_token()
    plat_ids = IGDB_PLAT.get(platform, "")
    plat_filter = f"& platforms = {plat_ids}" if plat_ids else ""
    q_esc = q.replace('"', '\\"')
    body = f'search "{q_esc}"; fields name,cover.image_id,genres.name,platforms.name,first_release_date; {plat_filter} limit 12;'
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://api.igdb.com/v4/games",
            headers={"Client-ID": IGDB_CLIENT_ID, "Authorization": f"Bearer {token}"},
            content=body, timeout=10
        )
    if res.status_code != 200: return []
    result = []
    for g in res.json():
        img_id = g.get("cover", {}).get("image_id") if g.get("cover") else None
        cover = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{img_id}.jpg" if img_id else None
        released = None
        if g.get("first_release_date"):
            try: released = datetime.utcfromtimestamp(g["first_release_date"]).strftime("%Y-%m-%d")
            except: pass
        result.append({
            "id": str(g["id"]), "name": g["name"],
            "background_image": cover,
            "genres": [{"name": gn["name"]} for gn in g.get("genres", [])],
            "released": released,
            "platforms": [{"platform": {"slug": igdb_plat_slug(p.get("name","")), "name": p.get("name","")}}
                          for p in g.get("platforms", [])]
        })
    return result

# ── RAWG (fallback + Claude context cache) ────────────────────────────────
async def rawg_search(q: str, plat_param: str, key_param: str) -> list:
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"https://api.rawg.io/api/games?search={q}&page_size=12{plat_param}{key_param}",
            timeout=10
        )
    return res.json().get("results", [])

CACHE_TTL = 48 * 3600

async def refresh_rawg_games(api_key: str):
    try:
        key_param = f"&key={api_key}" if api_key else ""
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.rawg.io/api/games?platforms=7&ordering=-released&page_size=40{key_param}",
                timeout=10
            )
        conn = get_db(); now = datetime.now().isoformat()
        for g in res.json().get("results", []):
            conn.execute("INSERT OR IGNORE INTO rawg_games VALUES (?,?,?)",
                (g["name"], g.get("released",""), now))
        conn.execute("INSERT OR REPLACE INTO metadata VALUES ('rawg_refresh','1',?)",(now,))
        conn.commit(); conn.close()
    except: pass

async def get_rawg_games_for_prompt(api_key: str) -> list:
    conn = get_db()
    meta = conn.execute("SELECT updated_at FROM metadata WHERE key='rawg_refresh'").fetchone()
    total = conn.execute("SELECT COUNT(*) FROM rawg_games").fetchone()[0]
    conn.close()
    needs = True
    if meta and total > 0:
        age = _time.time() - datetime.fromisoformat(meta["updated_at"]).timestamp()
        needs = age > CACHE_TTL
    if needs: await refresh_rawg_games(api_key)
    conn = get_db()
    rows = conn.execute(
        "SELECT name, released FROM rawg_games WHERE released >= '2024-10-01' ORDER BY released DESC LIMIT 60"
    ).fetchall()
    conn.close()
    return [{"name":r["name"],"released":r["released"]} for r in rows]

# ── Claude helpers ────────────────────────────────────────────────────────
async def claude_query(system: str, user_msg: str, claude_key: str) -> str:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key":claude_key,"anthropic-version":"2023-06-01","content-type":"application/json"},
            json={"model":"claude-haiku-4-5-20251001","max_tokens":60,
                  "system":system,"messages":[{"role":"user","content":user_msg}]},
            timeout=10
        )
    return res.json().get("content",[{}])[0].get("text","").strip()

# ── Search endpoints ──────────────────────────────────────────────────────
@app.get("/api/search")
async def search_games(q: str, platform: str = "7"):
    if igdb_enabled():
        try:
            results = await igdb_search(q, platform)
            if results: return {"results": results, "selected": q}
            # 若有平台篩選沒結果，試試不篩選
            if platform != "all":
                results = await igdb_search(q, "all")
                if results: return {"results": results, "selected": q}
        except Exception: pass
    # Fallback: RAWG
    key_param = f"&key={RAWG_API_KEY}" if RAWG_API_KEY else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    results = await rawg_search(q, plat_param, key_param)
    if not results and plat_param:
        results = await rawg_search(q, "", key_param)
    return {"results": results, "selected": q}

@app.get("/api/smart-search")
async def smart_search(q: str, platform: str = "7", request: Request = None):
    claude_key = request.headers.get("x-claude-key","")
    search_query = q

    # Step 1：取近期遊戲清單供 Claude 補充參考
    recent_ctx = ""
    if claude_key:
        try:
            recent = await get_rawg_games_for_prompt(RAWG_API_KEY)
            if recent:
                lines = "\n".join(f"- {g['name']} ({g['released']})" for g in recent)
                recent_ctx = "\n\n以下是近期 Switch 新遊戲（2024 年底後，補充參考）：\n" + lines
        except: pass

    # Step 2：Claude 翻譯
    if claude_key:
        try:
            system_translate = (
                "你是資深遊戲玩家助理，熟悉 2000 年至今各平台遊戲。\n"
                "將使用者搜尋關鍵字轉換成最適合搜尋的官方英文遊戲名稱。\n\n"
                "規則（依優先順序）：\n"
                "1. 優先使用你自己的遊戲知識，尤其是 2024 年以前的遊戲\n"
                "2. 若輸入已是正確英文名稱，原樣回傳\n"
                "3. 中文/日文遊戲名，找出對應官方英文名稱\n"
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
            if translated: search_query = translated
        except: pass

    # Step 3 & 4：搜尋（IGDB 優先）
    if igdb_enabled():
        try:
            results = await igdb_search(search_query, platform)
            if not results and platform != "all":
                results = await igdb_search(search_query, "all")
            if results: return {"results": results, "selected": search_query}
        except: pass

    # Fallback：RAWG
    key_param = f"&key={RAWG_API_KEY}" if RAWG_API_KEY else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    results = await rawg_search(search_query, plat_param, key_param)
    if not results and plat_param:
        results = await rawg_search(search_query, "", key_param)

    # Step 5：Claude 放寬關鍵字再試
    if not results and claude_key and search_query != q:
        try:
            simplified = await claude_query(
                "把遊戲搜尋關鍵字縮短成最核心的系列名稱，去掉副標題、版本號、年份。只回傳英文名稱。",
                search_query, claude_key
            )
            if simplified and simplified != search_query:
                if igdb_enabled():
                    results = await igdb_search(simplified, "all")
                if not results:
                    results = await rawg_search(simplified, "", key_param)
                if results: search_query = simplified
        except: pass

    return {"results": results, "selected": search_query}

@app.post("/api/identify-game")
async def identify_game(request: Request):
    claude_key = request.headers.get("x-claude-key","")
    body = await request.json()
    image_data = body.get("image",""); media_type = body.get("mediaType","image/jpeg")
    if not claude_key or not image_data: return {"name": ""}
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key":claude_key,"anthropic-version":"2023-06-01","content-type":"application/json"},
                json={"model":"claude-haiku-4-5-20251001","max_tokens":60,
                      "system":"你是遊戲辨識助理，專門辨識遊戲卡帶、遊戲盒、遊戲截圖。根據圖片識別出遊戲的官方英文名稱。只回傳英文遊戲名稱，不加任何說明或標點。",
                      "messages":[{"role":"user","content":[
                          {"type":"image","source":{"type":"base64","media_type":media_type,"data":image_data}},
                          {"type":"text","text":"這是什麼遊戲？請回傳官方英文遊戲名稱。"}
                      ]}]},
                timeout=30
            )
        name = res.json().get("content",[{}])[0].get("text","").strip()
        return {"name": name}
    except: return {"name": ""}

import os.path
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
