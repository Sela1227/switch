import { useState, useEffect, useRef } from "react";

const VERSION = "V1.10.6";

// ── 平台定義 ─────────────────────────────────────────────────────────────
const PLATFORMS = [
  { id: "all",    label: "全部",   rawg: "all",    slugs: [] },
  { id: "switch", label: "Switch", rawg: "7",      slugs: ["nintendo-switch"] },
  { id: "ps",     label: "PS",     rawg: "18,187", slugs: ["playstation4","playstation5"] },
  { id: "xbox",   label: "Xbox",   rawg: "1,186",  slugs: ["xbox-one","xbox-series-x","xbox-series-s"] },
  { id: "pc",     label: "PC",     rawg: "4",      slugs: ["pc"] },
];

const PLAT_SLUG_LABEL = {
  "nintendo-switch": "Switch",
  "playstation5":    "PS5",
  "playstation4":    "PS4",
  "xbox-series-x":  "Xbox SX",
  "xbox-series-s":  "Xbox SS",
  "xbox-one":        "Xbox One",
  "pc":              "PC",
  "ios":             "iOS",
  "android":         "Android",
};
const MAJOR_SLUGS = Object.keys(PLAT_SLUG_LABEL);

// 搜尋平台 rawg id → 預設擁有的 slug
const PLAT_DEFAULT_SLUG = {
  "7":      "nintendo-switch",
  "18,187": "playstation5",
  "1,186":  "xbox-series-x",
  "4":      "pc",
  "all":    "nintendo-switch",
};

const SORT_OPTIONS = [
  { id: "default",   label: "新增順序" },
  { id: "number",    label: "編號 ↑" },
  { id: "funRating", label: "好玩度 ↓" },
  { id: "released",  label: "發行日期 ↓" },
];

// ── 工具函數 ─────────────────────────────────────────────────────────────
function matchPlatform(game, platId) {
  if (platId === "all") return true;
  const p = PLATFORMS.find(x => x.id === platId);
  if (!p) return true;
  // 如果有設定自己的版本，只依 ownedPlatform 判斷
  if (game.ownedPlatform) {
    return p.slugs.some(s => game.ownedPlatform.startsWith(s) || game.ownedPlatform === s);
  }
  // 否則用 RAWG 的平台清單
  if (!game.platforms || !game.platforms.length) return true;
  return game.platforms.some(slug => p.slugs.some(s => slug.startsWith(s) || slug === s));
}

function sortGames(games, sortBy) {
  if (sortBy === "default") return games;
  return [...games].sort((a, b) => {
    if (sortBy === "number") {
      if (a.number == null && b.number == null) return 0;
      if (a.number == null) return 1;
      if (b.number == null) return -1;
      return a.number - b.number;
    }
    if (sortBy === "funRating") {
      if (a.funRating == null && b.funRating == null) return 0;
      if (a.funRating == null) return 1;
      if (b.funRating == null) return -1;
      return b.funRating - a.funRating;
    }
    if (sortBy === "released") {
      if (!a.released && !b.released) return 0;
      if (!a.released) return 1;
      if (!b.released) return -1;
      return b.released.localeCompare(a.released);
    }
    return 0;
  });
}

