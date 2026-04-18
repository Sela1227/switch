import { useState, useEffect } from "react";

// ── API helpers ───────────────────────────────────────────────────────────
async function api(path, { method = "GET", body, pin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (pin) headers["x-admin-pin"] = pin;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function searchRAWG(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("search failed");
  return (await res.json()).results || [];
}

const today = () => new Date().toISOString().split("T")[0];
function isOverdue(b) { return !b.returnedAt && new Date(b.expectedReturn) < new Date(); }
function daysDiff(d) { return Math.floor((new Date() - new Date(d)) / 86400000); }

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState("collection");
  const [games, setGames]       = useState([]);
  const [borrows, setBorrows]   = useState([]);
  const [rawgKey, setRawgKey]   = useState("");
  // [AUTH-DISABLED] 測試階段：預設全員為管理員，PIN 系統保留但不啟動
  const [isAdmin, setIsAdmin]   = useState(true);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  const [modal, setModal]       = useState(null);
  const [selGame, setSelGame]   = useState(null);
  const [selBorrow, setSelBorrow] = useState(null);

  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  const [borrowForm, setBorrowForm] = useState({ name: "", borrowDate: today(), expectedReturn: "" });
  const [pinInput, setPinInput] = useState("");
  const [pinErr, setPinErr]     = useState(false);
  const [collFilter, setCollFilter] = useState("all");

  // Stored PIN in sessionStorage (stays for the browser session)
  const [adminPin, setAdminPin] = useState(() => sessionStorage.getItem("svPin") || "");

  // ── Load ──────────────────────────────────────────────────────────────
  async function loadAll() {
    setLoading(true); setError("");
    try {
      const [g, b, cfg] = await Promise.all([
        api("/api/games"), api("/api/borrows"), api("/api/config")
      ]);
      setGames(g); setBorrows(b); setRawgKey(cfg.rawgApiKey || "");
    } catch { setError("無法連線到伺服器，請稍後再試"); }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  // ── Computed ──────────────────────────────────────────────────────────
  const activeBorrows  = borrows.filter(b => !b.returnedAt);
  const overdueBorrows = activeBorrows.filter(isOverdue);
  const getGame        = id => games.find(g => g.id === id);
  const getActiveBorrow = gameId => activeBorrows.find(b => b.gameId === gameId);
  const filteredGames  = games.filter(g => {
    if (collFilter === "available") return !getActiveBorrow(g.id);
    if (collFilter === "borrowed")  return !!getActiveBorrow(g.id);
    return true;
  });

  // ── Actions ───────────────────────────────────────────────────────────
  async function doSearch() {
    if (!query.trim()) return;
    setSearching(true); setResults([]); setSearchErr("");
    try { setResults(await searchRAWG(query)); }
    catch { setSearchErr("搜尋失敗，請確認網路連線"); }
    setSearching(false);
  }

  async function addGame(r) {
    try {
      await api("/api/games", { method: "POST", pin: adminPin, body: {
        id: String(r.id), name: r.name, cover: r.background_image,
        genres: r.genres?.map(x => x.name) || [], rating: r.rating
      }});
      await loadAll();
    } catch { alert("新增失敗，請確認管理員 PIN 碼"); }
    closeAddGame();
  }

  function closeAddGame() { setModal(null); setQuery(""); setResults([]); setSearchErr(""); }

  async function submitBorrow() {
    if (!selGame || !borrowForm.name || !borrowForm.expectedReturn) return;
    try {
      await api("/api/borrows", { method: "POST", pin: adminPin, body: {
        id: Date.now().toString(), game_id: selGame.id,
        borrower_name: borrowForm.name,
        borrow_date: borrowForm.borrowDate,
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
      await api(`/api/borrows/${selBorrow.id}/return`, { method: "PATCH", pin: adminPin });
      await loadAll();
      setModal(null);
    } catch { alert("歸還失敗"); }
  }

  async function deleteGame(id) {
    try {
      await api(`/api/games/${id}`, { method: "DELETE", pin: adminPin });
      await loadAll();
      setModal(null);
    } catch { alert("刪除失敗"); }
  }

  function tryLogin() {
    // We test the PIN by making a real request
    api("/api/games", { method: "POST", pin: pinInput, body: { id: "_test_", name: "_test_" } })
      .then(() => {
        // succeeded (game might already exist, that's fine)
        api("/api/games/_test_", { method: "DELETE", pin: pinInput }).catch(() => {});
        setIsAdmin(true); setAdminPin(pinInput);
        sessionStorage.setItem("svPin", pinInput);
        setPinInput(""); setPinErr(false); setModal(null);
      })
      .catch(() => { setPinErr(true); setPinInput(""); });
  }

  // ── Render ────────────────────────────────────────────────────────────
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

  return (
    <div style={S.app}>
      {/* Header */}
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🎮</span>
          <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: 2, color: "#fff", textTransform: "uppercase" }}>SWITCH VAULT</span>
          <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace", marginLeft: 6 }}>V1.0.4</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* [AUTH-DISABLED] 測試階段隱藏管理員登入按鈕
          {!isAdmin ? (
            <button style={S.adminBtn} onClick={() => { setPinErr(false); setPinInput(""); setModal("adminLogin"); }}>管理員</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "#4ade80", fontSize: 11, fontFamily: "monospace" }}>● ADMIN</span>
              <button style={S.logoutBtn} onClick={() => { setIsAdmin(false); setAdminPin(""); sessionStorage.removeItem("svPin"); }}>登出</button>
            </div>
          )}
          */}
          <button style={S.iconBtn} onClick={loadAll} title="重新整理">↻</button>
        </div>
      </header>

      {/* Main */}
      <main style={S.main}>
        {tab === "collection" && (
          <div>
            <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {["all","available","borrowed"].map(f => (
                  <button key={f} style={f === collFilter ? S.filterActive : S.filterBtn} onClick={() => setCollFilter(f)}>
                    {f === "all" ? "全部" : f === "available" ? "可借" : "借出中"}
                  </button>
                ))}
              </div>
              {isAdmin && <button style={S.addBtn} onClick={() => setModal("addGame")}>＋ 新增</button>}
            </div>
            <div style={{ padding: "6px 16px 10px", fontSize: 11, color: "#555" }}>共 {filteredGames.length} 款</div>
            {filteredGames.length === 0
              ? <Empty icon="🎮" text={isAdmin ? "點擊「新增」加入第一款遊戲" : "這裡還沒有遊戲"} />
              : <div style={S.grid}>
                  {filteredGames.map(g => {
                    const ab = getActiveBorrow(g.id);
                    return <GameCard key={g.id} game={g} borrow={ab} overdue={ab && isOverdue(ab)}
                      onClick={() => { setSelGame(g); setModal("gameDetail"); }} />;
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
              ? <Empty icon="✅" text="沒有逾期！紀錄保持良好 👍" />
              : overdueBorrows.map(b => <BorrowRow key={b.id} borrow={b} game={getGame(b.gameId)} isAdmin={isAdmin} overdue
                  onReturn={() => { setSelBorrow(b); setModal("return"); }} />)
            }
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav style={S.nav}>
        <NavItem label="收藏" emoji="🎮" active={tab === "collection"} onClick={() => setTab("collection")} />
        <NavItem label={`借出${activeBorrows.length ? ` (${activeBorrows.length})` : ""}`} emoji="📤" active={tab === "borrowed"} onClick={() => setTab("borrowed")} />
        <NavItem label={`逾期${overdueBorrows.length ? ` (${overdueBorrows.length})` : ""}`} emoji="⚠️" active={tab === "overdue"} onClick={() => setTab("overdue")} alert={overdueBorrows.length > 0} />
      </nav>

      {/* ── MODALS ── */}
      {modal === "addGame" && (
        <Modal title="新增遊戲" onClose={closeAddGame}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input style={S.input} placeholder="搜尋遊戲名稱..." value={query}
              onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} />
            <button style={S.searchBtn} onClick={doSearch} disabled={searching}>{searching ? "…" : "搜尋"}</button>
          </div>
          {searchErr && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{searchErr}</div>}
          <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map(r => (
              <div key={r.id} style={S.resultRow} onClick={() => addGame(r)}>
                {r.background_image
                  ? <img src={r.background_image} style={{ width: 70, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />
                  : <div style={{ width: 70, height: 44, background: "#222", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>🎮</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd" }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{r.genres?.map(g => g.name).join(" · ")}</div>
                </div>
                <span style={{ color: "#e60012", fontWeight: 900, fontSize: 18, flexShrink: 0 }}>＋</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "#444", textAlign: "center" }}>封面資料：RAWG.io（RAWG_API_KEY 設定於 Railway 環境變數）</div>
        </Modal>
      )}

      {modal === "gameDetail" && selGame && (() => {
        const ab  = getActiveBorrow(selGame.id);
        const od  = ab && isOverdue(ab);
        const hist = borrows.filter(b => b.gameId === selGame.id);
        return (
          <Modal title={selGame.name} onClose={() => setModal(null)}>
            {selGame.cover && <img src={selGame.cover} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 12, marginBottom: 12 }} alt="" />}
            {selGame.genres?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {selGame.genres.map(g => <span key={g} style={{ background: "#1e1e2e", color: "#888", fontSize: 11, padding: "3px 8px", borderRadius: 8 }}>{g}</span>)}
              </div>
            )}
            {ab ? (
              <div style={od ? S.overdueBox : S.borrowedBox}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: od ? "#f87171" : "#fbbf24" }}>{od ? "⚠️ 逾期未還" : "📤 借出中"}</div>
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
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>借出紀錄</div>
                {hist.map(h => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", background: "#1a1a24", borderRadius: 8, padding: "7px 10px", marginBottom: 4 }}>
                    <span style={{ color: "#ccc", fontSize: 13 }}>{h.borrowerName}</span>
                    <span style={{ fontSize: 11, color: h.returnedAt ? "#4ade80" : "#fbbf24" }}>{h.returnedAt ? `已還 ${h.returnedAt.split("T")[0]}` : "借出中"}</span>
                  </div>
                ))}
              </div>
            )}
            {isAdmin && !ab && <button style={S.deleteBtn} onClick={() => deleteGame(selGame.id)}>🗑 移除此遊戲</button>}
          </Modal>
        );
      })()}

      {modal === "borrow" && selGame && (
        <Modal title="登記借出" onClose={() => setModal("gameDetail")}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#1a1a24", borderRadius: 10, padding: 10, marginBottom: 16 }}>
            {selGame.cover && <img src={selGame.cover} style={{ width: 70, height: 44, objectFit: "cover", borderRadius: 6 }} alt="" />}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selGame.name}</span>
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

      {modal === "adminLogin" && (
        <Modal title="管理員登入" onClose={() => setModal(null)}>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>請輸入 Railway 設定的 ADMIN_PIN</p>
          <input type="password" style={{ ...S.input, textAlign: "center", fontSize: 24, letterSpacing: 8 }}
            placeholder="••••" value={pinInput}
            onChange={e => { setPinInput(e.target.value); setPinErr(false); }}
            onKeyDown={e => e.key === "Enter" && tryLogin()} />
          {pinErr && <div style={{ color: "#f87171", fontSize: 12, marginTop: 6 }}>PIN 碼錯誤</div>}
          <button style={{ ...S.redBtn, marginTop: 12 }} onClick={tryLogin}>登入</button>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function GameCard({ game, borrow, overdue, onClick }) {
  return (
    <div style={{ cursor: "pointer" }} onClick={onClick}>
      <div style={{ position: "relative", aspectRatio: "16/10", background: "#1a1a24", borderRadius: 8, overflow: "hidden" }}>
        {game.cover
          ? <img src={game.cover} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt={game.name} />
          : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 28, color: "#333" }}>🎮</div>
        }
        {borrow && (
          <div style={{ position: "absolute", top: 4, right: 4, background: overdue ? "#e60012" : "#d97706", color: "#fff", fontSize: 9, padding: "2px 5px", borderRadius: 4, fontWeight: 700 }}>
            {overdue ? "逾期" : "借出"}
          </div>
        )}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.name}</div>
    </div>
  );
}

function BorrowRow({ borrow, game, isAdmin, overdue, onReturn }) {
  const od = overdue || isOverdue(borrow);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: od ? "#140000" : "#14141d", border: `1px solid ${od ? "#3a0000" : "#1e1e28"}`, borderRadius: 12, padding: 10, marginBottom: 8 }}>
      {game?.cover
        ? <img src={game.cover} style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} alt="" />
        : <div style={{ width: 64, height: 40, background: "#1e1e2e", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>🎮</div>
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e2e8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game?.name || "未知遊戲"}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>📋 {borrow.borrowerName}</div>
        <div style={{ fontSize: 11, color: od ? "#f87171" : "#666", marginTop: 1 }}>還：{borrow.expectedReturn}{od ? ` （逾期 ${daysDiff(borrow.expectedReturn)} 天）` : ""}</div>
      </div>
      {isAdmin && <button style={{ background: "#16a34a", border: "none", color: "#fff", padding: "5px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", flexShrink: 0, fontWeight: 600 }} onClick={onReturn}>歸還</button>}
    </div>
  );
}

function NavItem({ label, emoji, active, onClick, alert }) {
  return (
    <button style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 0", background: "none", border: "none", cursor: "pointer", color: active ? "#e60012" : "#555", position: "relative" }} onClick={onClick}>
      <span style={{ fontSize: 20 }}>{emoji}</span>
      {alert && <span style={{ position: "absolute", top: 6, left: "60%", width: 8, height: 8, background: "#e60012", borderRadius: "50%", display: "block" }} />}
      <span style={{ fontSize: 10, marginTop: 2, fontWeight: active ? 700 : 400 }}>{label}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#111116", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ width: 36, height: 4, background: "#333", borderRadius: 2, margin: "10px auto 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #1e1e28" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button style={{ background: "#1e1e28", border: "none", color: "#888", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 13 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 16, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ label, val, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "#666" }}>{label}</span>
      <span style={{ fontSize: 13, color: highlight ? "#f87171" : "#ccc" }}>{val}</span>
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
      <div style={{ fontSize: 52, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  );
}

const S = {
  app: { display: "flex", flexDirection: "column", height: "100vh", background: "#0c0c0f", color: "#e2e2e8", fontFamily: "'Segoe UI', system-ui, sans-serif", overflow: "hidden" },
  header: { background: "#111116", borderBottom: "1px solid #1e1e28", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
  adminBtn: { background: "#e60012", color: "#fff", border: "none", padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontWeight: 600 },
  logoutBtn: { background: "transparent", border: "1px solid #333", color: "#888", padding: "3px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", color: "#666", fontSize: 20, cursor: "pointer", padding: "0 4px" },
  main: { flex: 1, overflowY: "auto" },
  filterBtn: { background: "#1a1a24", border: "1px solid #222", color: "#666", padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer" },
  filterActive: { background: "#e60012", border: "1px solid #e60012", color: "#fff", padding: "4px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer", fontWeight: 700 },
  addBtn: { background: "#e60012", border: "none", color: "#fff", padding: "5px 14px", borderRadius: 16, fontSize: 13, cursor: "pointer", fontWeight: 700 },
  sectionTitle: { fontSize: 13, color: "#666", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: "0 16px 16px" },
  nav: { background: "#111116", borderTop: "1px solid #1e1e28", display: "flex", flexShrink: 0 },
  input: { width: "100%", background: "#1a1a24", border: "1px solid #2a2a38", borderRadius: 10, padding: "10px 12px", color: "#e2e2e8", fontSize: 14, boxSizing: "border-box", outline: "none" },
  searchBtn: { background: "#e60012", border: "none", color: "#fff", padding: "0 16px", borderRadius: 10, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  resultRow: { display: "flex", alignItems: "center", gap: 10, background: "#1a1a24", borderRadius: 10, padding: 8, cursor: "pointer" },
  borrowedBox: { background: "#1f1a00", border: "1px solid #4a3800", borderRadius: 12, padding: 12, marginBottom: 12 },
  overdueBox: { background: "#1f0000", border: "1px solid #5a0000", borderRadius: 12, padding: 12, marginBottom: 12 },
  overdueAlert: { background: "#1f0000", border: "1px solid #4a0000", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#f87171", marginBottom: 14 },
  redBtn: { display: "block", width: "100%", background: "#e60012", border: "none", color: "#fff", padding: "11px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", boxSizing: "border-box" },
  greenBtn: { display: "block", width: "100%", background: "#16a34a", border: "none", color: "#fff", padding: "11px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", marginTop: 12, boxSizing: "border-box" },
  deleteBtn: { display: "block", width: "100%", background: "transparent", border: "1px solid #3a1a1a", color: "#f87171", padding: "10px", borderRadius: 12, fontSize: 13, cursor: "pointer", textAlign: "center", marginTop: 12, boxSizing: "border-box" },
  disabledBtn: { display: "block", width: "100%", background: "#1e1e28", border: "none", color: "#444", padding: "11px", borderRadius: 12, fontSize: 14, cursor: "not-allowed", textAlign: "center", boxSizing: "border-box" },
};
