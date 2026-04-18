import { useState, useEffect, useRef } from "react";

const VERSION = "V1.9.1";

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
  if (!game.platforms || !game.platforms.length) return true;
  const p = PLATFORMS.find(x => x.id === platId);
  if (!p) return true;
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🎮</span>
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: 2, color: "#fff", textTransform: "uppercase" }}>SWITCH VAULT</span>
          <span style={{ fontSize: 11, color: "#444", fontFamily: "monospace" }}>{VERSION}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={S.iconBtn} onClick={loadAll}>↻</button>
          <button style={S.iconBtn} onClick={() => { setSettingsForm({ claudeKey: claudeKey() }); setModal("settings"); }}>⚙</button>
        </div>
      </header>

      {/* Main */}
      <main style={S.main}>
        {tab === "collection" && (
          <div>
            {/* Row 1：篩選 + 格大小 + 新增 */}
            <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1 }}>
                {[["all","全部"],["available","可借"],["borrowed","借出中"]].map(([f,l]) => (
                  <button key={f} style={f===collFilter ? S.filterActive : S.filterBtn} onClick={() => setCollFilter(f)}>{l}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{ display: "flex", background: "#1a1a24", borderRadius: 8, overflow: "hidden", border: "1px solid #2a2a38" }}>
                  {[["large","大"],["medium","中"],["small","小"],["mini","微"]].map(([s,l]) => (
                    <button key={s} onClick={() => setGrid(s)}
                      style={{ background: gridSize===s?"#e60012":"transparent", border:"none", color: gridSize===s?"#fff":"#666", padding:"6px 11px", fontSize:13, cursor:"pointer", fontFamily:"inherit", minHeight:34 }}>
                      {l}
                    </button>
                  ))}
                </div>
                {isAdmin && <button style={S.addBtn} onClick={() => setModal("addGame")}>＋ 新增</button>}
              </div>
            </div>

            {/* Row 2：平台 + 排序 */}
            <div style={{ padding: "8px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 5, overflowX: "auto", flex: 1 }}>
                {PLATFORMS.map(p => (
                  <button key={p.id} style={wallPlatform===p.id ? S.filterActive : S.filterBtn}
                    onClick={() => setWallPlat(p.id)}>{p.label}</button>
                ))}
              </div>
              <select style={S.sortSelect} value={sortBy} onChange={e => setSort(e.target.value)}>
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            <div style={{ padding: "5px 16px 10px", fontSize: 12, color: "#555" }}>共 {filteredGames.length} 款</div>

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
          {/* 搜尋平台 */}
          <div style={{ marginBottom: 12 }}>
            <div style={S.fieldLabel}>搜尋平台</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PLATFORMS.map(p => (
                <button key={p.id} style={searchPlatform===p.rawg ? S.filterActive : S.filterBtn}
                  onClick={() => setSearchPlatform(p.rawg)}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* 搜尋框 + 拍照 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={S.input} placeholder="遊戲名稱（中文或英文）" value={query}
              onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
            {claudeKey() && (
              <button style={{ ...S.searchBtn, background: "#2a2a38", fontSize: 18, padding: "0 12px" }}
                onClick={() => cameraRef.current?.click()} disabled={identifying} title="拍照辨識">
                {identifying ? "⏳" : "📷"}
              </button>
            )}
            <button style={S.searchBtn} onClick={doSearch} disabled={searching || identifying}>
              {searching ? "…" : "搜尋"}
            </button>
          </div>
          {/* 隱藏的 camera input */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
            style={{ display: "none" }} onChange={handleCamera} />
          {identifying && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textAlign: "center" }}>
              📷 AI 辨識中，請稍候...
            </div>
          )}

          {/* 翻譯結果 */}
          {claudeKey() && <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 4 }}>✓ Claude AI 輔助已啟用</div>}
          {translatedQ && !showManualQ && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, background: "#1a1a24", borderRadius: 8, padding: "6px 10px" }}>
              <span style={{ fontSize: 11, color: "#666" }}>🔍</span>
              <span style={{ fontSize: 11, color: "#e2e2e8", flex: 1 }}>{translatedQ}</span>
              <button onClick={() => { setManualQ(translatedQ); setShowManualQ(true); }}
                style={{ fontSize: 10, color: "#f87171", background: "transparent", border: "1px solid #3a1a1a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap", minHeight: 26 }}>
                不對？修改
              </button>
            </div>
          )}
          {showManualQ && (
            <div style={{ marginBottom: 10, background: "#1a1a24", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "#f87171", marginBottom: 6 }}>手動輸入正確的英文遊戲名稱：</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...S.input, flex: 1 }} value={manualQ}
                  onChange={e => setManualQ(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doDirectSearch(manualQ)} />
                <button style={S.searchBtn} onClick={() => doDirectSearch(manualQ)}>搜</button>
                <button onClick={() => setShowManualQ(false)}
                  style={{ background: "#2a2a38", border: "none", color: "#888", borderRadius: 9, padding: "0 10px", cursor: "pointer", fontSize: 14, minHeight: 44 }}>✕</button>
              </div>
            </div>
          )}

          {searchErr && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{searchErr}</div>}

          {/* 搜尋結果：卡片式 */}
          <div style={{ maxHeight: "52vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map(r => {
              const slugs = (r.platforms || []).map(p => p.platform.slug).filter(s => MAJOR_SLUGS.includes(s));
              const sel = resultPlatforms[r.id] || slugs[0];
              const selLabel = PLAT_SLUG_LABEL[sel] || sel;
              return (
                <div key={r.id} style={S.resultCard}>
                  <div style={{ display: "flex" }}>
                    {/* 封面 2:3（盒裝封面） */}
                    <div style={{ width: 88, flexShrink: 0, background: "#111", borderRadius: "10px 0 0 10px", overflow: "hidden", display: "flex", alignItems: "stretch" }}>
                      {r.background_image
                        ? <img src={r.background_image} style={{ width: "100%", objectFit: "cover", display: "block" }} alt="" />
                        : <div style={{ width: "100%", minHeight: 124, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#333" }}>🎮</div>
                      }
                    </div>
                    {/* 資訊 */}
                    <div style={{ flex: 1, padding: "10px 12px", minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#e2e2e8", marginBottom: 3, lineHeight: 1.3 }}>{r.name}</div>
                      <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>
                        {r.genres?.slice(0,2).map(g => g.name).join(" · ")}
                        {r.released && <span style={{ color: "#555" }}> · {r.released?.slice(0,4)}</span>}
                      </div>
                      {/* 版本選擇 */}
                      {slugs.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8, flex: 1 }}>
                          {slugs.map(s => (
                            <button key={s}
                              style={{ background: sel===s?"#e60012":"#2a2a38", border: "none", color: sel===s?"#fff":"#aaa",
                                       padding: "3px 9px", borderRadius: 12, fontSize: 11, cursor: "pointer",
                                       fontWeight: sel===s?700:400, minHeight: 26, touchAction: "manipulation" }}
                              onClick={() => setResultPlatforms(prev => ({...prev, [r.id]: s}))}>
                              {PLAT_SLUG_LABEL[s] || s}
                            </button>
                          ))}
                        </div>
                      )}
                      <button style={{ ...S.redBtn, fontSize: 12, padding: "8px", minHeight: 36 }}
                        onClick={() => addGame(r, sel)}>
                        ＋ 加入{sel ? ` (${selLabel})` : ""}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#444", textAlign: "center" }}>封面資料：IGDB / RAWG</div>
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
            {/* 封面 */}
            {g.cover && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <img src={g.cover} style={{ height: 160, objectFit: "contain", borderRadius: 8 }} alt="" />
              </div>
            )}

            {/* ── 可編輯資訊區 ── */}
            <div style={{ background: "#1a1a24", borderRadius: 12, padding: "12px 14px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>

              {/* 名稱 */}
              <div>
                <div style={S.fieldLabel}>遊戲名稱</div>
                <input style={{ ...S.input, fontSize: 14 }} value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {/* 我的平台版本 */}
              <div>
                <div style={S.fieldLabel}>我的版本</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {(gameSlugs.length > 0 ? gameSlugs : MAJOR_SLUGS).map(s => (
                    <button key={s}
                      style={{ background: editForm.ownedPlatform===s?"#e60012":"#2a2a38", border:"none",
                               color: editForm.ownedPlatform===s?"#fff":"#888",
                               padding:"5px 12px", borderRadius:16, fontSize:12, cursor:"pointer",
                               fontWeight: editForm.ownedPlatform===s?700:400, minHeight:32, touchAction:"manipulation" }}
                      onClick={() => setEditForm(f => ({ ...f, ownedPlatform: f.ownedPlatform===s ? "" : s }))}>
                      {PLAT_SLUG_LABEL[s] || s}
                    </button>
                  ))}
                </div>
              </div>

              {/* 編號 + 好玩度 */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={S.fieldLabel}>編號</div>
                  <input type="number" style={{ ...S.input, padding:"7px 8px", fontSize:16 }}
                    placeholder="—" value={editForm.number}
                    onChange={e => setEditForm(f => ({ ...f, number: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={S.fieldLabel}>好玩度 (1–10)</div>
                  <input type="number" min="1" max="10" style={{ ...S.input, padding:"7px 8px", fontSize:16 }}
                    placeholder="—" value={editForm.funRating}
                    onChange={e => setEditForm(f => ({ ...f, funRating: e.target.value }))} />
                </div>
              </div>

              {/* 類別（中文，從資料來） */}
              {g.genres?.length > 0 && (
                <div>
                  <div style={S.fieldLabel}>類別</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {g.genres.map(gn => (
                      <span key={gn} style={{ background: "#222230", color: "#aaa", fontSize: 11, padding: "4px 10px", borderRadius: 12 }}>
                        {gZh(gn)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 發行日期 */}
              {g.released && (
                <div style={{ fontSize: 11, color: "#555" }}>發行：{g.released}</div>
              )}

              {/* 儲存 */}
              <button style={S.redBtn} disabled={saving} onClick={() => saveGameEdit(g.id)}>
                {saving ? "儲存中…" : "💾 儲存"}
              </button>
            </div>

            {/* 借出狀態 */}
            {ab ? (
              <div style={od ? S.overdueBox : S.borrowedBox}>
                <div style={{ fontWeight:700, marginBottom:8, color: od?"#f87171":"#fbbf24" }}>{od?"⚠️ 逾期未還":"📤 借出中"}</div>
                <Row label="借用人" val={ab.borrowerName} />
                <Row label="借出日期" val={ab.borrowDate} />
                <Row label="預計歸還" val={ab.expectedReturn} highlight={od} />
                {od && <div style={{ color:"#f87171", fontSize:12, marginTop:4 }}>已逾期 {daysDiff(ab.expectedReturn)} 天</div>}
                {isAdmin && <button style={S.greenBtn} onClick={() => { setSelBorrow(ab); setModal("return"); }}>✓ 確認歸還</button>}
              </div>
            ) : (
              isAdmin && <button style={S.redBtn} onClick={() => { setBorrowForm({ name:"", borrowDate:today(), expectedReturn:"" }); setModal("borrow"); }}>📤 登記借出</button>
            )}

            {/* 借出紀錄 */}
            {hist.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...S.fieldLabel, marginBottom: 6 }}>借出紀錄</div>
                {hist.map(h => (
                  <div key={h.id} style={{ display:"flex", justifyContent:"space-between", background:"#1a1a24", borderRadius:8, padding:"6px 10px", marginBottom:3 }}>
                    <span style={{ color:"#ccc", fontSize:13 }}>{h.borrowerName}</span>
                    <span style={{ fontSize:11, color: h.returnedAt?"#4ade80":"#fbbf24" }}>{h.returnedAt ? `已還 ${h.returnedAt.split("T")[0]}` : "借出中"}</span>
                  </div>
                ))}
              </div>
            )}
            {isAdmin && !ab && <button style={S.deleteBtn} onClick={() => deleteGame(g.id)}>🗑 移除此遊戲</button>}
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
  const medium = cols >= 6;
  const ownedLabel = game.ownedPlatform ? (PLAT_SLUG_LABEL[game.ownedPlatform] || null) : null;
  return (
    <div onClick={onClick}
      style={{ cursor:"pointer", WebkitTapHighlightColor:"transparent",
               background:"#15151e", border:"1px solid #2a2a3a", borderRadius: micro?6:8, overflow:"hidden",
               display:"flex", flexDirection:"column" }}>
      {/* 封面 2:3 */}
      <div style={{ position:"relative", width:"100%", paddingBottom:"150%", background:"#1a1a28", flexShrink:0 }}>
        {game.cover
          ? <img src={game.cover} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} alt={game.name} />
          : <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize: micro?14:small?16:22, color:"#333" }}>🎮</div>
        }
        {game.number != null && (
          <div style={{ position:"absolute", top:3, left:3, background:"rgba(0,0,0,0.8)", color:"#ccc", fontSize: micro?7:9, padding:"1px 4px", borderRadius:3, fontFamily:"monospace", fontWeight:700 }}>#{game.number}</div>
        )}
        {borrow && (
          <div style={{ position:"absolute", top:3, right:3, background: overdue?"#e60012":"#d97706", color:"#fff", fontSize: micro?7:9, padding:"1px 5px", borderRadius:3, fontWeight:700 }}>
            {overdue ? "逾期" : "借出"}
          </div>
        )}
      </div>

      {/* 卡片下方資訊 */}
      {!micro && (
        <div style={{ padding: small ? "4px 5px" : medium ? "5px 7px" : "7px 9px", flex:1, display:"flex", flexDirection:"column", gap:2 }}>
          <div style={{ fontSize: small?9:medium?10:12, fontWeight:600, color:"#ddd", lineHeight:1.3,
                        overflow:"hidden", display:"-webkit-box", WebkitLineClamp: small?1:2, WebkitBoxOrient:"vertical" }}>
            {game.name}
          </div>
          {!small && game.genres?.[0] && (
            <div style={{ fontSize: medium?9:10, color:"#666" }}>{gZh(game.genres[0])}</div>
          )}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:1 }}>
            {ownedLabel
              ? <span style={{ fontSize: small?7:9, background:"#e60012", color:"#fff", padding:"1px 4px", borderRadius:3, fontWeight:700 }}>{ownedLabel}</span>
              : <span />
            }
            {game.funRating != null && (
              <span style={{ fontSize: small?7:9, color:"#fbbf24", fontWeight:700 }}>★{game.funRating}</span>
            )}
          </div>
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
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#111116", borderRadius:"20px 20px 0 0", width:"100%", maxWidth:520, maxHeight:"90vh", overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ width:36, height:4, background:"#2a2a38", borderRadius:2, margin:"10px auto 0" }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 16px", borderBottom:"1px solid #1e1e28", flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:15, color:"#e2e2e8" }}>{title}</span>
          <button style={{ background:"#1e1e28", border:"none", color:"#888", width:32, height:32, borderRadius:"50%", cursor:"pointer", fontSize:14, touchAction:"manipulation" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY:"auto", padding:"14px 14px", flex:1, WebkitOverflowScrolling:"touch" }}>{children}</div>
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