async function api(path, { method = "GET", body, pin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (pin) headers["x-admin-pin"] = pin;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function smartSearch(query, claudeKey, platform) {
  const headers = { "Content-Type": "application/json" };
  if (claudeKey) headers["x-claude-key"] = claudeKey;
  const endpoint = claudeKey ? "/api/smart-search" : "/api/search";
  const platParam = platform && platform !== "all" ? `&platform=${platform}` : "&platform=all";
  const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}${platParam}`, { headers });
  if (!res.ok) throw new Error("search failed");
  return res.json();
}

const today = () => new Date().toISOString().split("T")[0];
function isOverdue(b) { return !b.returnedAt && new Date(b.expectedReturn) < new Date(); }
function daysDiff(d) { return Math.floor((new Date() - new Date(d)) / 86400000); }
const GENRE_ZH = {
  "Action": "動作", "Adventure": "冒險", "RPG": "角色扮演",
  "Role Playing Games": "角色扮演", "Strategy": "策略", "Simulation": "模擬",
  "Sports": "運動", "Racing": "競速", "Fighting": "格鬥",
  "Shooter": "射擊", "Platformer": "平台跳躍", "Puzzle": "解謎",
  "Horror": "恐怖", "Family": "家庭", "Casual": "休閒",
  "Indie": "獨立", "Arcade": "街機", "Card": "卡牌",
  "Board Games": "桌遊", "Educational": "教育", "Music": "音樂",
  "Massively Multiplayer": "多人線上", "Point-and-click": "點擊冒險",
  "Beat 'em up": "清版動作", "Hack and slash": "砍殺動作",
};
const gZh = (name) => GENRE_ZH[name] || name;

const GRID_COLS = { large: 4, medium: 6, small: 8, mini: 12 };

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]         = useState("collection");
  const [games, setGames]     = useState([]);
  const [borrows, setBorrows] = useState([]);
  const [isAdmin]             = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [modal, setModal]         = useState(null);
  const [selGame, setSelGame]     = useState(null);
  const [selBorrow, setSelBorrow] = useState(null);

  const [query, setQuery]             = useState("");
  const [translatedQ, setTranslatedQ] = useState("");
  const [results, setResults]         = useState([]);
  const [resultPlatforms, setResultPlatforms] = useState({});
  const [searching, setSearching]     = useState(false);
  const [searchErr, setSearchErr]     = useState("");
  const [searchPlatform, setSearchPlatform] = useState("7");
  const [manualQ, setManualQ]         = useState("");
  const [showManualQ, setShowManualQ] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const cameraRef = useRef(null);

  const [borrowForm, setBorrowForm] = useState({ name: "", borrowDate: today(), expectedReturn: "" });
  const [collFilter, setCollFilter] = useState("all");
  const [wallPlatform, setWallPlatform] = useState(() => localStorage.getItem("svWallPlat") || "all");
  const [sortBy, setSortBy]   = useState(() => localStorage.getItem("svSort") || "default");
  const [gridSize, setGridSize] = useState(() => localStorage.getItem("svGrid") || "small");

  const [settingsForm, setSettingsForm] = useState({ claudeKey: "" });
  const [editForm, setEditForm]   = useState({ number: "", funRating: "", name: "", ownedPlatform: "" });
  const [saving, setSaving]       = useState(false);
  const [showAllHist, setShowAllHist] = useState(false);
  const [addTab, setAddTab]       = useState("search"); // "search" | "manual"
  const [manualForm, setManualForm] = useState({ name:"", released:"", genres:"" });
  const [manualCover, setManualCover] = useState(null); // base64
  const imgRef = useRef(null);

  const claudeKey = () => localStorage.getItem("svClaudeKey") || "";
  const adminPin  = () => sessionStorage.getItem("svPin") || "";

  async function loadAll() {
    setLoading(true); setError("");
    try {
      const [g, b] = await Promise.all([api("/api/games"), api("/api/borrows")]);
      setGames(g); setBorrows(b);
    } catch { setError("無法連線到伺服器，請稍後再試"); }
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  // 搜尋結果到後，為每個遊戲設定預設擁有平台
  useEffect(() => {
    if (!results.length) return;
    const defaultSlug = PLAT_DEFAULT_SLUG[searchPlatform] || "nintendo-switch";
    const init = {};
    results.forEach(r => {
      const slugs = (r.platforms || []).map(p => p.platform.slug).filter(s => MAJOR_SLUGS.includes(s));
      init[r.id] = slugs.includes(defaultSlug) ? defaultSlug : (slugs[0] || defaultSlug);
    });
    setResultPlatforms(init);
  }, [results, searchPlatform]);

  const activeBorrows   = borrows.filter(b => !b.returnedAt);
  const overdueBorrows  = activeBorrows.filter(isOverdue);
  const getGame         = id => games.find(g => g.id === id);
  const getActiveBorrow = gid => activeBorrows.find(b => b.gameId === gid);
  const filteredGames   = sortGames(
    games.filter(g => {
      if (collFilter === "available" && getActiveBorrow(g.id)) return false;
      if (collFilter === "borrowed" && !getActiveBorrow(g.id)) return false;
      if (!matchPlatform(g, wallPlatform)) return false;
      return true;
    }),
    sortBy
  );

  async function doSearch() {
    if (!query.trim()) return;
    setSearching(true); setResults([]); setSearchErr(""); setTranslatedQ(""); setShowManualQ(false);
    const plat = PLATFORMS.find(p => p.rawg === searchPlatform)?.rawg || "all";
    try {
      const data = await smartSearch(query, claudeKey(), plat);
      setResults(data.results || []);
      if (data.selected && data.selected !== query) setTranslatedQ(data.selected);
    } catch { setSearchErr("搜尋失敗，請確認網路連線"); }
    setSearching(false);
  }

  async function doDirectSearch(customQ) {
    if (!customQ.trim()) return;
    setSearching(true); setResults([]); setSearchErr(""); setShowManualQ(false);
    const plat = PLATFORMS.find(p => p.rawg === searchPlatform)?.rawg || "all";
    const platParam = plat && plat !== "all" ? `&platform=${plat}` : "&platform=all";
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(customQ)}${platParam}`);
      const data = await res.json();
      setResults(data.results || []);
      setTranslatedQ(customQ !== query ? customQ : "");
    } catch { setSearchErr("搜尋失敗"); }
    setSearching(false);
  }

  async function handleCamera(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIdentifying(true); setResults([]); setSearchErr(""); setTranslatedQ(""); setShowManualQ(false);
    try {
      // 壓縮圖片（max 1024px，避免傳太大）
      const base64 = await new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1024;
          const ratio = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
        };
        img.src = url;
      });
      const res = await fetch("/api/identify-game", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-claude-key": claudeKey() },
        body: JSON.stringify({ image: base64, mediaType: "image/jpeg" })
      });
      const data = await res.json();
      if (data.name) {
        setQuery(data.name);
        setIdentifying(false);
        // 直接用辨識到的名稱搜尋
        setSearching(true);
        const plat = PLATFORMS.find(p => p.rawg === searchPlatform)?.rawg || "all";
        const platParam = plat && plat !== "all" ? `&platform=${plat}` : "&platform=all";
        const r2 = await fetch(`/api/search?q=${encodeURIComponent(data.name)}${platParam}`);
        const d2 = await r2.json();
        setResults(d2.results || []);
        setTranslatedQ(data.name);
        setSearching(false);
      } else {
        setSearchErr("辨識失敗，請手動輸入遊戲名稱");
      }
    } catch {
      setSearchErr("辨識失敗，請手動輸入遊戲名稱");
    }
    setIdentifying(false);
  }

  async function addGame(r, ownedPlatform) {
    const platformSlugs = (r.platforms || []).map(p => p.platform.slug);
    try {
      await api("/api/games", { method: "POST", pin: adminPin(), body: {
        id: String(r.id), name: r.name, cover: r.background_image,
        genres: r.genres?.map(x => x.name) || [], rating: r.rating,
        platforms: platformSlugs, released: r.released || null,
        owned_platform: ownedPlatform || null
      }});
      await loadAll();
    } catch { alert("新增失敗"); }
    closeAddGame();
  }

  function closeAddGame() {
    setModal(null); setQuery(""); setResults([]); setSearchErr("");
    setTranslatedQ(""); setShowManualQ(false);
    setAddTab("search"); setManualForm({ name:"", released:"", genres:"" }); setManualCover(null);
  }

  async function submitBorrow() {
    if (!selGame || !borrowForm.name || !borrowForm.expectedReturn) return;
    try {
      await api("/api/borrows", { method: "POST", pin: adminPin(), body: {
        id: Date.now().toString(), game_id: selGame.id,
        borrower_name: borrowForm.name, borrow_date: borrowForm.borrowDate,
        expected_return: borrowForm.expectedReturn
      }});
      await loadAll();
      setBorrowForm({ name: "", borrowDate: today(), expectedReturn: "" });
      setModal(null);
    } catch { alert("新增失敗"); }
  }

  async function submitReturn() {
    if (!selBorrow) return;
    try {
      await api(`/api/borrows/${selBorrow.id}/return`, { method: "PATCH", pin: adminPin() });
      await loadAll(); setModal(null);
    } catch { alert("歸還失敗"); }
  }

  async function deleteBorrow(id) {
    try {
      await api(`/api/borrows/${id}`, { method: "DELETE", pin: adminPin() });
      await loadAll();
    } catch { alert("刪除失敗"); }
  }

  async function addManualGame() {
    if (!manualForm.name.trim()) return;
    const id = "manual_" + Date.now();
    const genres = manualForm.genres ? manualForm.genres.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
    try {
      await api("/api/games", { method:"POST", pin:adminPin(), body:{
        id, name:manualForm.name.trim(),
        cover: manualCover || null,
        genres, released: manualForm.released || null,
        platforms:[], owned_platform: null
      }});
      await loadAll();
      setManualForm({ name:"", released:"", genres:"" });
      setManualCover(null);
      setAddTab("search");
      setModal(null);
    } catch { alert("新增失敗"); }
  }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const base64 = await new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        // 縮放到最大 400px 寬（直式封面）
        const max = 400;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = url;
    });
    setManualCover(base64);
  }

  async function deleteGame(id) {
    try {
      await api(`/api/games/${id}`, { method: "DELETE", pin: adminPin() });
      await loadAll(); setModal(null);
    } catch { alert("刪除失敗"); }
  }

  async function saveGameEdit(id) {
    setSaving(true);
    try {
      const body = {};
      if (editForm.number !== "") body.number = parseInt(editForm.number) || null;
      if (editForm.funRating !== "") body.fun_rating = parseInt(editForm.funRating) || null;
      if (editForm.name.trim()) body.name = editForm.name.trim();
      body.owned_platform = editForm.ownedPlatform || null;
      await api(`/api/games/${id}`, { method: "PATCH", pin: adminPin(), body });
      await loadAll();
    } catch { alert("儲存失敗"); }
    setSaving(false);
  }

  function setGrid(s) { setGridSize(s); localStorage.setItem("svGrid", s); }
  function setWallPlat(p) { setWallPlatform(p); localStorage.setItem("svWallPlat", p); }
  function setSort(s) { setSortBy(s); localStorage.setItem("svSort", s); }

  if (loading) return (
    <div style={{ background: "#0c0c0f", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "#888" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎮</div>
        <div style={{ fontFamily: "monospace", letterSpacing: 2 }}>LOADING...</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background: "#0c0c0f", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "#f87171", padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ marginBottom: 16 }}>{error}</div>
        <button style={S.redBtn} onClick={loadAll}>重試</button>
      </div>
    </div>
  );

  const cols = GRID_COLS[gridSize] || 4;
  const isCompact = cols >= 8; // small/mini

  return (
    <div style={S.app}>
      {/* Header */}
      <header style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0, overflow:"hidden" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>🎮</span>
          <span style={{ fontWeight:900, fontSize:13, letterSpacing:1, color:"#fff", textTransform:"uppercase", whiteSpace:"nowrap" }}>SWITCH VAULT</span>
          <span style={{ fontSize:9, color:"#444", fontFamily:"monospace", flexShrink:0 }}>{VERSION}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:3, flexShrink:0 }}>
          {/* 格大小 */}
          <div style={{ display:"flex", background:"#1a1a24", borderRadius:6, overflow:"hidden", border:"1px solid #2a2a38" }}>
            {[["large","大"],["medium","中"],["small","小"],["mini","微"]].map(([s,l]) => (
              <button key={s} onClick={() => setGrid(s)}
                style={{ background:gridSize===s?"#e60012":"transparent", border:"none",
                         color:gridSize===s?"#fff":"#555", padding:"5px 7px", fontSize:12,
                         cursor:"pointer", fontFamily:"inherit", minHeight:30, touchAction:"manipulation" }}>
                {l}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button style={{ background:"#e60012", border:"none", color:"#fff", padding:"5px 10px", borderRadius:6, fontSize:14, cursor:"pointer", fontWeight:900, minHeight:30, touchAction:"manipulation" }}
              onClick={() => setModal("addGame")}>＋</button>
          )}
          <button style={{ ...S.iconBtn, fontSize:18, minHeight:30, minWidth:30, padding:"4px" }}
            onClick={() => { setSettingsForm({ claudeKey: claudeKey() }); setModal("settings"); }}>⚙</button>
        </div>
      </header>

      {/* Main */}
      <main style={S.main}>
        {tab === "collection" && (
          <div>
            {/* Row 1：狀態篩選 + 排序 */}
            <div style={{ padding:"8px 14px 0", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", gap:5 }}>
                {[["all","全部"],["available","可借"],["borrowed","借出中"]].map(([f,l]) => (
                  <button key={f} style={f===collFilter ? S.filterActive : S.filterBtn}
                    onClick={() => setCollFilter(f)}>{l}</button>
                ))}
              </div>
              <select style={S.sortSelect} value={sortBy} onChange={e => setSort(e.target.value)}>
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            {/* Row 2：平台篩選（全寬可橫滑）*/}
            <div style={{ padding:"6px 14px 0", overflowX:"auto", display:"flex", gap:5, scrollbarWidth:"none" }}>
              {PLATFORMS.map(p => (
                <button key={p.id} style={wallPlatform===p.id ? S.filterActive : S.filterBtn}
                  onClick={() => setWallPlat(p.id)}>{p.label}</button>
              ))}
            </div>

            <div style={{ padding:"4px 14px 8px", fontSize:11, color:"#555" }}>共 {filteredGames.length} 款</div>

            {filteredGames.length === 0
              ? <Empty icon="🎮" text="點擊「＋ 新增」加入第一款遊戲" />
              : <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: isCompact ? 5 : 8, padding: "0 16px 80px" }}>
                  {filteredGames.map(g => {
                    const ab = getActiveBorrow(g.id);
                    return <GameCard key={g.id} game={g} borrow={ab} overdue={ab && isOverdue(ab)} cols={cols}
                      onClick={() => { setSelGame(g); setEditForm({ number: g.number ?? "", funRating: g.funRating ?? "", name: g.name, ownedPlatform: g.ownedPlatform || "" }); setModal("gameDetail"); }} />;
                  })}
                </div>
            }
          </div>
        )}

        {tab === "borrowed" && (
          <div style={{ padding: "12px 14px 80px" }}>
            <div style={S.sectionTitle}>借出中 — {activeBorrows.length} 筆</div>
            {activeBorrows.length === 0
              ? <Empty icon="📤" text="目前沒有借出的遊戲" />
              : activeBorrows.map(b => <BorrowRow key={b.id} borrow={b} game={getGame(b.gameId)} isAdmin={isAdmin}
                  onReturn={() => { setSelBorrow(b); setModal("return"); }} />)
            }
          </div>
        )}

        {tab === "overdue" && (
          <div style={{ padding: "12px 14px 80px" }}>
            {overdueBorrows.length > 0 && <div style={S.overdueAlert}>⚠️ {overdueBorrows.length} 款遊戲已超過歸還期限</div>}
            <div style={S.sectionTitle}>逾期未還 — {overdueBorrows.length} 筆</div>
            {overdueBorrows.length === 0
              ? <Empty icon="✅" text="沒有逾期！" />
              : overdueBorrows.map(b => <BorrowRow key={b.id} borrow={b} game={getGame(b.gameId)} isAdmin={isAdmin} overdue
                  onReturn={() => { setSelBorrow(b); setModal("return"); }} />)
            }
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav style={S.nav}>
        <NavItem label="收藏" emoji="🎮" active={tab==="collection"} onClick={() => setTab("collection")} />
        <NavItem label={`借出${activeBorrows.length ? ` (${activeBorrows.length})` : ""}`} emoji="📤" active={tab==="borrowed"} onClick={() => setTab("borrowed")} />
        <NavItem label={`逾期${overdueBorrows.length ? ` (${overdueBorrows.length})` : ""}`} emoji="⚠️" active={tab==="overdue"} onClick={() => setTab("overdue")} alert={overdueBorrows.length > 0} />
      </nav>

      {/* ── MODALS ── */}

      {/* 新增遊戲 */}
      {modal === "addGame" && (
        <Modal title="新增遊戲" onClose={closeAddGame}>
          {/* 頁籤 */}
          <div style={{ display:"flex", gap:0, marginBottom:14, background:"#1a1a24", borderRadius:10, padding:3 }}>
            {[["search","🔍 搜尋"],["manual","✏️ 手動新增"]].map(([t,l]) => (
              <button key={t} onClick={() => setAddTab(t)}
                style={{ flex:1, background:addTab===t?"#e60012":"transparent", border:"none",
                         color:addTab===t?"#fff":"#666", padding:"7px", borderRadius:8, fontSize:13,
                         cursor:"pointer", fontWeight:addTab===t?700:400, touchAction:"manipulation" }}>
                {l}
              </button>
            ))}
          </div>

          {addTab === "search" && (<>
            {/* 平台 */}
            <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
              {PLATFORMS.map(p => (
                <button key={p.id} style={searchPlatform===p.rawg ? S.filterActive : S.filterBtn}
                  onClick={() => setSearchPlatform(p.rawg)}>{p.label}</button>
              ))}
            </div>
            {/* 搜尋框 */}
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <input style={S.input} placeholder="遊戲名稱（中文或英文）" value={query}
                onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && doSearch()} />
              {claudeKey() && (
                <button style={{ ...S.searchBtn, background:"#2a2a38", fontSize:18, padding:"0 12px" }}
                  onClick={() => cameraRef.current?.click()} disabled={identifying}>
                  {identifying?"⏳":"📷"}
                </button>
              )}
              <button style={S.searchBtn} onClick={doSearch} disabled={searching||identifying}>
                {searching?"…":"搜尋"}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              style={{ display:"none" }} onChange={handleCamera} />
            {identifying && <div style={{ fontSize:12, color:"#888", marginBottom:8, textAlign:"center" }}>📷 AI 辨識中...</div>}
            {claudeKey() && <div style={{ fontSize:11, color:"#4ade80", marginBottom:4 }}>✓ Claude AI 輔助已啟用</div>}
            {translatedQ && !showManualQ && (
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, background:"#1a1a24", borderRadius:8, padding:"6px 10px" }}>
                <span style={{ fontSize:11, color:"#666" }}>🔍</span>
                <span style={{ fontSize:11, color:"#e2e2e8", flex:1 }}>{translatedQ}</span>
                <button onClick={() => { setManualQ(translatedQ); setShowManualQ(true); }}
                  style={{ fontSize:10, color:"#f87171", background:"transparent", border:"1px solid #3a1a1a", borderRadius:5, padding:"2px 8px", cursor:"pointer" }}>
                  不對？修改
                </button>
              </div>
            )}
            {showManualQ && (
              <div style={{ marginBottom:10, background:"#1a1a24", borderRadius:8, padding:"8px 10px" }}>
                <div style={{ fontSize:10, color:"#f87171", marginBottom:6 }}>輸入正確英文名稱：</div>
                <div style={{ display:"flex", gap:6 }}>
                  <input style={{ ...S.input, flex:1 }} value={manualQ}
                    onChange={e => setManualQ(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && doDirectSearch(manualQ)} />
                  <button style={S.searchBtn} onClick={() => doDirectSearch(manualQ)}>搜</button>
                  <button onClick={() => setShowManualQ(false)}
                    style={{ background:"#2a2a38", border:"none", color:"#888", borderRadius:9, padding:"0 10px", cursor:"pointer", fontSize:14, minHeight:44 }}>✕</button>
                </div>
              </div>
            )}
            {searchErr && <div style={{ color:"#f87171", fontSize:12, marginBottom:8 }}>{searchErr}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {results.map(r => {
                const slugs = (r.platforms||[]).map(p=>p.platform.slug).filter(s=>MAJOR_SLUGS.includes(s));
                const sel = resultPlatforms[r.id] || slugs[0];
                return (
                  <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, background:"#1a1a24", borderRadius:10, padding:"8px 10px", border:"1px solid #252535" }}>
                    <div style={{ width:52, height:52, flexShrink:0, borderRadius:6, overflow:"hidden", background:"#111" }}>
                      {r.background_image
                        ? <img src={r.background_image} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt="" />
                        : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:20 }}>🎮</div>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:"#e2e2e8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginBottom:2 }}>{r.name}</div>
                      <div style={{ fontSize:10, color:"#555", marginBottom:5 }}>
                        {r.genres?.slice(0,2).map(g=>gZh(g.name)).join("・")}
                        {r.released && <span> · {r.released.slice(0,4)}</span>}
                      </div>
                      {slugs.length > 0 && (
                        <div style={{ display:"flex", gap:3 }}>
                          {slugs.map(s => (
                            <button key={s} onClick={() => setResultPlatforms(prev=>({...prev,[r.id]:s}))}
                              style={{ background:sel===s?"#e60012":"#252535", border:"none", color:sel===s?"#fff":"#888",
                                       padding:"2px 8px", borderRadius:10, fontSize:10, cursor:"pointer", fontWeight:sel===s?700:400 }}>
                              {PLAT_SLUG_LABEL[s]||s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => addGame(r, sel)}
                      style={{ background:"#e60012", border:"none", color:"#fff", borderRadius:8, padding:"8px 12px", fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0, minHeight:40 }}>＋</button>
                  </div>
                );
              })}
            </div>
            {results.length > 0 && <div style={{ marginTop:8, fontSize:11, color:"#444", textAlign:"center" }}>封面資料：IGDB / RAWG</div>}
          </>)}

          {addTab === "manual" && (<>
            {/* 封面上傳 */}
            <div style={{ marginBottom:12 }}>
              <div style={S.fieldLabel}>封面圖片</div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <div style={{ width:70, height:98, borderRadius:8, overflow:"hidden", background:"#1a1a24", border:"1px solid #252535", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {manualCover
                    ? <img src={manualCover} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt="" />
                    : <span style={{ fontSize:28, color:"#333" }}>🎮</span>}
                </div>
                <div style={{ flex:1 }}>
                  <button onClick={() => imgRef.current?.click()}
                    style={{ background:"#1a1a24", border:"1px solid #252535", color:"#aaa", padding:"8px 14px", borderRadius:8, fontSize:13, cursor:"pointer", display:"block", marginBottom:6, width:"100%", touchAction:"manipulation" }}>
                    📁 從相簿選取
                  </button>
                  {manualCover && (
                    <button onClick={() => setManualCover(null)}
                      style={{ background:"transparent", border:"1px solid #3a1a1a", color:"#f87171", padding:"6px 14px", borderRadius:8, fontSize:12, cursor:"pointer", width:"100%" }}>
                      移除圖片
                    </button>
                  )}
                </div>
              </div>
              <input ref={imgRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleCoverUpload} />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={S.fieldLabel}>遊戲名稱 *</div>
              <input style={S.input} placeholder="輸入遊戲名稱" value={manualForm.name}
                onChange={e => setManualForm(f=>({...f, name:e.target.value}))} />
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              <div style={{ flex:1 }}>
                <div style={S.fieldLabel}>發行年份</div>
                <input style={S.input} placeholder="2024-01-01" value={manualForm.released}
                  onChange={e => setManualForm(f=>({...f, released:e.target.value}))} />
              </div>
              <div style={{ flex:1 }}>
                <div style={S.fieldLabel}>類別（逗號分隔）</div>
                <input style={S.input} placeholder="動作, 冒險" value={manualForm.genres}
                  onChange={e => setManualForm(f=>({...f, genres:e.target.value}))} />
              </div>
            </div>
            <button style={manualForm.name.trim() ? S.redBtn : S.disabledBtn}
              disabled={!manualForm.name.trim()} onClick={addManualGame}>
              ＋ 加入收藏
            </button>
          </>)}
        </Modal>
      )}


      {/* 遊戲詳情 */}
      {modal === "gameDetail" && selGame && (() => {
        const ab   = getActiveBorrow(selGame.id);
        const od   = ab && isOverdue(ab);
        const hist = borrows.filter(b => b.gameId === selGame.id);
        const g    = games.find(x => x.id === selGame.id) || selGame;
        const gameSlugs = (g.platforms || []).filter(s => MAJOR_SLUGS.includes(s));
        return (
          <Modal title="遊戲資訊" onClose={() => setModal(null)}>
            {/* 封面 - 較小，橫式 */}
            {g.cover && (
              <div style={{ display:"flex", gap:12, marginBottom:12, alignItems:"flex-start" }}>
                <img src={g.cover} style={{ height:100, objectFit:"contain", borderRadius:6, flexShrink:0 }} alt="" />
                <div style={{ flex:1, minWidth:0, paddingTop:4 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#e2e2e8", lineHeight:1.4, marginBottom:4 }}>{g.name}</div>
                  {g.genres?.length > 0 && (
                    <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:4 }}>
                      {g.genres.map(gn => <span key={gn} style={{ background:"#1e1e2e", color:"#888", fontSize:10, padding:"2px 7px", borderRadius:8 }}>{gZh(gn)}</span>)}
                    </div>
                  )}
                  {g.released && <div style={{ fontSize:10, color:"#555" }}>{g.released}</div>}
                </div>
              </div>
            )}

            {/* ── 編輯區（全部塞在一個緊湊盒子）── */}
            <div style={{ background:"#1a1a24", borderRadius:10, padding:"10px 12px", marginBottom:10, display:"flex", flexDirection:"column", gap:8 }}>

              {/* 名稱 */}
              <div>
                <div style={S.fieldLabel}>遊戲名稱</div>
                <input style={{ ...S.input, padding:"8px 10px", fontSize:14 }} value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {/* 版本 - 獨立一列 */}
              <div>
                <div style={S.fieldLabel}>版本</div>
                <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                  {(gameSlugs.length > 0 ? gameSlugs : MAJOR_SLUGS).map(s => {
                    const pc = {"nintendo-switch":"#e60012","playstation5":"#003791","playstation4":"#003791","xbox-series-x":"#107c10","xbox-series-s":"#107c10","xbox-one":"#107c10","pc":"#1b6ac9"}[s]||"#444";
                    const sel = editForm.ownedPlatform === s;
                    return (
                      <button key={s} onClick={() => setEditForm(f => ({ ...f, ownedPlatform: f.ownedPlatform===s?"":s }))}
                        style={{ background: sel?pc:"#252535", border:`1px solid ${sel?pc:"#333"}`,
                                 color: sel?"#fff":"#666", padding:"4px 12px", borderRadius:12,
                                 fontSize:12, cursor:"pointer", fontWeight:sel?700:400, touchAction:"manipulation" }}>
                        {PLAT_SLUG_LABEL[s]||s}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 編號 + 好玩度 同一排 */}
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ flex:1 }}>
                  <div style={S.fieldLabel}>編號</div>
                  <input type="number" style={{ ...S.input, padding:"7px 8px", fontSize:15 }}
                    placeholder="—" value={editForm.number}
                    onChange={e => setEditForm(f => ({ ...f, number: e.target.value }))} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={S.fieldLabel}>好玩度 1–10</div>
                  <input type="number" min="1" max="10" style={{ ...S.input, padding:"7px 8px", fontSize:15 }}
                    placeholder="—" value={editForm.funRating}
                    onChange={e => setEditForm(f => ({ ...f, funRating: e.target.value }))} />
                </div>
              </div>

              {/* 三個按鈕同一列 */}
              <div style={{ display:"flex", gap:6 }}>
                <button style={{ flex:2, background:"#e60012", border:"none", color:"#fff", padding:"9px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", touchAction:"manipulation" }}
                  disabled={saving} onClick={() => saveGameEdit(g.id)}>
                  {saving ? "…" : "💾 儲存"}
                </button>
                {!ab && isAdmin && (
                  <button style={{ flex:2, background:"#1a2a1a", border:"1px solid #2a4a2a", color:"#4ade80", padding:"9px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", touchAction:"manipulation" }}
                    onClick={() => { setBorrowForm({ name:"", borrowDate:today(), expectedReturn:"" }); setModal("borrow"); }}>
                    📤 借出
                  </button>
                )}
                {!ab && isAdmin && (
                  <button style={{ flex:1, background:"transparent", border:"1px solid #3a1a1a", color:"#f87171", padding:"9px", borderRadius:10, fontSize:13, cursor:"pointer", touchAction:"manipulation" }}
                    onClick={() => deleteGame(g.id)}>
                    🗑
                  </button>
                )}
              </div>
            </div>

            {/* 借出狀態 */}
            {ab && (
              <div style={{ ...od ? S.overdueBox : S.borrowedBox, padding:10, marginBottom:8 }}>
                <div style={{ fontWeight:700, marginBottom:6, fontSize:13, color: od?"#f87171":"#fbbf24" }}>{od?"⚠️ 逾期未還":"📤 借出中"}</div>
                <Row label="借用人" val={ab.borrowerName} />
                <Row label="借出" val={ab.borrowDate} />
                <Row label="預計歸還" val={ab.expectedReturn} highlight={od} />
                {od && <div style={{ color:"#f87171", fontSize:11, marginTop:3 }}>逾期 {daysDiff(ab.expectedReturn)} 天</div>}
                {isAdmin && <button style={{ ...S.greenBtn, padding:"9px", fontSize:13, minHeight:40, marginTop:8 }}
                  onClick={() => { setSelBorrow(ab); setModal("return"); }}>✓ 確認歸還</button>}
              </div>
            )}

            {/* 借出紀錄 */}
            {hist.length > 0 && (
              <div style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                  <div style={S.fieldLabel}>借出紀錄（共 {hist.length} 筆）</div>
                  {hist.length > 1 && (
                    <button onClick={() => setShowAllHist(v=>!v)}
                      style={{ fontSize:11, color:"#888", background:"transparent", border:"none", cursor:"pointer", padding:0 }}>
                      {showAllHist ? "收起 ▲" : `查看全部 ▼`}
                    </button>
                  )}
                </div>
                {(showAllHist ? hist : [hist[0]]).map(h => (
                  <div key={h.id} style={{ display:"flex", alignItems:"center", gap:8, background:"#1a1a24", borderRadius:7, padding:"6px 10px", marginBottom:3 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <span style={{ color:"#ccc", fontSize:12, fontWeight:600 }}>{h.borrowerName}</span>
                      <span style={{ color:"#555", fontSize:11, marginLeft:8 }}>{h.borrowDate}</span>
                    </div>
                    <span style={{ fontSize:11, color: h.returnedAt?"#4ade80":"#fbbf24", flexShrink:0 }}>
                      {h.returnedAt ? `已還 ${h.returnedAt.split("T")[0]}` : "借出中"}
                    </span>
                    {isAdmin && showAllHist && (
                      <button onClick={() => deleteBorrow(h.id)}
                        style={{ background:"transparent", border:"none", color:"#555", fontSize:14, cursor:"pointer", padding:"0 2px", flexShrink:0 }}>
                        🗑
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Modal>
        );
      })()}

      {modal === "borrow" && selGame && (
        <Modal title="登記借出" onClose={() => setModal("gameDetail")}>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#1a1a24", borderRadius:8, padding:10, marginBottom:14 }}>
            {selGame.cover && <img src={selGame.cover} style={{ width:64, height:40, objectFit:"cover", borderRadius:5 }} alt="" />}
            <span style={{ fontSize:13, fontWeight:600 }}>{selGame.name}</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={S.fieldLabel}>借用人姓名 *</div>
            <input style={S.input} placeholder="輸入姓名" value={borrowForm.name} onChange={e => setBorrowForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={S.fieldLabel}>借出日期</div>
            <input type="date" style={S.input} value={borrowForm.borrowDate} onChange={e => setBorrowForm(f => ({ ...f, borrowDate: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={S.fieldLabel}>預計歸還日期 *</div>
            <input type="date" style={S.input} value={borrowForm.expectedReturn} onChange={e => setBorrowForm(f => ({ ...f, expectedReturn: e.target.value }))} />
          </div>
          <button style={borrowForm.name && borrowForm.expectedReturn ? S.redBtn : S.disabledBtn}
            disabled={!borrowForm.name || !borrowForm.expectedReturn} onClick={submitBorrow}>確認借出</button>
        </Modal>
      )}

      {modal === "return" && selBorrow && (
        <Modal title="確認歸還" onClose={() => setModal(null)}>
          <div style={{ background:"#1a1a24", borderRadius:12, padding:14, marginBottom:12 }}>
            <Row label="遊戲" val={getGame(selBorrow.gameId)?.name} />
            <Row label="借用人" val={selBorrow.borrowerName} />
            <Row label="借出日期" val={selBorrow.borrowDate} />
            <Row label="預計歸還" val={selBorrow.expectedReturn} highlight={isOverdue(selBorrow)} />
            {isOverdue(selBorrow) && <div style={{ color:"#f87171", fontSize:12, marginTop:4 }}>逾期 {daysDiff(selBorrow.expectedReturn)} 天</div>}
          </div>
          <button style={S.greenBtn} onClick={submitReturn}>✓ 確認已歸還</button>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="設定" onClose={() => setModal(null)}>
          <div style={S.fieldLabel}>Claude API Key（存本機，不上傳伺服器）</div>
          <input style={{ ...S.input, fontFamily:"monospace", fontSize:14, marginBottom:8 }}
            placeholder="sk-ant-..." value={settingsForm.claudeKey}
            onChange={e => setSettingsForm(f => ({ ...f, claudeKey: e.target.value }))} />
          <div style={{ background:"#1a1a24", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#555", marginBottom:20 }}>
            💡 設定後可使用中文搜尋、拍照辨識功能
          </div>
          <div style={{ background:"#0a1a0a", border:"1px solid #1a3a1a", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
            <div style={{ fontSize:12, color:"#4ade80", fontWeight:700, marginBottom:6 }}>🎨 IGDB 封面庫（直式高品質封面）</div>
            <div style={{ fontSize:11, color:"#555", lineHeight:1.6 }}>
              在 Railway → Variables 新增：<br/>
              <code style={{ color:"#888" }}>IGDB_CLIENT_ID</code> 和 <code style={{ color:"#888" }}>IGDB_CLIENT_SECRET</code><br/>
              申請：<span style={{ color:"#4ade80" }}>dev.twitch.tv</span> → 建立 App → 取得 Client ID + Secret
            </div>
          </div>
          <button style={S.redBtn} onClick={() => { localStorage.setItem("svClaudeKey", settingsForm.claudeKey); setModal(null); }}>儲存設定</button>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function GameCard({ game, borrow, overdue, onClick, cols }) {
  const micro = cols >= 12;
  const small = cols >= 8;
  const ownedLabel = game.ownedPlatform ? (PLAT_SLUG_LABEL[game.ownedPlatform] || null) : null;
  const platColor = {
    "nintendo-switch":"#e60012","playstation5":"#003791","playstation4":"#003791",
    "xbox-series-x":"#107c10","xbox-series-s":"#107c10","xbox-one":"#107c10","pc":"#1b6ac9",
  }[game.ownedPlatform] || "#2e2e42";

  return (
    <div onClick={onClick} style={{
      cursor:"pointer", WebkitTapHighlightColor:"transparent",
      background:"#12121a", border:`1px solid ${platColor}55`,
      borderRadius: micro?6:9, overflow:"hidden",
      display:"flex", flexDirection:"column",
      boxShadow:"0 2px 10px rgba(0,0,0,0.6)",
    }}>
      {/* 頂部色條 */}
      <div style={{ height: micro?2:3, background:platColor, flexShrink:0 }} />

      {/* 封面 */}
      <div style={{ position:"relative", width:"100%", paddingBottom:"140%", background:"#0a0a12", flexShrink:0 }}>
        {game.cover
          ? <img src={game.cover} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} alt={game.name} />
          : <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:micro?14:22, color:"#2a2a3a" }}>🎮</div>
        }
        {/* 左上：編號 - 正方形藍底 */}
        {game.number != null && game.number !== "" && (
          <div style={{
            position:"absolute", top:micro?2:4, left:micro?2:4, zIndex:2,
            background:"#1d4ed8", border:"1.5px solid rgba(255,255,255,0.85)",
            color:"#fff",
            minWidth: micro?16:22, height: micro?16:22,
            display:"flex", alignItems:"center", justifyContent:"center",
            padding: micro?"0 3px":"0 5px",
            borderRadius:micro?3:4,
            fontFamily:"monospace", fontWeight:900,
            fontSize:micro?8:10, letterSpacing:0, lineHeight:1,
          }}>{game.number}</div>
        )}
        {/* 右上：好玩度 - 透明金框 */}
        {game.funRating != null && (
          <div style={{
            position:"absolute", top:micro?2:4, right:micro?2:4, zIndex:2,
            background:"rgba(0,0,0,0.38)", border:"1px solid rgba(251,191,36,0.6)",
            color:"#fbbf24",
            minWidth: micro?16:22, height: micro?16:22,
            display:"flex", alignItems:"center", justifyContent:"center",
            padding: micro?"0 2px":"0 4px",
            borderRadius:micro?3:4,
            fontWeight:900, fontSize:micro?8:10, lineHeight:1,
          }}>★{game.funRating}</div>
        )}
        {/* 借出/逾期 */}
        {borrow && (
          <div style={{
            position:"absolute",
            top: micro ? (game.funRating!=null?20:2) : (game.funRating!=null?30:4),
            right:micro?2:4, zIndex:2,
            background:overdue?"#e60012":"#c47d00", color:"#fff",
            fontSize:micro?7:9, padding:micro?"1px 3px":"2px 5px",
            borderRadius:3, fontWeight:700, lineHeight:1.3,
          }}>{overdue?"逾期":"借出"}</div>
        )}
      </div>

      {/* 資訊區 - 比例縮放 */}
      {!micro && (
        <div style={{ background:"#0e0e1a", borderTop:`1px solid ${platColor}44`, padding: small?"3px 5px":"5px 8px", flexShrink:0 }}>
          {/* 遊戲名 */}
          <div style={{
            fontSize: small?8:medium?10:12, fontWeight:700, color:"#ddd", lineHeight:1.3,
            overflow:"hidden", display:"-webkit-box",
            WebkitLineClamp: small?1:2, WebkitBoxOrient:"vertical",
            marginBottom: small?1:2,
          }}>{game.name}</div>
          {/* 平台 */}
          <span style={{ fontSize: small?7:9, color:platColor, fontWeight:700 }}>
            {ownedLabel || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

function BorrowRow({ borrow, game, isAdmin, overdue, onReturn }) {
  const od = overdue || isOverdue(borrow);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, background: od?"#140000":"#14141d", border:`1px solid ${od?"#3a0000":"#1e1e28"}`, borderRadius:10, padding:10, marginBottom:8 }}>
      {game?.cover
        ? <img src={game.cover} style={{ width:58, height:36, objectFit:"cover", borderRadius:5, flexShrink:0 }} alt="" />
        : <div style={{ width:58, height:36, background:"#1e1e2e", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>🎮</div>
      }
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"#e2e2e8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{game?.name || "未知遊戲"}</div>
        <div style={{ fontSize:11, color:"#888", marginTop:1 }}>📋 {borrow.borrowerName}</div>
        <div style={{ fontSize:11, color: od?"#f87171":"#666", marginTop:1 }}>還：{borrow.expectedReturn}{od?` （逾期 ${daysDiff(borrow.expectedReturn)} 天）`:""}</div>
      </div>
      {isAdmin && <button style={{ background:"#16a34a", border:"none", color:"#fff", padding:"6px 12px", borderRadius:8, fontSize:12, cursor:"pointer", flexShrink:0, fontWeight:600, minHeight:40, touchAction:"manipulation" }} onClick={onReturn}>歸還</button>}
    </div>
  );
}

function NavItem({ label, emoji, active, onClick, alert }) {
  return (
    <button style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"10px 0", background:"none", border:"none", cursor:"pointer", color: active?"#e60012":"#555", position:"relative", touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }} onClick={onClick}>
      <span style={{ fontSize:22 }}>{emoji}</span>
      {alert && <span style={{ position:"absolute", top:8, left:"60%", width:8, height:8, background:"#e60012", borderRadius:"50%", display:"block" }} />}
      <span style={{ fontSize:11, marginTop:2, fontWeight: active?700:400 }}>{label}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"16px" }}>
      <div style={{ background:"#111116", borderRadius:16, width:"100%", maxWidth:520, maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,0.8)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"13px 16px", borderBottom:"1px solid #1e1e28", flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:16, color:"#e2e2e8" }}>{title}</span>
          <button style={{ background:"#1e1e28", border:"none", color:"#888", width:30, height:30, borderRadius:"50%", cursor:"pointer", fontSize:14 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY:"auto", padding:"14px 16px", flex:1, WebkitOverflowScrolling:"touch" }}>{children}</div>
      </div>
    </div>
  );
}

function Row({ label, val, highlight }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
      <span style={{ fontSize:12, color:"#666" }}>{label}</span>
      <span style={{ fontSize:13, color: highlight?"#f87171":"#ccc" }}>{val}</span>
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign:"center", padding:"50px 20px 80px", color:"#444" }}>
      <div style={{ fontSize:44, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:13 }}>{text}</div>
    </div>
  );
}

const S = {
  app: { display:"flex", flexDirection:"column", height:"100vh", height:"100dvh", background:"#0c0c0f", color:"#e2e2e8", fontFamily:"-apple-system, 'Segoe UI', system-ui, sans-serif", overflow:"hidden" },
  header: { background:"#111116", borderBottom:"1px solid #1e1e28", padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  iconBtn: { background:"transparent", border:"none", color:"#666", fontSize:22, cursor:"pointer", padding:"4px 7px", minHeight:42, minWidth:42, touchAction:"manipulation" },
  main: { flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" },
  filterBtn: { background:"#1a1a24", border:"1px solid #252535", color:"#777", padding:"6px 14px", borderRadius:18, fontSize:13, cursor:"pointer", whiteSpace:"nowrap", minHeight:36, touchAction:"manipulation", flexShrink:0 },
  filterActive: { background:"#e60012", border:"1px solid #e60012", color:"#fff", padding:"6px 14px", borderRadius:18, fontSize:13, cursor:"pointer", fontWeight:700, whiteSpace:"nowrap", minHeight:36, touchAction:"manipulation", flexShrink:0 },
  addBtn: { background:"#e60012", border:"none", color:"#fff", padding:"6px 16px", borderRadius:18, fontSize:14, cursor:"pointer", fontWeight:700, minHeight:36, touchAction:"manipulation" },
  sortSelect: { background:"#1a1a24", border:"1px solid #2a2a38", color:"#888", borderRadius:8, padding:"5px 8px", fontSize:13, cursor:"pointer", outline:"none", flexShrink:0, minHeight:36 },
  sectionTitle: { fontSize:13, color:"#666", marginBottom:12, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 },
  nav: { background:"#111116", borderTop:"1px solid #1e1e28", display:"flex", flexShrink:0, paddingBottom:"env(safe-area-inset-bottom, 0)" },
  input: { width:"100%", background:"#1a1a24", border:"1px solid #2a2a38", borderRadius:10, padding:"12px 14px", color:"#e2e2e8", fontSize:16, boxSizing:"border-box", outline:"none", appearance:"none" },
  searchBtn: { background:"#e60012", border:"none", color:"#fff", padding:"0 18px", borderRadius:10, cursor:"pointer", fontWeight:700, flexShrink:0, fontSize:15, minHeight:46, touchAction:"manipulation" },
  resultCard: { background:"#1a1a24", borderRadius:12, overflow:"hidden", border:"1px solid #2a2a38" },
  borrowedBox: { background:"#1f1a00", border:"1px solid #4a3800", borderRadius:10, padding:14, marginBottom:12 },
  overdueBox: { background:"#1f0000", border:"1px solid #5a0000", borderRadius:10, padding:14, marginBottom:12 },
  overdueAlert: { background:"#1f0000", border:"1px solid #4a0000", borderRadius:9, padding:"11px 14px", fontSize:14, color:"#f87171", marginBottom:12 },
  redBtn: { display:"block", width:"100%", background:"#e60012", border:"none", color:"#fff", padding:"14px", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", textAlign:"center", boxSizing:"border-box", touchAction:"manipulation", minHeight:50 },
  greenBtn: { display:"block", width:"100%", background:"#16a34a", border:"none", color:"#fff", padding:"14px", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", textAlign:"center", marginTop:12, boxSizing:"border-box", touchAction:"manipulation", minHeight:50 },
  deleteBtn: { display:"block", width:"100%", background:"transparent", border:"1px solid #3a1a1a", color:"#f87171", padding:"12px", borderRadius:12, fontSize:14, cursor:"pointer", textAlign:"center", marginTop:12, boxSizing:"border-box", touchAction:"manipulation" },
  disabledBtn: { display:"block", width:"100%", background:"#1e1e28", border:"none", color:"#444", padding:"14px", borderRadius:12, fontSize:16, cursor:"not-allowed", textAlign:"center", boxSizing:"border-box", minHeight:50 },
  fieldLabel: { fontSize:11, color:"#666", marginBottom:5, textTransform:"uppercase", letterSpacing:0.5 },
};
