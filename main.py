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
IGDB_CLIENT_ID     = os.getenv("IGDB_CLIENT_ID", "")
IGDB_CLIENT_SECRET = os.getenv("IGDB_CLIENT_SECRET", "")
RAWG_API_KEY       = os.getenv("RAWG_API_KEY", "")

_default_db = os.getenv("DB_PATH", "/data/switch_vault.db")
try:
    os.makedirs(os.path.dirname(_default_db), exist_ok=True)
    open(_default_db, "a").close()
    DB_PATH = _default_db
except Exception:
    DB_PATH = "/tmp/switch_vault.db"

def igdb_enabled(): return bool(IGDB_CLIENT_ID and IGDB_CLIENT_SECRET)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        conn = get_db()
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '玩家',
            avatar TEXT,
            is_public INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, cover TEXT,
            genres TEXT DEFAULT '[]', rating REAL, added_at TEXT,
            number INTEGER, fun_rating INTEGER,
            platforms TEXT DEFAULT '[]', released TEXT, owned_platform TEXT,
            user_id TEXT DEFAULT 'default'
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS borrows (
            id TEXT PRIMARY KEY, game_id TEXT NOT NULL, borrower_name TEXT NOT NULL,
            borrow_date TEXT NOT NULL, expected_return TEXT NOT NULL, returned_at TEXT,
            from_user_id TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS rawg_games (
            name TEXT PRIMARY KEY, released TEXT, first_seen TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS borrow_requests (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            requester_user_id TEXT NOT NULL,
            requester_name TEXT NOT NULL,
            message TEXT DEFAULT '',
            expected_return TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS game_covers (
            id TEXT PRIMARY KEY,
            base_game_id TEXT NOT NULL,
            cover_url TEXT NOT NULL,
            contributed_by TEXT NOT NULL DEFAULT 'default',
            source TEXT DEFAULT 'upload',
            created_at TEXT NOT NULL
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_game_covers_base ON game_covers(base_game_id)")
        for col, typedef in [
            ("number","INTEGER"),("fun_rating","INTEGER"),
            ("platforms","TEXT DEFAULT '[]'"),("released","TEXT"),
            ("owned_platform","TEXT"),("user_id","TEXT DEFAULT 'default'"),("cover","TEXT"),
            ("base_game_id","TEXT"),
        ]:
            try: conn.execute(f"ALTER TABLE games ADD COLUMN {col} {typedef}")
            except: pass
        for col, typedef in [("from_user_id","TEXT")]:
            try: conn.execute(f"ALTER TABLE borrows ADD COLUMN {col} {typedef}")
            except: pass
        conn.execute("""INSERT OR IGNORE INTO users (id, name, is_public, created_at)
            VALUES ('default', '我的收藏', 1, ?)""", (datetime.now().isoformat(),))
        conn.commit(); conn.close()
    except Exception as e:
        print(f"[init_db error] {e}")

init_db()

def verify_admin(x_admin_pin: Optional[str] = Header(None)):
    return  # [AUTH-DISABLED]

# ── Models ────────────────────────────────────────────────────────────────
class GameIn(BaseModel):
    id: str; name: str; cover: Optional[str] = None
    genres: List[str] = []; rating: Optional[float] = None
    number: Optional[int] = None; fun_rating: Optional[int] = None
    platforms: List[str] = []; released: Optional[str] = None
    owned_platform: Optional[str] = None; user_id: str = "default"
    base_game_id: Optional[str] = None

class GameUpdate(BaseModel):
    number: Optional[int] = None; fun_rating: Optional[int] = None
    name: Optional[str] = None; owned_platform: Optional[str] = None; cover: Optional[str] = None

class BorrowIn(BaseModel):
    id: str; game_id: str; borrower_name: str
    borrow_date: str; expected_return: str; from_user_id: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None; is_public: Optional[int] = None; avatar: Optional[str] = None

class BorrowRequestIn(BaseModel):
    id: str; game_id: str; owner_user_id: str; requester_user_id: str
    requester_name: str; message: str = ""; expected_return: str

# ── User endpoints ────────────────────────────────────────────────────────
@app.get("/api/users")
def list_users():
    conn = get_db()
    rows = conn.execute("SELECT * FROM users WHERE is_public=1 ORDER BY created_at").fetchall()
    conn.close()
    return [{"id":r["id"],"name":r["name"],"avatar":r["avatar"],"isPublic":r["is_public"],"createdAt":r["created_at"]} for r in rows]

@app.get("/api/users/{user_id}")
def get_user(user_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if not row: raise HTTPException(404)
    return {"id":row["id"],"name":row["name"],"avatar":row["avatar"],"isPublic":row["is_public"],"createdAt":row["created_at"]}

@app.patch("/api/users/{user_id}", dependencies=[Depends(verify_admin)])
def update_user(user_id: str, u: UserUpdate):
    conn = get_db()
    if u.name is not None: conn.execute("UPDATE users SET name=? WHERE id=?",(u.name,user_id))
    if u.is_public is not None: conn.execute("UPDATE users SET is_public=? WHERE id=?",(u.is_public,user_id))
    if u.avatar is not None: conn.execute("UPDATE users SET avatar=? WHERE id=?",(u.avatar,user_id))
    conn.commit(); conn.close()
    return {"ok": True}

@app.post("/api/users", dependencies=[Depends(verify_admin)])
def create_user(u: dict):
    conn = get_db()
    uid = u.get("id", "user_" + str(int(_time.time())))
    conn.execute("INSERT OR IGNORE INTO users (id,name,is_public,created_at) VALUES (?,?,?,?)",
        (uid, u.get("name","玩家"), u.get("is_public",1), datetime.now().isoformat()))
    conn.commit(); conn.close()
    return {"ok": True, "id": uid}

@app.get("/api/users/{user_id}/games")
def get_user_games(user_id: str):
    conn = get_db()
    # 公開用戶才能看
    user = conn.execute("SELECT is_public FROM users WHERE id=?", (user_id,)).fetchone()
    if not user: raise HTTPException(404)
    rows = conn.execute("SELECT * FROM games WHERE user_id=? ORDER BY added_at DESC", (user_id,)).fetchall()
    conn.close()
    return [{"id":r["id"],"name":r["name"],"cover":r["cover"],
             "genres":json.loads(r["genres"] or "[]"),"rating":r["rating"],
             "addedAt":r["added_at"],"number":r["number"],"funRating":r["fun_rating"],
             "platforms":json.loads(r["platforms"] or "[]"),"released":r["released"],
             "ownedPlatform":r["owned_platform"],"userId":r["user_id"],
             "baseGameId":r["base_game_id"]} for r in rows]

# ── Borrow Request endpoints ───────────────────────────────────────────────
@app.get("/api/borrow-requests")
def list_borrow_requests(user_id: str = "default"):
    conn = get_db()
    rows = conn.execute("""SELECT br.*, g.name as game_name, g.cover as game_cover
        FROM borrow_requests br LEFT JOIN games g ON br.game_id = g.id
        WHERE br.owner_user_id=? OR br.requester_user_id=?
        ORDER BY br.created_at DESC""", (user_id, user_id)).fetchall()
    conn.close()
    return [{"id":r["id"],"gameId":r["game_id"],"gameName":r["game_name"],"gameCover":r["game_cover"],
             "ownerUserId":r["owner_user_id"],"requesterUserId":r["requester_user_id"],
             "requesterName":r["requester_name"],"message":r["message"],
             "expectedReturn":r["expected_return"],"status":r["status"],
             "createdAt":r["created_at"],"updatedAt":r["updated_at"]} for r in rows]

@app.post("/api/borrow-requests")
def create_borrow_request(req: BorrowRequestIn):
    conn = get_db()
    conn.execute("""INSERT INTO borrow_requests
        (id,game_id,owner_user_id,requester_user_id,requester_name,message,expected_return,status,created_at)
        VALUES (?,?,?,?,?,?,?,'pending',?)""",
        (req.id,req.game_id,req.owner_user_id,req.requester_user_id,
         req.requester_name,req.message,req.expected_return,datetime.now().isoformat()))
    conn.commit(); conn.close()
    return {"ok": True}

@app.patch("/api/borrow-requests/{req_id}", dependencies=[Depends(verify_admin)])
def update_borrow_request(req_id: str, body: dict):
    status = body.get("status")
    if status not in ("approved","rejected","cancelled"): raise HTTPException(400)
    conn = get_db()
    conn.execute("UPDATE borrow_requests SET status=?,updated_at=? WHERE id=?",
        (status, datetime.now().isoformat(), req_id))
    conn.commit(); conn.close()
    return {"ok": True}

# ── Games CRUD ────────────────────────────────────────────────────────────
@app.get("/api/games")
def list_games(user_id: str = "default"):
    conn = get_db()
    rows = conn.execute("SELECT * FROM games WHERE user_id=? ORDER BY added_at DESC", (user_id,)).fetchall()
    conn.close()
    return [{"id":r["id"],"name":r["name"],"cover":r["cover"],
             "genres":json.loads(r["genres"] or "[]"),"rating":r["rating"],
             "addedAt":r["added_at"],"number":r["number"],"funRating":r["fun_rating"],
             "platforms":json.loads(r["platforms"] or "[]"),"released":r["released"],
             "ownedPlatform":r["owned_platform"],"userId":r["user_id"],
             "baseGameId":r["base_game_id"]} for r in rows]

@app.post("/api/games", dependencies=[Depends(verify_admin)])
def add_game(g: GameIn):
    conn = get_db()
    base_id = g.base_game_id or g.id  # 若無指定，base 就是自己的 id
    try:
        conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (g.id, g.name, g.cover, json.dumps(g.genres), g.rating,
             datetime.now().isoformat(), g.number, g.fun_rating,
             json.dumps(g.platforms), g.released, g.owned_platform, g.user_id, base_id))
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
    if g.cover is not None: conn.execute("UPDATE games SET cover=? WHERE id=?",(g.cover,game_id))
    conn.commit(); conn.close()
    return {"ok": True}

@app.delete("/api/games/{game_id}", dependencies=[Depends(verify_admin)])
def delete_game(game_id: str):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id=?",(game_id,))
    conn.commit(); conn.close(); return {"ok": True}

# ── Borrows CRUD ──────────────────────────────────────────────────────────
@app.get("/api/borrows")
def list_borrows(user_id: str = "default"):
    conn = get_db()
    rows = conn.execute("""SELECT b.* FROM borrows b
        JOIN games g ON b.game_id = g.id
        WHERE g.user_id=? ORDER BY b.borrow_date DESC""", (user_id,)).fetchall()
    conn.close()
    return [{"id":r["id"],"gameId":r["game_id"],"borrowerName":r["borrower_name"],
             "borrowDate":r["borrow_date"],"expectedReturn":r["expected_return"],
             "returnedAt":r["returned_at"],"fromUserId":r["from_user_id"]} for r in rows]

@app.post("/api/borrows", dependencies=[Depends(verify_admin)])
def add_borrow(b: BorrowIn):
    conn = get_db()
    conn.execute("INSERT INTO borrows VALUES (?,?,?,?,?,NULL,?)",
        (b.id,b.game_id,b.borrower_name,b.borrow_date,b.expected_return,b.from_user_id))
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

# ── Config ────────────────────────────────────────────────────────────────
@app.get("/api/nintendo-name")
async def nintendo_name(q: str):
    """查任天堂台灣官網的官方中文遊戲名稱"""
    try:
        url = (
            "https://searching.nintendo-europe.com/zh-Hant/select"
            f"?q={q}&rows=3&start=0&type=GAME&nso=0&sort=score+desc"
        )
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if res.status_code != 200:
            return {"name": ""}
        data = res.json()
        items = data.get("response", {}).get("docs", [])
        if not items:
            return {"name": ""}
        # 找最接近的結果（比對英文名）
        q_lower = q.lower()
        best = None
        for item in items:
            title_en = (item.get("title") or "").lower()
            if q_lower in title_en or title_en in q_lower:
                best = item
                break
        if not best:
            best = items[0]
        # 優先取繁中名稱
        zh_name = (best.get("title_extras_txt") or [None])[0] or best.get("title") or ""
        return {"name": zh_name.strip()}
    except Exception as e:
        print(f"[nintendo-name] {e}")
        return {"name": ""}

@app.get("/api/config")
def get_config():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM rawg_games").fetchone()[0]
    conn.close()
    return {"ok": True, "igdbEnabled": igdb_enabled(), "rawgDbSize": total}

# ── IGDB ──────────────────────────────────────────────────────────────────
IGDB_PLAT = {"7":"(130)","18,187":"(48,167)","1,186":"(49,169)","4":"(6)"}

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
        res = await client.post("https://id.twitch.tv/oauth2/token",
            params={"client_id":IGDB_CLIENT_ID,"client_secret":IGDB_CLIENT_SECRET,"grant_type":"client_credentials"},
            timeout=10)
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
        res = await client.post("https://api.igdb.com/v4/games",
            headers={"Client-ID":IGDB_CLIENT_ID,"Authorization":f"Bearer {token}"},
            content=body, timeout=10)
    if res.status_code != 200: return []
    result = []
    for g in res.json():
        img_id = g.get("cover",{}).get("image_id") if g.get("cover") else None
        cover = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{img_id}.jpg" if img_id else None
        released = None
        if g.get("first_release_date"):
            try: released = datetime.utcfromtimestamp(g["first_release_date"]).strftime("%Y-%m-%d")
            except: pass
        result.append({"id":str(g["id"]),"name":g["name"],"background_image":cover,
            "genres":[{"name":gn["name"]} for gn in g.get("genres",[])],
            "released":released,
            "platforms":[{"platform":{"slug":igdb_plat_slug(p.get("name","")),"name":p.get("name","")}}
                for p in g.get("platforms",[])]})
    return result

# ── RAWG ──────────────────────────────────────────────────────────────────
async def rawg_search(q: str, plat_param: str, key_param: str) -> list:
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"https://api.rawg.io/api/games?search={q}&page_size=12{plat_param}{key_param}",
            timeout=10)
    return res.json().get("results", [])

CACHE_TTL = 48 * 3600

async def refresh_rawg_games(api_key: str):
    try:
        key_param = f"&key={api_key}" if api_key else ""
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.rawg.io/api/games?platforms=7&ordering=-released&page_size=40{key_param}",
                timeout=10)
        conn = get_db(); now = datetime.now().isoformat()
        for g in res.json().get("results", []):
            conn.execute("INSERT OR IGNORE INTO rawg_games VALUES (?,?,?)",
                (g["name"],g.get("released",""),now))
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
        res = await client.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key":claude_key,"anthropic-version":"2023-06-01","content-type":"application/json"},
            json={"model":"claude-haiku-4-5-20251001","max_tokens":60,
                  "system":system,"messages":[{"role":"user","content":user_msg}]},
            timeout=10)
    return res.json().get("content",[{}])[0].get("text","").strip()

# ── Search endpoints ──────────────────────────────────────────────────────
@app.get("/api/catalog")
def search_catalog(q: str = "", user_id: str = "default"):
    """搜尋所有用戶已建立的遊戲目錄，回傳去重後的結果（優先顯示）"""
    conn = get_db()
    if q.strip():
        rows = conn.execute("""
            SELECT id, name, cover, genres, platforms, released,
                   COUNT(DISTINCT user_id) as owner_count,
                   MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) as i_own_it
            FROM games
            WHERE LOWER(name) LIKE ?
            GROUP BY id
            ORDER BY owner_count DESC, name
            LIMIT 20
        """, (user_id, f"%{q.lower()}%")).fetchall()
    else:
        rows = []
    conn.close()
    return [{"id":r["id"],"name":r["name"],"cover":r["cover"],
             "genres":json.loads(r["genres"] or "[]"),
             "platforms":json.loads(r["platforms"] or "[]"),
             "released":r["released"],
             "ownerCount":r["owner_count"],
             "iOwnIt":bool(r["i_own_it"])} for r in rows]

@app.post("/api/catalog/import", dependencies=[Depends(verify_admin)])
def import_from_catalog(body: dict):
    """從共用目錄直接導入到自己的收藏（不需重新抓封面）"""
    game_id = body.get("game_id")
    user_id = body.get("user_id", "default")
    number  = body.get("number")
    fun_rating = body.get("fun_rating")
    owned_platform = body.get("owned_platform")

    conn = get_db()
    # 找到任一有這個 game_id 的記錄作為模板
    src = conn.execute("SELECT * FROM games WHERE id=? LIMIT 1", (game_id,)).fetchone()
    if not src:
        conn.close(); raise HTTPException(404, "Game not found in catalog")
    # 檢查自己是否已有
    existing = conn.execute("SELECT id FROM games WHERE id=? AND user_id=?", (game_id, user_id)).fetchone()
    if existing:
        conn.close(); return {"ok": True, "note": "already_owned"}
    # 複製一筆給自己
    new_id = f"{game_id}_{user_id}"
    conn.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (new_id, src["name"], src["cover"], src["genres"], src["rating"],
         datetime.now().isoformat(), number, fun_rating,
         src["platforms"], src["released"], owned_platform, user_id))
    conn.commit(); conn.close()
    return {"ok": True, "new_id": new_id}

