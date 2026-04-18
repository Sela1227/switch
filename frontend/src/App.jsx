import { useState, useEffect } from "react";

const VERSION = "V1.3.0";

const PLATFORMS = [
  { id: "all",    label: "全部",   rawg: "all" },
  { id: "switch", label: "Switch", rawg: "7",     slugs: ["nintendo-switch"] },
  { id: "ps",     label: "PS",     rawg: "18,187", slugs: ["playstation4","playstation5"] },
  { id: "xbox",   label: "Xbox",   rawg: "1,186",  slugs: ["xbox-one","xbox-series-x"] },
  { id: "pc",     label: "PC",     rawg: "4",      slugs: ["pc"] },
];

const SORT_OPTIONS = [
  { id: "default",   label: "新增順序" },
  { id: "number",    label: "編號 ↑" },
  { id: "funRating", label: "好玩度 ↓" },
  { id: "released",  label: "發行日期 ↓" },
];

function matchPlatform(game, platId) {
  if (platId === "all") return true;
  if (!game.platforms || game.platforms.length === 0) return true;
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
const GRID_COLS = { large: 2, medium: 3, small: 4 };

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

  const [query, setQuery]         = useState("");
  const [translatedQ, setTranslatedQ] = useState("");
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [searchPlatform, setSearchPlatform] = useState("7");

  const [borrowForm, setBorrowForm] = useState({ name: "", borrowDate: today(), expectedReturn: "" });
  const [collFilter, setCollFilter] = useState("all");
  const [wallPlatform, setWallPlatform] = useState(() => localStorage.getItem("svWallPlat") || "all");
  const [sortBy, setSortBy] = useState(() => localStorage.getItem("svSort") || "default");
  const [gridSize, setGridSize] = useState(() => localStorage.getItem("svGrid") || "small");

  const [settingsForm, setSettingsForm] = useState({ claudeKey: "" });
  const [editForm, setEditForm] = useState({ number: "", funRating: "" });
  const [saving, setSaving]     = useState(false);

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

  const activeBorrows   = borrows.filter(b => !b.returnedAt);
  const overdueBorrows  = activeBorrows.filter(isOverdue);
  const getGame         = id => games.find(g => g.id === id);
  const getActiveBorrow = gid => activeBorrows.find(b => b.gameId === gid);

  const filteredGames = sortGames(
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
    setSearching(true); setResults([]); setSearchErr(""); setTranslatedQ("");
    const plat = PLATFORMS.find(p => p.rawg === searchPlatform)?.rawg || "all";
    try {
      const data = await smartSearch(query, claudeKey(), plat);
      setResults(data.results || []);
      if (data.selected && data.selected !== query) setTranslatedQ(data.selected);
    } catch { setSearchErr("搜尋失敗，請確認網路連線"); }
    setSearching(false);
  }

  async function addGame(r) {
    const platformSlugs = r.platforms?.map(p => p.platform.slug) || [];
    try {
      await api("/api/games", { method: "POST", pin: adminPin(), body: {
        id: String(r.id), name: r.name, cover: r.background_image,
        genres: r.genres?.map(x => x.name) || [], rating: r.rating,
        platforms: platformSlugs, released: r.released || null
      }});
      await loadAll();
    } catch { alert("新增失敗"); }
    closeAddGame();
  }

  function closeAddGame() { setModal(null); setQuery(""); setResults([]); setSearchErr(""); setTranslatedQ(""); }

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

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 20 }}>🎮</span>
          <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: 2, color: "#fff", textTransform: "uppercase" }}>SWITCH VAULT</span>
          <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace" }}>{VERSION}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={S.iconBtn} onClick={loadAll}>↻</button>
          <button style={S.iconBtn} onClick={() => { setSettingsForm({ claudeKey: claudeKey() }); setModal("settings"); }}>⚙</button>
        </div>
      </header>

      <main style={S.main}>
        {tab === "collection" && (
          <div>
            {/* Row 1：收藏篩選 + 格大小 + 新增 */}
            <div style={{ padding: "10px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 5 }}>
                {[["all","全部"],["available","可借"],["borrowed","借出中"]].map(([f,l]) => (
                  <button key={f} style={f===collFilter ? S.filterActive : S.filterBtn} onClick={() => setCollFilter(f)}>{l}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ display: "flex", background: "#1a1a24", borderRadius: 7, overflow: "hidden", border: "1px solid #2a2a38" }}>
                  {[["large","大"],["medium","中"],["small","小"]].map(([s,l]) => (
                    <button key={s} onClick={() => setGrid(s)}
                      style={{ background: gridSize===s?"#e60012":"transparent", border:"none", color: gridSize===s?"#fff":"#666", padding:"3px 8px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                      {l}
                    </button>
                  ))}
                </div>
                {isAdmin && <button style={S.addBtn} onClick={() => setModal("addGame")}>＋</button>}
              </div>
            </div>

            {/* Row 2：平台篩選 + 排序 */}
            <div style={{ padding: "6px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 4, overflowX: "auto", flexShrink: 1 }}>
                {PLATFORMS.map(p => (
                  <button key={p.id} style={wallPlatform===p.id ? S.filterActive : S.filterBtn}
                    onClick={() => setWallPlat(p.id)}>{p.label}</button>
                ))}
              </div>
              <select style={S.sortSelect} value={sortBy} onChange={e => setSort(e.target.value)}>
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "#555" }}>共 {filteredGames.length} 款</div>

            {filteredGames.length === 0
              ? <Empty icon="🎮" text="點擊「＋」加入第一款遊戲" />
              : <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: cols >= 4 ? 8 : 10, padding: "0 16px 16px" }}>
                  {filteredGames.map(g => {
                    const ab = getActiveBorrow(g.id);
                    return <GameCard key={g.id} game={g} borrow={ab} overdue={ab && isOverdue(ab)} cols={cols}
                      onClick={() => { setSelGame(g); setEditForm({ number: g.number ?? "", funRating: g.funRating ?? "" }); setModal("gameDetail"); }} />;
                  })}
                </div>
            }
          </div>
        )}

        {tab === "borrowed" && (
          <div style={{ padding: "12px 16px" }}>
            <div style={S.sectionTitle}>借出中 — {activeBorrows.length} 筆</div>
            {activeBorrows.length === 0
              ? <Empty icon="📤" text="目前沒有借出的遊戲" />
              : activeBorrows.map(b => <BorrowRow key={b.id} borrow={b} game={getGame(b.gameId)} isAdmin={isAdmin}
                  onReturn={() => { setSelBorrow(b); setModal("return"); }} />)
            }
          </div>
        )}

        {tab === "overdue" && (
          <div style={{ padding: "12px 16px" }}>
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

      <nav style={S.nav}>
        <NavItem label="收藏" emoji="🎮" active={tab==="collection"} onClick={() => setTab("collection")} />
        <NavItem label={`借出${activeBorrows.length ? ` (${activeBorrows.length})` : ""}`} emoji="📤" active={tab==="borrowed"} onClick={() => setTab("borrowed")} />
        <NavItem label={`逾期${overdueBorrows.length ? ` (${overdueBorrows.length})` : ""}`} emoji="⚠️" active={tab==="overdue"} onClick={() => setTab("overdue")} alert={overdueBorrows.length > 0} />
      </nav>

      {/* ── MODALS ── */}

      {modal === "addGame" && (
        <Modal title="新增遊戲" onClose={closeAddGame}>
          {/* 平台選擇 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>搜尋平台</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {PLATFORMS.map(p => (
                <button key={p.id} style={searchPlatform===p.rawg ? S.filterActive : S.filterBtn}
                  onClick={() => setSearchPlatform(p.rawg)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={S.input} placeholder="遊戲名稱（中文或英文）" value={query}
              onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button style={S.searchBtn} onClick={doSearch} disabled={searching}>
              {searching ? "…" : "搜尋"}
            </button>
          </div>
          {claudeKey() && <div style={{ fontSize: 11, color: "#4ade80", marginBottom: 5 }}>✓ Claude AI 輔助已啟用</div>}
          {translatedQ && <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>🔍 比對：<span style={{ color: "#e2e2e8" }}>{translatedQ}</span></div>}
          {searchErr && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{searchErr}</div>}
          <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 7 }}>
            {results.map(r => {
              const slugs = r.platforms?.map(p => p.platform.slug) || [];
              const platLabels = PLATFORMS.filter(p => p.id !== "all" && slugs.some(s => p.slugs?.some(ps => s.startsWith(ps) || s === ps))).map(p => p.label);
              return (
                <div key={r.id} style={S.resultRow} onClick={() => addGame(r)}>
                  {r.background_image
                    ? <img src={r.background_image} style={{ width: 70, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />
                    : <div style={{ width: 70, height: 44, background: "#222", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>🎮</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#ddd" }}>{r.name}</div>
                    <div style={{ fontSize: 10, color: "#666", marginTop: 1 }}>{r.genres?.map(g => g.name).join(" · ")}</div>
                    {platLabels.length > 0 && (
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        {platLabels.map(l => <span key={l} style={{ fontSize: 9, background: "#2a2a38", color: "#888", padding: "1px 4px", borderRadius: 3 }}>{l}</span>)}
                      </div>
                    )}
                  </div>
                  <span style={{ color: "#e60012", fontWeight: 900, fontSize: 18, flexShrink: 0 }}>＋</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#444", textAlign: "center" }}>封面資料：RAWG.io</div>
        </Modal>
      )}

      {modal === "gameDetail" && selGame && (() => {
        const ab  = getActiveBorrow(selGame.id);
        const od  = ab && isOverdue(ab);
        const hist = borrows.filter(b => b.gameId === selGame.id);
        const currentGame = games.find(g => g.id === selGame.id) || selGame;
        const platLabels = PLATFORMS.filter(p => p.id !== "all" && (currentGame.platforms||[]).some(s => p.slugs?.some(ps => s.startsWith(ps) || s === ps))).map(p => p.label);
        return (
          <Modal title={currentGame.name} onClose={() => setModal(null)}>
            {currentGame.cover && <img src={currentGame.cover} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 10, marginBottom: 10 }} alt="" />}

            {/* 平台 + 發行日期 */}
            {(platLabels.length > 0 || currentGame.released) && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {platLabels.map(l => <span key={l} style={{ fontSize: 10, background: "#1e1e2e", color: "#888", padding: "2px 7px", borderRadius: 6 }}>{l}</span>)}
                {currentGame.released && <span style={{ fontSize: 10, color: "#555", marginLeft: "auto" }}>{currentGame.released}</span>}
              </div>
            )}

            {/* 編號 & 好玩度 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, background: "#1a1a24", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>編號</div>
                <input type="number" style={{ ...S.input, padding: "6px 8px", fontSize: 13 }}
                  placeholder="—" value={editForm.number}
                  onChange={e => setEditForm(f => ({ ...f, number: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>好玩度 (1–10)</div>
                <input type="number" min="1" max="10" style={{ ...S.input, padding: "6px 8px", fontSize: 13 }}
                  placeholder="—" value={editForm.funRating}
                  onChange={e => setEditForm(f => ({ ...f, funRating: e.target.value }))} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button style={{ background: saving?"#333":"#3b3b50", border:"none", color:"#e2e2e8", padding:"6px 12px", borderRadius:8, fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}
                  disabled={saving} onClick={() => saveGameEdit(currentGame.id)}>
                  {saving ? "…" : "儲存"}
                </button>
              </div>
            </div>

            {currentGame.genres?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                {currentGame.genres.map(g => <span key={g} style={{ background: "#1e1e2e", color: "#888", fontSize: 10, padding: "2px 7px", borderRadius: 7 }}>{g}</span>)}
              </div>
            )}

            {ab ? (
              <div style={od ? S.overdueBox : S.borrowedBox}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: od?"#f87171":"#fbbf24" }}>{od?"⚠️ 逾期未還":"📤 借出中"}</div>
                <Row label="借用人" val={ab.borrowerName} />
                <Row label="借出日期" val={ab.borrowDate} />
                <Row label="預計歸還" val={ab.expectedReturn} highlight={od} />
                {od && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>已逾期 {daysDiff(ab.expectedReturn)} 天</div>}
                {isAdmin && <button style={S.greenBtn} onClick={() => { setSelBorrow(ab); setModal("return"); }}>✓ 確認歸還</button>}
              </div>
            ) : (
              isAdmin && <button style={S.redBtn} onClick={() => { setBorrowForm({ name: "", borrowDate: today(), expectedReturn: "" }); setModal("borrow"); }}>📤 登記借出</button>
            )}

            {hist.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>借出紀錄</div>
                {hist.map(h => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", background: "#1a1a24", borderRadius: 8, padding: "6px 10px", marginBottom: 3 }}>
                    <span style={{ color: "#ccc", fontSize: 13 }}>{h.borrowerName}</span>
                    <span style={{ fontSize: 11, color: h.returnedAt?"#4ade80":"#fbbf24" }}>{h.returnedAt ? `已還 ${h.returnedAt.split("T")[0]}` : "借出中"}</span>
                  </div>
                ))}
              </div>
            )}
            {isAdmin && !ab && <button style={S.deleteBtn} onClick={() => deleteGame(currentGame.id)}>🗑 移除此遊戲</button>}
          </Modal>
        );
      })()}

      {modal === "borrow" && selGame && (
        <Modal title="登記借出" onClose={() => setModal("gameDetail")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1a1a24", borderRadius: 8, padding: 8, marginBottom: 12 }}>
            {selGame.cover && <img src={selGame.cover} style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 5 }} alt="" />}
            <span style={{ fontSize: 12, fontWeight: 600 }}>{selGame.name}</span>
          </div>
          <Field label="借用人姓名 *"><input style={S.input} placeholder="輸入姓名" value={borrowForm.name} onChange={e => setBorrowForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="借出日期"><input type="date" style={S.input} value={borrowForm.borrowDate} onChange={e => setBorrowForm(f => ({ ...f, borrowDate: e.target.value }))} /></Field>
          <Field label="預計歸還日期 *"><input type="date" style={S.input} value={borrowForm.expectedReturn} onChange={e => setBorrowForm(f => ({ ...f, expectedReturn: e.target.value }))} /></Field>
          <button style={borrowForm.name && borrowForm.expectedReturn ? S.redBtn : S.disabledBtn}
            disabled={!borrowForm.name || !borrowForm.expectedReturn} onClick={submitBorrow}>確認借出</button>
        </Modal>
      )}

      {modal === "return" && selBorrow && (
        <Modal title="確認歸還" onClose={() => setModal(null)}>
          <div style={{ background: "#1a1a24", borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <Row label="遊戲" val={getGame(selBorrow.gameId)?.name} />
            <Row label="借用人" val={selBorrow.borrowerName} />
            <Row label="借出日期" val={selBorrow.borrowDate} />
            <Row label="預計歸還" val={selBorrow.expectedReturn} highlight={isOverdue(selBorrow)} />
            {isOverdue(selBorrow) && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>逾期 {daysDiff(selBorrow.expectedReturn)} 天</div>}
          </div>
          <button style={S.greenBtn} onClick={submitReturn}>✓ 確認已歸還</button>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="設定" onClose={() => setModal(null)}>
          <Field label="Claude API Key（存本機，不上傳伺服器）">
            <input style={{ ...S.input, fontFamily: "monospace", fontSize: 11 }}
              placeholder="sk-ant-..." value={settingsForm.claudeKey}
              onChange={e => setSettingsForm(f => ({ ...f, claudeKey: e.target.value }))} />
          </Field>
          <div style={{ background: "#1a1a24", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#555", marginBottom: 14 }}>
            💡 設定後，搜尋時會用 Claude AI 從 RAWG 候選結果中選出最符合的遊戲
          </div>
          <button style={S.redBtn} onClick={() => { localStorage.setItem("svClaudeKey", settingsForm.claudeKey); setModal(null); }}>儲存設定</button>
        </Modal>
      )}
    </div>
  );
}

function GameCard({ game, borrow, overdue, onClick, cols }) {
  const small = cols >= 4;
  const platLabels = PLATFORMS.filter(p => p.id !== "all" && (game.platforms||[]).some(s => p.slugs?.some(ps => s.startsWith(ps) || s === ps))).map(p => p.label);
  return (
    <div style={{ cursor: "pointer" }} onClick={onClick}>
      <div style={{ position: "relative", width: "100%", paddingBottom: "62.5%", background: "#1a1a24", borderRadius: small?6:8, overflow: "hidden" }}>
        {game.cover
          ? <img src={game.cover} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} alt={game.name} />
          : <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: small?18:26, color: "#333" }}>🎮</div>
        }
        {game.number != null && (
          <div style={{ position: "absolute", top: 3, left: 3, background: "rgba(0,0,0,0.7)", color: "#aaa", fontSize: 8, padding: "1px 4px", borderRadius: 3, fontFamily: "monospace" }}>#{game.number}</div>
        )}
        {game.funRating != null && (
          <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,0.7)", color: "#fbbf24", fontSize: 8, padding: "1px 4px", borderRadius: 3 }}>★{game.funRating}</div>
        )}
        {/* 平台 badge（中/大格才顯示）*/}
        {!small && platLabels.length > 0 && (
          <div style={{ position: "absolute", bottom: 3, right: 3, display: "flex", gap: 2 }}>
            {platLabels.slice(0,2).map(l => <span key={l} style={{ fontSize: 8, background: "rgba(0,0,0,0.75)", color: "#ccc", padding: "1px 4px", borderRadius: 3 }}>{l}</span>)}
          </div>
        )}
        {borrow && (
          <div style={{ position: "absolute", top: 3, right: 3, background: overdue?"#e60012":"#d97706", color: "#fff", fontSize: 8, padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>
            {overdue?"逾期":"借出"}
          </div>
        )}
      </div>
      {!small && <div style={{ marginTop: 4, fontSize: 10, color: "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.name}</div>}
    </div>
  );
}

function BorrowRow({ borrow, game, isAdmin, overdue, onReturn }) {
  const od = overdue || isOverdue(borrow);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: od?"#140000":"#14141d", border:`1px solid ${od?"#3a0000":"#1e1e28"}`, borderRadius: 10, padding: 9, marginBottom: 7 }}>
      {game?.cover
        ? <img src={game.cover} style={{ width: 58, height: 36, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} alt="" />
        : <div style={{ width: 58, height: 36, background: "#1e1e2e", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>🎮</div>
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e2e8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game?.name || "未知遊戲"}</div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>📋 {borrow.borrowerName}</div>
        <div style={{ fontSize: 10, color: od?"#f87171":"#666", marginTop: 1 }}>還：{borrow.expectedReturn}{od?` （逾期 ${daysDiff(borrow.expectedReturn)} 天）`:""}</div>
      </div>
      {isAdmin && <button style={{ background:"#16a34a", border:"none", color:"#fff", padding:"4px 8px", borderRadius:6, fontSize:11, cursor:"pointer", flexShrink:0, fontWeight:600 }} onClick={onReturn}>歸還</button>}
    </div>
  );
}

function NavItem({ label, emoji, active, onClick, alert }) {
  return (
    <button style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"8px 0", background:"none", border:"none", cursor:"pointer", color: active?"#e60012":"#555", position:"relative" }} onClick={onClick}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      {alert && <span style={{ position:"absolute", top:6, left:"60%", width:7, height:7, background:"#e60012", borderRadius:"50%", display:"block" }} />}
      <span style={{ fontSize: 10, marginTop: 2, fontWeight: active?700:400 }}>{label}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#111116", borderRadius:"18px 18px 0 0", width:"100%", maxWidth:480, maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ width:32, height:3, background:"#333", borderRadius:2, margin:"8px auto 0" }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderBottom:"1px solid #1e1e28" }}>
          <span style={{ fontWeight:700, fontSize:14 }}>{title}</span>
          <button style={{ background:"#1e1e28", border:"none", color:"#888", width:26, height:26, borderRadius:"50%", cursor:"pointer", fontSize:12 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY:"auto", padding:14, flex:1 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ label, val, highlight }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
      <span style={{ fontSize:11, color:"#666" }}>{label}</span>
      <span style={{ fontSize:12, color: highlight?"#f87171":"#ccc" }}>{val}</span>
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign:"center", padding:"50px 20px", color:"#444" }}>
      <div style={{ fontSize:44, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:13 }}>{text}</div>
    </div>
  );
}

const S = {
  app: { display:"flex", flexDirection:"column", height:"100vh", background:"#0c0c0f", color:"#e2e2e8", fontFamily:"'Segoe UI', system-ui, sans-serif", overflow:"hidden" },
  header: { background:"#111116", borderBottom:"1px solid #1e1e28", padding:"9px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  iconBtn: { background:"transparent", border:"none", color:"#666", fontSize:18, cursor:"pointer", padding:"0 3px" },
  main: { flex:1, overflowY:"auto" },
  filterBtn: { background:"#1a1a24", border:"1px solid #222", color:"#666", padding:"3px 10px", borderRadius:14, fontSize:11, cursor:"pointer", whiteSpace:"nowrap" },
  filterActive: { background:"#e60012", border:"1px solid #e60012", color:"#fff", padding:"3px 10px", borderRadius:14, fontSize:11, cursor:"pointer", fontWeight:700, whiteSpace:"nowrap" },
  addBtn: { background:"#e60012", border:"none", color:"#fff", padding:"4px 12px", borderRadius:14, fontSize:14, cursor:"pointer", fontWeight:900 },
  sortSelect: { background:"#1a1a24", border:"1px solid #2a2a38", color:"#888", borderRadius:8, padding:"3px 6px", fontSize:11, cursor:"pointer", outline:"none", flexShrink:0 },
  sectionTitle: { fontSize:11, color:"#666", marginBottom:10, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 },
  nav: { background:"#111116", borderTop:"1px solid #1e1e28", display:"flex", flexShrink:0 },
  input: { width:"100%", background:"#1a1a24", border:"1px solid #2a2a38", borderRadius:9, padding:"9px 11px", color:"#e2e2e8", fontSize:13, boxSizing:"border-box", outline:"none" },
  searchBtn: { background:"#e60012", border:"none", color:"#fff", padding:"0 14px", borderRadius:9, cursor:"pointer", fontWeight:700, flexShrink:0 },
  resultRow: { display:"flex", alignItems:"center", gap:9, background:"#1a1a24", borderRadius:9, padding:7, cursor:"pointer" },
  borrowedBox: { background:"#1f1a00", border:"1px solid #4a3800", borderRadius:10, padding:10, marginBottom:10 },
  overdueBox: { background:"#1f0000", border:"1px solid #5a0000", borderRadius:10, padding:10, marginBottom:10 },
  overdueAlert: { background:"#1f0000", border:"1px solid #4a0000", borderRadius:9, padding:"9px 12px", fontSize:12, color:"#f87171", marginBottom:12 },
  redBtn: { display:"block", width:"100%", background:"#e60012", border:"none", color:"#fff", padding:"10px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", textAlign:"center", boxSizing:"border-box" },
  greenBtn: { display:"block", width:"100%", background:"#16a34a", border:"none", color:"#fff", padding:"10px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", textAlign:"center", marginTop:10, boxSizing:"border-box" },
  deleteBtn: { display:"block", width:"100%", background:"transparent", border:"1px solid #3a1a1a", color:"#f87171", padding:"9px", borderRadius:10, fontSize:12, cursor:"pointer", textAlign:"center", marginTop:10, boxSizing:"border-box" },
  disabledBtn: { display:"block", width:"100%", background:"#1e1e28", border:"none", color:"#444", padding:"10px", borderRadius:10, fontSize:13, cursor:"not-allowed", textAlign:"center", boxSizing:"border-box" },
};