@app.get("/api/game-covers/{base_game_id}")
def get_game_covers(base_game_id: str):
    conn = get_db()
    rows = conn.execute("""SELECT gc.*, u.name as user_name
        FROM game_covers gc LEFT JOIN users u ON gc.contributed_by = u.id
        WHERE gc.base_game_id = ?
        ORDER BY gc.created_at DESC""", (base_game_id,)).fetchall()
    conn.close()
    return [{"id":r["id"],"coverUrl":r["cover_url"],"contributedBy":r["contributed_by"],
             "userName":r["user_name"] or "匿名","source":r["source"],
             "createdAt":r["created_at"]} for r in rows]

@app.post("/api/game-covers", dependencies=[Depends(verify_admin)])
def contribute_cover(body: dict):
    base_game_id    = body.get("base_game_id","")
    cover_url       = body.get("cover_url","")
    contributed_by  = body.get("contributed_by","default")
    source          = body.get("source","upload")
    if not base_game_id or not cover_url:
        raise HTTPException(400, "base_game_id and cover_url required")
    conn = get_db()
    # 避免重複（同一用戶同一張）
    dup = conn.execute("SELECT id FROM game_covers WHERE base_game_id=? AND contributed_by=? AND cover_url=?",
        (base_game_id, contributed_by, cover_url)).fetchone()
    if not dup:
        cid = f"cov_{contributed_by}_{int(_time.time()*1000)}"
        conn.execute("INSERT INTO game_covers VALUES (?,?,?,?,?,?)",
            (cid, base_game_id, cover_url, contributed_by, source, datetime.now().isoformat()))
        conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/search")
async def search_games(q: str, platform: str = "7"):
    if igdb_enabled():
        try:
            results = await igdb_search(q, platform)
            if results: return {"results":results,"selected":q}
            if platform != "all":
                results = await igdb_search(q, "all")
                if results: return {"results":results,"selected":q}
        except: pass
    key_param = f"&key={RAWG_API_KEY}" if RAWG_API_KEY else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    results = await rawg_search(q, plat_param, key_param)
    if not results and plat_param:
        results = await rawg_search(q, "", key_param)
    return {"results":results,"selected":q}

@app.get("/api/smart-search")
async def smart_search(q: str, platform: str = "7", request: Request = None):
    claude_key = request.headers.get("x-claude-key","")
    search_query = q
    recent_ctx = ""
    if claude_key:
        try:
            recent = await get_rawg_games_for_prompt(RAWG_API_KEY)
            if recent:
                lines = "\n".join(f"- {g['name']} ({g['released']})" for g in recent)
                recent_ctx = "\n\n以下是近期 Switch 新遊戲（2024 年底後，補充參考）：\n" + lines
        except: pass
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
                "- 瑪利歐賽車世界 → Mario Kart World"
                + recent_ctx)
            translated = await claude_query(system_translate, q, claude_key)
            if translated: search_query = translated
        except: pass
    if igdb_enabled():
        try:
            results = await igdb_search(search_query, platform)
            if not results and platform != "all":
                results = await igdb_search(search_query, "all")
            if results: return {"results":results,"selected":search_query}
        except: pass
    key_param = f"&key={RAWG_API_KEY}" if RAWG_API_KEY else ""
    plat_param = f"&platforms={platform}" if platform and platform != "all" else ""
    results = await rawg_search(search_query, plat_param, key_param)
    if not results and plat_param:
        results = await rawg_search(search_query, "", key_param)
    if not results and claude_key and search_query != q:
        try:
            simplified = await claude_query(
                "把遊戲搜尋關鍵字縮短成最核心的系列名稱，去掉副標題、版本號、年份。只回傳英文名稱。",
                search_query, claude_key)
            if simplified and simplified != search_query:
                if igdb_enabled():
                    results = await igdb_search(simplified, "all")
                if not results:
                    results = await rawg_search(simplified, "", key_param)
                if results: search_query = simplified
        except: pass
    return {"results":results,"selected":search_query}

@app.post("/api/identify-game")
async def identify_game(request: Request):
    claude_key = request.headers.get("x-claude-key","")
    body = await request.json()
    image_data = body.get("image",""); media_type = body.get("mediaType","image/jpeg")
    if not claude_key or not image_data: return {"name":""}
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key":claude_key,"anthropic-version":"2023-06-01","content-type":"application/json"},
                json={"model":"claude-haiku-4-5-20251001","max_tokens":60,
                      "system":"你是遊戲辨識助理。根據圖片識別出遊戲的官方英文名稱。只回傳英文遊戲名稱，不加任何說明或標點。",
                      "messages":[{"role":"user","content":[
                          {"type":"image","source":{"type":"base64","media_type":media_type,"data":image_data}},
                          {"type":"text","text":"這是什麼遊戲？請回傳官方英文遊戲名稱。"}
                      ]}]},
                timeout=30)
        name = res.json().get("content",[{}])[0].get("text","").strip()
        return {"name":name}
    except: return {"name":""}

import os.path
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
