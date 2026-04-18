import { useState, useEffect, useRef } from "react";

const VERSION = "V1.13.20";

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
const SELA_LOGO = "data:image/png;base64,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";

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

const GRID_COLS_MOBILE  = { large: 2, medium: 4, small: 6 };
const GRID_COLS_DESKTOP = { large: 6, medium: 9, small: 12 };

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]         = useState("collection");
  const [games, setGames]     = useState([]);
  const [borrows, setBorrows] = useState([]);
  const [publicUsers, setPublicUsers]   = useState([]);
  const [exploreUser, setExploreUser]   = useState(null); // 正在看的用戶
  const [exploreGames, setExploreGames] = useState([]);
  const [borrowRequests, setBorrowRequests] = useState([]);
  const [reqModal, setReqModal]   = useState(null); // 申請借用的遊戲
  const [reqForm, setReqForm]     = useState({ message:"", expectedReturn:"" });
  const [isAdmin]             = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [modal, setModal]         = useState(null);
  const [selGame, setSelGame]     = useState(null);
  const [selBorrow, setSelBorrow] = useState(null);

  const [query, setQuery]             = useState("");
  const [translatedQ, setTranslatedQ] = useState("");
  const [results, setResults]         = useState([]);
  const [catalogResults, setCatalogResults] = useState([]);
  const [gamerResult, setGamerResult] = useState(null);
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
  const [gridSize, setGridSize] = useState(() => localStorage.getItem("svGrid") || "medium");

  const [settingsForm, setSettingsForm] = useState({ claudeKey:"", userName:"我的收藏", isPublic:1 });
  const [editForm, setEditForm]   = useState({ number:"", funRating:"", name:"", ownedPlatform:"" });
  const [saving, setSaving]       = useState(false);
  const [showAllHist, setShowAllHist] = useState(false);
  const [addTab, setAddTab]       = useState("search");
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [coverSearchQ, setCoverSearchQ]       = useState("");
  const [coverResults, setCoverResults]       = useState([]);
  const [coverSearching, setCoverSearching]   = useState(false);
  const coverImgRef = useRef(null);
  const [manualForm, setManualForm] = useState({ name:"", released:"", genres:"" });
  const [manualCover, setManualCover] = useState(null);
  const imgRef = useRef(null);

  const claudeKey  = () => localStorage.getItem("svClaudeKey") || "";
  const adminPin   = () => sessionStorage.getItem("svPin") || "";
  const myUserId   = () => localStorage.getItem("svUserId") || "default";

  async function loadAll() {
    setLoading(true); setError("");
    try {
      const uid = myUserId();
      const [g, b, users, reqs] = await Promise.all([
        api(`/api/games?user_id=${uid}`),
        api(`/api/borrows?user_id=${uid}`),
        api("/api/users"),
        api(`/api/borrow-requests?user_id=${uid}`).catch(() => []),
      ]);
      setGames(g); setBorrows(b);
      setPublicUsers(users.filter(u => u.id !== uid));
      setBorrowRequests(reqs);
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
    setSearching(true); setResults([]); setCatalogResults([]); setGamerResult(null); setSearchErr(""); setTranslatedQ(""); setShowManualQ(false);
    // 直接搜巴哈（中文輸入最直接）
    try {
      const platParam = searchPlatform && searchPlatform !== 'all' ? `&platform=${PLATFORMS.find(p=>p.rawg===searchPlatform)?.id||'all'}` : '';
      const res = await fetch(`/api/gamer-search?q=${encodeURIComponent(query)}${platParam}`);
      const data = await res.json();
      setResults(data.results || []);
      if (!data.results?.length) setSearchErr("巴哈商城找不到，試試其他關鍵字");
    } catch { setSearchErr("搜尋失敗，請確認網路連線"); }
    // 同時查共用目錄
    try {
      const catRes = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&user_id=${myUserId()}`);
      setCatalogResults(await catRes.json() || []);
    } catch {}
    setSearching(false);
  }

  async function doDirectSearch(customQ) {
    if (!customQ.trim()) return;
    setSearching(true); setResults([]); setCatalogResults([]); setGamerResult(null); setSearchErr(""); setShowManualQ(false);
    try {
      const res = await fetch(`/api/gamer-search?q=${encodeURIComponent(customQ)}`);
      const data = await res.json();
      setResults(data.results || []);
      if (!data.results?.length) setSearchErr("找不到結果");
    } catch { setSearchErr("搜尋失敗"); }
    try {
      const catRes = await fetch(`/api/catalog?q=${encodeURIComponent(customQ)}&user_id=${myUserId()}`);
      setCatalogResults(await catRes.json() || []);
    } catch {}
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

  async function translateGameName(englishName) {
    if (!englishName) return { name: englishName, cover: null };

    // Step 1：即時搜尋巴哈商城（最準，有封面）
    try {
      const res = await fetch(`/api/gamer-search?q=${encodeURIComponent(englishName)}`);
      const data = await res.json();
      if (data.zh_name && data.zh_name.length > 1) {
        return { name: data.zh_name, cover: data.cover_url || null };
      }
    } catch {}

    // Step 2：查本地巴哈名稱庫（爬蟲存的，速度快）
    try {
      const res = await fetch(`/api/gamer-name?q=${encodeURIComponent(englishName)}`);
      const data = await res.json();
      if (data.zh_name && data.zh_name.length > 1) {
        return { name: data.zh_name, cover: data.cover_url || null };
      }
    } catch {}

    // Step 3：Claude 查任天堂台灣官方名
    const ck = claudeKey();
    if (ck) {
      try {
        const res = await fetch(`/api/nintendo-name?q=${encodeURIComponent(englishName)}`, {
          headers: { "x-claude-key": ck }
        });
        const data = await res.json();
        if (data.name && data.name !== englishName) {
          return { name: data.name, cover: null };
        }
      } catch {}

      // Step 4：Claude 通用翻譯
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ck, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 60,
            system: (
              "你是遊戲名稱翻譯助理，熟悉台灣/香港玩家最常用的繁體中文遊戲名稱。\n" +
              "規則：\n" +
              "1. 輸入英文遊戲名，回傳台灣玩家最常見的繁體中文名稱\n" +
              "2. 若有官方中文名稱，優先使用官方名稱\n" +
              "3. 若沒有廣泛使用的中文名，直接回傳原始英文名\n" +
              "4. 只回傳遊戲名稱，不加任何說明\n" +
              "範例：\n" +
              "- The Legend of Zelda Tears of the Kingdom → 薩爾達傳說 王國之淚\n" +
              "- Super Mario Bros. Wonder → 超級瑪利歐兄弟 驚奇\n" +
              "- Pikmin 4 → 皮克敏4\n" +
              "- Hades II → Hades II"
            ),
            messages: [{ role: "user", content: englishName }]
          })
        });
        const data = await res.json();
        const translated = data.content?.[0]?.text?.trim();
        if (translated) return { name: translated, cover: null };
      } catch {}
    }

    return { name: englishName, cover: null };
  }

  function cleanGameName(name) {
    if (!name) return name;
    // 優先取《》內文字
    const m = name.match(/[《〈](.*?)[》〉]/);
    if (m) return m[1].trim();
    // 去掉 [ 平台 ] 前綴
    name = name.replace(/^\[.*?\]\s*/, '');
    // 去掉購物資訊
    name = name.replace(/\s+(NS2?|PS[1-5]?|XBOX)\s+.*/i, '');
    name = name.replace(/\s+紅利\d+.*/g, '');
    name = name.replace(/\s+NT\$.*/g, '');
    name = name.replace(/\s+前往購買.*/g, '');
    name = name.replace(/\s*（[^）]{1,30}）\s*$/, '');
    return name.trim();
  }

  async function addGameFromGamer(r) {
    const name = cleanGameName(r.zh_name);
    const id = `gamer_${r.gamer_sn || Date.now()}`;
    const ownedPlat = PLAT_DEFAULT_SLUG[searchPlatform] || "nintendo-switch";
    try {
      await api("/api/games", { method:"POST", pin:adminPin(), body:{
        id, name, cover: r.cover_url || null,
        genres: [], platforms: [], released: null,
        owned_platform: ownedPlat, user_id: myUserId(), base_game_id: id
      }});
      await loadAll();
    } catch { alert("新增失敗"); }
    closeAddGame();
  }

  async function addGame(r, ownedPlatform) {
    const platformSlugs = (r.platforms || []).map(p => p.platform.slug);
    const { name: rawName, cover: gamerCover } = await translateGameName(r.name);
    const finalName = cleanGameName(rawName);
    const finalCover = gamerCover || r.background_image || null;
    try {
      await api("/api/games", { method: "POST", pin: adminPin(), body: {
        id: String(r.id), name: finalName, cover: finalCover,
        genres: r.genres?.map(x => x.name) || [], rating: r.rating,
        platforms: platformSlugs, released: r.released || null,
        owned_platform: ownedPlatform || null, user_id: myUserId(),
        base_game_id: String(r.id)
      }});
      await loadAll();
    } catch { alert("新增失敗"); }
    closeAddGame();
  }

  async function loadUserGames(user) {
    setExploreUser(user);
    setExploreGames([]);
    try {
      const data = await api(`/api/users/${user.id}/games`);
      setExploreGames(data);
    } catch {}
  }

  async function submitBorrowRequest() {
    if (!reqModal || !reqForm.expectedReturn) return;
    const myName = localStorage.getItem("svUserName") || "匿名玩家";
    try {
      await api("/api/borrow-requests", { method:"POST", body: {
        id: Date.now().toString(),
        game_id: reqModal.id,
        owner_user_id: reqModal.userId,
        requester_user_id: myUserId(),
        requester_name: myName,
        message: reqForm.message,
        expected_return: reqForm.expectedReturn,
      }});
      setReqModal(null); setReqForm({ message:"", expectedReturn:"" });
      alert("申請已送出！");
    } catch { alert("申請失敗"); }
  }

  async function respondBorrowRequest(reqId, status) {
    try {
      await fetch(`/api/borrow-requests/${reqId}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ status })
      });
      await loadAll();
    } catch { alert("操作失敗"); }
  }

  async function importFromCatalog(item, ownedPlatform) {
    if (item.iOwnIt) {
      if (!window.confirm(`你已有《${item.name}》，還要再加一份嗎？\n（適合擁有多張同款遊戲的情況）`)) return;
    }
    try {
      const { name: rawName, cover: gamerCover } = await translateGameName(item.name);
      const finalName = cleanGameName(rawName);
      const finalCover = gamerCover || item.cover || null;
      const newId = `${item.id}_${myUserId()}_${Date.now()}`;
      await api("/api/games", { method:"POST", pin:adminPin(), body:{
        id: newId, name: finalName, cover: finalCover,
        genres: item.genres || [], platforms: item.platforms || [],
        released: item.released || null, owned_platform: ownedPlatform || null,
        user_id: myUserId(), base_game_id: item.id
      }});
      await loadAll();
    } catch { alert("導入失敗"); }
    closeAddGame();
  }

  function closeAddGame() {
    setModal(null); setQuery(""); setResults([]); setCatalogResults([]); setGamerResult(null); setSearchErr("");
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

  const [communityCovers, setCommunityCovers] = useState([]);
  const [coverTab, setCoverTab] = useState("search"); // "search" | "community" | "url"
  const [coverUrlInput, setCoverUrlInput] = useState("");

  async function updateCover(gameId, coverUrl, shareToComm = false) {
    try {
      await api(`/api/games/${gameId}`, { method:"PATCH", pin:adminPin(), body:{ cover: coverUrl } });
      // 分享到社群封面庫
      if (shareToComm && selGame) {
        const baseId = selGame.baseGameId || selGame.id;
        await api("/api/game-covers", { method:"POST", pin:adminPin(), body:{
          base_game_id: baseId,
          cover_url: coverUrl,
          contributed_by: myUserId(),
          source: "upload"
        }});
      }
      await loadAll();
      setShowCoverPicker(false); setCoverSearchQ(""); setCoverResults([]); setCommunityCovers([]);
    } catch { alert("更新封面失敗"); }
  }

  async function loadCommunityCovers(game) {
    const baseId = game.baseGameId || game.id;
    try {
      const res = await fetch(`/api/game-covers/${encodeURIComponent(baseId)}`);
      setCommunityCovers(await res.json());
    } catch { setCommunityCovers([]); }
  }

  async function doCoverSearch(q) {
    if (!q.trim()) return;
    setCoverSearching(true); setCoverResults([]);
    const plat = selGame ? (() => {
      const p = PLATFORMS.find(p => p.slugs?.some(s => selGame.ownedPlatform?.startsWith(s)));
      return p?.rawg || "all";
    })() : "all";
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&platform=${plat}`);
      const data = await res.json();
      setCoverResults(data.results || []);
    } catch {}
    setCoverSearching(false);
  }

  async function handleCoverImgUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !selGame) return;
    e.target.value = "";
    const base64 = await new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 400;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * ratio; canvas.height = img.height * ratio;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = url;
    });
    // 詢問是否分享到社群
    const share = window.confirm("要將這張封面分享到社群庫嗎？\n其他人也可以使用你上傳的封面！");
    await updateCover(selGame.id, base64, share);
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
        platforms:[], owned_platform: null, user_id: myUserId()
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

  const isMobile = window.innerWidth < 768;
  const GRID_COLS = isMobile ? GRID_COLS_MOBILE : GRID_COLS_DESKTOP;
  const cols = GRID_COLS[gridSize] || 4;
  const isCompact = cols >= 6;

  return (
    <div style={S.app}>
      {/* Header */}
      <header style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, overflow:"hidden" }}>
          <img src={SELA_LOGO} style={{ width:32, height:32, borderRadius:6, flexShrink:0 }} alt="SELA" />
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:900, fontSize:13, color:"#fff", whiteSpace:"nowrap", lineHeight:1.2 }}>SELA 遊戲管理</div>
            <div style={{ fontSize:10, color:"#aaa", whiteSpace:"nowrap", lineHeight:1.2 }}>租借系統 <span style={{ color:"#f97316", fontFamily:"monospace", fontWeight:700 }}>{VERSION}</span></div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:3, flexShrink:0 }}>
          {/* 格大小 */}
          <div style={{ display:"flex", background:"#1a1a24", borderRadius:6, overflow:"hidden", border:"1px solid #2a2a38" }}>
            {[["large","大"],["medium","中"],["small","小"]].map(([s,l]) => (
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
          <button style={S.iconBtn} onClick={async () => {
            const ck = claudeKey();
            const uname = localStorage.getItem("svUserName") || "我的收藏";
            let isPub = 1;
            try { const u = await api(`/api/users/${myUserId()}`); isPub = u.isPublic; } catch {}
            setSettingsForm({ claudeKey: ck, userName: uname, isPublic: isPub });
            setModal("settings");
          }}>⚙</button>
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

        {tab === "explore" && (
          <div style={{ padding:"12px 14px 80px" }}>
            {/* 待回覆申請 */}
            {borrowRequests.filter(r=>r.ownerUserId===myUserId()&&r.status==="pending").length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={S.sectionTitle}>📬 待確認借用申請</div>
                {borrowRequests.filter(r=>r.ownerUserId===myUserId()&&r.status==="pending").map(req => (
                  <div key={req.id} style={{ background:"#1a1a24", border:"1px solid #2a2a38", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      {req.gameCover && <img src={req.gameCover} style={{ width:40, height:56, objectFit:"cover", borderRadius:5 }} alt="" />}
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:"#e2e2e8" }}>{req.gameName}</div>
                        <div style={{ fontSize:11, color:"#888" }}>{req.requesterName} 想借到 {req.expectedReturn}</div>
                        {req.message && <div style={{ fontSize:11, color:"#666", fontStyle:"italic" }}>"{req.message}"</div>}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={() => respondBorrowRequest(req.id,"approved")}
                        style={{ flex:1, background:"#16a34a", border:"none", color:"#fff", padding:"7px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer" }}>✓ 同意</button>
                      <button onClick={() => respondBorrowRequest(req.id,"rejected")}
                        style={{ flex:1, background:"#1a1a24", border:"1px solid #3a1a1a", color:"#f87171", padding:"7px", borderRadius:8, fontSize:12, cursor:"pointer" }}>✗ 拒絕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* 我送出的申請 */}
            {borrowRequests.filter(r=>r.requesterUserId===myUserId()).length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={S.sectionTitle}>📤 我的申請</div>
                {borrowRequests.filter(r=>r.requesterUserId===myUserId()).map(req => (
                  <div key={req.id} style={{ display:"flex", alignItems:"center", gap:8, background:"#1a1a24", borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
                    {req.gameCover && <img src={req.gameCover} style={{ width:32, height:44, objectFit:"cover", borderRadius:4 }} alt="" />}
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:"#ddd" }}>{req.gameName}</div>
                      <div style={{ fontSize:10, color:"#666" }}>還至 {req.expectedReturn}</div>
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color: req.status==="approved"?"#4ade80":req.status==="rejected"?"#f87171":"#fbbf24" }}>
                      {req.status==="approved"?"已同意":req.status==="rejected"?"已拒絕":"待回覆"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* 公開用戶列表 */}
            <div style={S.sectionTitle}>🌐 公開收藏 — {publicUsers.length} 位玩家</div>
            {publicUsers.length === 0
              ? <Empty icon="🌐" text="目前沒有其他公開用戶" />
              : exploreUser
                ? (<>
                    <button onClick={() => { setExploreUser(null); setExploreGames([]); }}
                      style={{ background:"#1a1a24", border:"1px solid #2a2a38", color:"#aaa", padding:"6px 12px", borderRadius:8, fontSize:12, cursor:"pointer", marginBottom:12 }}>
                      ← 返回列表
                    </button>
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:"#e2e2e8" }}>{exploreUser.name} 的收藏</div>
                      <div style={{ fontSize:11, color:"#555" }}>共 {exploreGames.length} 款</div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                      {exploreGames.map(g => (
                        <div key={g.id} style={{ background:"#15151e", border:"1px solid #2a2a38", borderRadius:8, overflow:"hidden", cursor:"pointer" }}
                          onClick={() => setReqModal({...g, userId: exploreUser.id})}>
                          <div style={{ position:"relative", paddingBottom:"150%", background:"#0a0a12" }}>
                            {g.cover
                              ? <img src={g.cover} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }} alt="" />
                              : <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:20 }}>🎮</div>
                            }
                          </div>
                          <div style={{ padding:"4px 6px", background:"#0e0e1a", borderTop:"1px solid #1e1e28" }}>
                            <div style={{ fontSize:9, color:"#ccc", fontWeight:600, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{g.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>)
                : publicUsers.map(u => (
                    <div key={u.id} style={{ display:"flex", alignItems:"center", gap:10, background:"#1a1a24", border:"1px solid #2a2a38", borderRadius:10, padding:"10px 12px", marginBottom:8, cursor:"pointer" }}
                      onClick={() => loadUserGames(u)}>
                      <div style={{ width:40, height:40, borderRadius:"50%", background:"#e60012", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                        {u.avatar ? <img src={u.avatar} style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }} alt="" /> : "🎮"}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"#e2e2e8" }}>{u.name}</div>
                        <div style={{ fontSize:11, color:"#555" }}>點擊查看收藏</div>
                      </div>
                      <span style={{ color:"#555", fontSize:18 }}>›</span>
                    </div>
                  ))
            }
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav style={S.nav}>
        <NavItem label="收藏" emoji="🎮" active={tab==="collection"} onClick={() => setTab("collection")} />
        <NavItem label={`借出${activeBorrows.length ? ` (${activeBorrows.length})` : ""}`} emoji="📤" active={tab==="borrowed"} onClick={() => setTab("borrowed")} />
        <NavItem label={`逾期${overdueBorrows.length ? ` (${overdueBorrows.length})` : ""}`} emoji="⚠️" active={tab==="overdue"} onClick={() => setTab("overdue")} alert={overdueBorrows.length > 0} />
        <NavItem label={`探索${publicUsers.length ? ` (${publicUsers.length})` : ""}`} emoji="🌐" active={tab==="explore"} onClick={() => setTab("explore")} />
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

            {/* ── 巴哈商城（最優先，有中文名＋封面）── */}
            {gamerResult && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:10, color:"#f97316", fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>
                  🏪 巴哈商城
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, background:"#1a1000", borderRadius:10, padding:"8px 10px", border:"1px solid #3a2000" }}>
                  <div style={{ width:44, height:62, flexShrink:0, borderRadius:5, overflow:"hidden", background:"#111" }}>
                    {gamerResult.cover_url
                      ? <img src={gamerResult.cover_url} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="" />
                      : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:20 }}>🎮</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:13, color:"#e2e2e8", marginBottom:2 }}>{cleanGameName(gamerResult.zh_name)}</div>
                    <div style={{ fontSize:10, color:"#f97316" }}>巴哈商城官方中文名稱</div>
                  </div>
                  <button onClick={async () => {
                    const slugs = (results[0]?.platforms||[]).map(p=>p.platform.slug) || [];
                    const sel = resultPlatforms[results[0]?.id] || slugs[0] || "";
                    const base = results[0];
                    if (base) {
                      await api("/api/games", { method:"POST", pin:adminPin(), body:{
                        id: String(base.id), name: cleanGameName(gamerResult.zh_name),
                        cover: gamerResult.cover_url || base.background_image,
                        genres: base.genres?.map(x=>x.name)||[], rating: base.rating,
                        platforms: slugs, released: base.released||null,
                        owned_platform: sel||null, user_id: myUserId(), base_game_id: String(base.id)
                      }});
                      await loadAll();
                      closeAddGame();
                    }
                  }}
                    style={{ background:"#f97316", border:"none", color:"#fff", borderRadius:8, padding:"8px 12px", fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0 }}>
                    ＋ 加入
                  </button>
                </div>
              </div>
            )}

            {/* ── 收藏庫（優先）── */}
            {catalogResults.length > 0 && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:10, color:"#4ade80", fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>
                  📦 收藏庫（{catalogResults.length} 筆）
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {catalogResults.map(item => {
                    const slugs = (item.platforms||[]).filter(s=>MAJOR_SLUGS.includes(s));
                    const sel = slugs[0] || "";
                    return (
                      <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, background:"#0e1f0e", borderRadius:10, padding:"8px 10px", border:"1px solid #1a3a1a" }}>
                        <div style={{ width:42, height:42, flexShrink:0, borderRadius:5, overflow:"hidden", background:"#111" }}>
                          {item.cover
                            ? <img src={item.cover} style={{ width:"100%", height:"100%", objectFit:"cover" }} alt="" />
                            : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:16 }}>🎮</div>}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, color:"#e2e2e8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                          <div style={{ fontSize:10, color:"#4ade80" }}>
                            已有 {item.ownerCount} 人收藏{item.iOwnIt ? " · 含你" : ""}
                          </div>
                          <div style={{ fontSize:9, color:"#555", marginTop:1 }}>導入後可自行更換封面或編輯資訊</div>
                        </div>
                        <button onClick={() => importFromCatalog(item, sel)}
                          style={{ background: item.iOwnIt?"#1a2a1a":"#16a34a", border: item.iOwnIt?"1px solid #2a4a2a":"none",
                                   color: item.iOwnIt?"#4ade80":"#fff",
                                   borderRadius:8, padding:"7px 10px", fontSize:12, fontWeight:700,
                                   cursor:"pointer", flexShrink:0 }}>
                          {item.iOwnIt ? "再加一份" : "＋ 導入"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 從網路搜尋 ── */}
            {results.length > 0 && (
              <div style={{ fontSize:10, color:"#555", fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>
                🌐 從網路搜尋
              </div>
            )}
            {/* ── 巴哈商城搜尋結果 ── */}
            {results.length > 0 && (
              <div style={{ fontSize:10, color:"#f97316", fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", marginBottom:5 }}>
                🏪 巴哈商城 ({results.length} 筆)
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {results.map((r, idx) => (
                <div key={r.gamer_sn || idx} style={{ display:"flex", alignItems:"center", gap:10, background:"#1a1000", borderRadius:10, padding:"8px 10px", border:"1px solid #3a2000" }}>
                  <div style={{ width:44, height:62, flexShrink:0, borderRadius:5, overflow:"hidden", background:"#111" }}>
                    {r.cover_url
                      ? <img src={r.cover_url} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="" />
                      : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", color:"#333", fontSize:20 }}>🎮</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:13, color:"#e2e2e8", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
                      {cleanGameName(r.zh_name)}
                    </div>
                    <div style={{ fontSize:10, color:"#f97316", marginTop:2 }}>巴哈商城</div>
                  </div>
                  <button onClick={() => addGameFromGamer(r)}
                    style={{ background:"#f97316", border:"none", color:"#fff", borderRadius:8, padding:"8px 12px", fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0, minHeight:40 }}>＋</button>
                </div>
              ))}
            </div>
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
          <Modal title="遊戲資訊" onClose={() => { setModal(null); setShowCoverPicker(false); setCoverResults([]); }}>
            {/* 封面 + 更換按鈕 */}
            <div style={{ display:"flex", gap:12, marginBottom:12, alignItems:"flex-start" }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                {g.cover
                  ? <img src={g.cover} style={{ height:100, objectFit:"contain", borderRadius:6, display:"block" }} alt="" />
                  : <div style={{ width:70, height:100, background:"#1a1a24", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, color:"#333" }}>🎮</div>
                }
                <button onClick={() => {
                    setShowCoverPicker(true);
                    setCoverSearchQ(g.name);
                    setCoverResults([]);
                    setCoverTab("search");
                    loadCommunityCovers(g);
                  }}
                  style={{ position:"absolute", bottom:0, right:0, background:"rgba(0,0,0,0.8)", border:"1px solid #444", color:"#ddd", fontSize:10, padding:"2px 5px", borderRadius:4, cursor:"pointer", lineHeight:1.4 }}>
                  ✎ 換
                </button>
              </div>
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

            {/* ── 編輯區 ── */}
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

      {/* 換封面 Modal */}
      {showCoverPicker && selGame && (
        <Modal title="更換封面" onClose={() => { setShowCoverPicker(false); setCoverResults([]); setCommunityCovers([]); }}>
          {/* Tab 選擇 */}
          <div style={{ display:"flex", gap:0, marginBottom:12, background:"#1a1a24", borderRadius:8, padding:3 }}>
            {[["search","🔍 搜尋"],["community",`👥 社群${communityCovers.length>0?` (${communityCovers.length})`:""}`],["url","🔗 網址"]].map(([t,l]) => (
              <button key={t} onClick={() => setCoverTab(t)}
                style={{ flex:1, background:coverTab===t?"#e60012":"transparent", border:"none",
                         color:coverTab===t?"#fff":"#666", padding:"6px", borderRadius:6,
                         fontSize:11, cursor:"pointer", fontWeight:coverTab===t?700:400 }}>
                {l}
              </button>
            ))}
          </div>

          {coverTab === "search" && (<>
            <div style={{ display:"flex", gap:6, marginBottom:8 }}>
              <input style={{ ...S.input, padding:"8px 10px", fontSize:14, flex:1 }}
                placeholder="輸入遊戲名稱搜尋封面"
                value={coverSearchQ} onChange={e => setCoverSearchQ(e.target.value)}
                onKeyDown={e => e.key==="Enter" && doCoverSearch(coverSearchQ)} />
              <button style={{ ...S.searchBtn, fontSize:14 }}
                onClick={() => doCoverSearch(coverSearchQ)} disabled={coverSearching}>
                {coverSearching?"…":"搜"}
              </button>
            </div>
            <button onClick={() => coverImgRef.current?.click()}
              style={{ display:"block", width:"100%", background:"#1a1a24", border:"1px dashed #333", color:"#aaa", padding:"10px", borderRadius:10, fontSize:13, cursor:"pointer", marginBottom:12 }}>
              📁 從相簿上傳（可選擇是否分享到社群）
            </button>
            <input ref={coverImgRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleCoverImgUpload} />
            {coverResults.length > 0 && (
              <div>
                <div style={S.fieldLabel}>點選封面套用</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                  {coverResults.filter(r=>r.background_image).slice(0,8).map(r => (
                    <div key={r.id} style={{ cursor:"pointer" }} onClick={() => updateCover(selGame.id, r.background_image)}>
                      <img src={r.background_image}
                        style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", borderRadius:6, border:"2px solid #2a2a38", display:"block" }} alt={r.name} />
                      <div style={{ fontSize:9, color:"#666", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {coverTab === "community" && (
            communityCovers.length === 0
              ? <div style={{ textAlign:"center", padding:"30px 0", color:"#444" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📷</div>
                  <div style={{ fontSize:12 }}>還沒有人分享過這款遊戲的封面</div>
                  <div style={{ fontSize:11, color:"#555", marginTop:4 }}>切換到「搜尋」頁，上傳後選擇分享即可！</div>
                </div>
              : <div>
                  <div style={{ fontSize:11, color:"#666", marginBottom:10 }}>來自玩家社群的封面，點擊套用</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                    {communityCovers.map(c => (
                      <div key={c.id} style={{ cursor:"pointer" }} onClick={() => updateCover(selGame.id, c.coverUrl)}>
                        <img src={c.coverUrl}
                          style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", borderRadius:7, border:"2px solid #2a2a38", display:"block" }} alt="" />
                        <div style={{ fontSize:9, color:"#555", marginTop:2, textAlign:"center" }}>by {c.userName}</div>
                      </div>
                    ))}
                  </div>
                </div>
          )}

          {coverTab === "url" && (
            <div>
              <div style={{ fontSize:11, color:"#666", marginBottom:8 }}>
                貼上圖片網址（支援巴哈、IGDB 或任何圖片連結）
              </div>
              <input style={{ ...S.input, marginBottom:8 }}
                placeholder="https://p2.bahamut.com.tw/B/ACG/c/..."
                value={coverUrlInput}
                onChange={e => setCoverUrlInput(e.target.value)} />
              {coverUrlInput && (
                <div style={{ marginBottom:10, textAlign:"center" }}>
                  <img src={coverUrlInput} style={{ maxHeight:180, maxWidth:"100%", borderRadius:8, objectFit:"contain" }}
                    onError={e => { e.target.style.display="none"; }}
                    alt="預覽" />
                </div>
              )}
              <button style={coverUrlInput ? S.redBtn : S.disabledBtn}
                disabled={!coverUrlInput}
                onClick={() => { updateCover(selGame.id, coverUrlInput); setCoverUrlInput(""); }}>
                套用此封面
              </button>
            </div>
          )}
        </Modal>
      )}

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
          {/* 我的資料 */}
          <div style={{ background:"#1a1a24", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
            <div style={{ fontSize:12, color:"#4ade80", fontWeight:700, marginBottom:8 }}>👤 我的帳號</div>
            <div style={{ marginBottom:8 }}>
              <div style={S.fieldLabel}>顯示名稱</div>
              <input style={{ ...S.input, fontSize:14 }}
                value={settingsForm.userName}
                onChange={e => setSettingsForm(f => ({ ...f, userName: e.target.value }))} />
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:13, color:"#ccc" }}>公開我的收藏</span>
              <button onClick={() => setSettingsForm(f => ({ ...f, isPublic: f.isPublic?0:1 }))}
                style={{ background: settingsForm.isPublic?"#16a34a":"#2a2a38", border:"none", color:"#fff", padding:"4px 14px", borderRadius:12, fontSize:12, cursor:"pointer", fontWeight:700 }}>
                {settingsForm.isPublic ? "公開 ✓" : "私人"}
              </button>
            </div>
            <div style={{ fontSize:10, color:"#444" }}>公開後，其他人可以看到你的遊戲清單並申請借用</div>
          </div>

          {/* Claude API Key */}
          <div style={S.fieldLabel}>Claude API Key（存本機，不上傳伺服器）</div>
          <input style={{ ...S.input, fontFamily:"monospace", fontSize:14, marginBottom:8 }}
            placeholder="sk-ant-..." value={settingsForm.claudeKey}
            onChange={e => setSettingsForm(f => ({ ...f, claudeKey: e.target.value }))} />
          <div style={{ background:"#1a1a24", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#555", marginBottom:12 }}>
            💡 設定後可使用中文搜尋、拍照辨識功能
          </div>
          <div style={{ background:"#0a1a0a", border:"1px solid #1a3a1a", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
            <div style={{ fontSize:12, color:"#4ade80", fontWeight:700, marginBottom:4 }}>🎨 IGDB 封面庫</div>
            <div style={{ fontSize:11, color:"#555", lineHeight:1.6 }}>
              Railway → Variables → <code style={{ color:"#888" }}>IGDB_CLIENT_ID</code> / <code style={{ color:"#888" }}>IGDB_CLIENT_SECRET</code><br/>
              申請：<span style={{ color:"#4ade80" }}>dev.twitch.tv</span>
            </div>
          </div>
          <button style={S.redBtn} onClick={async () => {
            localStorage.setItem("svClaudeKey", settingsForm.claudeKey);
            localStorage.setItem("svUserName", settingsForm.userName);
            // 更新後端用戶資料
            try {
              await api(`/api/users/${myUserId()}`, { method:"PATCH", pin:adminPin(), body:{
                name: settingsForm.userName, is_public: settingsForm.isPublic
              }});
            } catch {}
            setModal(null);
          }}>儲存設定</button>

          {/* 巴哈商城名稱庫 */}
          <GamerCrawlSection adminPin={adminPin} />
        </Modal>
      )}

      {/* 申請借用 Modal */}
      {reqModal && (
        <Modal title="申請借用" onClose={() => { setReqModal(null); setReqForm({ message:"", expectedReturn:"" }); }}>
          <div style={{ display:"flex", gap:10, marginBottom:14, alignItems:"center" }}>
            {reqModal.cover
              ? <img src={reqModal.cover} style={{ width:60, height:84, objectFit:"cover", borderRadius:7 }} alt="" />
              : <div style={{ width:60, height:84, background:"#1a1a24", borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, color:"#333" }}>🎮</div>
            }
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#e2e2e8", marginBottom:4 }}>{reqModal.name}</div>
              <div style={{ fontSize:11, color:"#555" }}>向對方發送借用申請</div>
            </div>
          </div>
          <div style={{ marginBottom:10 }}>
            <div style={S.fieldLabel}>預計歸還日期 *</div>
            <input type="date" style={S.input} value={reqForm.expectedReturn}
              onChange={e => setReqForm(f => ({ ...f, expectedReturn: e.target.value }))} />
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={S.fieldLabel}>附言（選填）</div>
            <input style={S.input} placeholder="例：我會好好愛惜！" value={reqForm.message}
              onChange={e => setReqForm(f => ({ ...f, message: e.target.value }))} />
          </div>
          <button style={reqForm.expectedReturn ? S.redBtn : S.disabledBtn}
            disabled={!reqForm.expectedReturn} onClick={submitBorrowRequest}>
            📨 送出申請
          </button>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function GamerCrawlSection({ adminPin }) {
  const [stats, setStats] = useState(null);
  const [crawling, setCrawling] = useState(false);
  const [testQ, setTestQ] = useState("Luigi's Mansion 3");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/gamer-stats").then(r=>r.json()).then(setStats).catch(()=>{});
  }, []);

  async function doCrawl() {
    setCrawling(true);
    try {
      const res = await fetch("/api/admin/crawl-gamer", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-pin": adminPin() || ""},
        body: JSON.stringify({ max_pages: 10 })
      });
      const data = await res.json();
      alert(`爬蟲完成！共匯入 ${data.imported} 筆遊戲名稱`);
      const s = await fetch("/api/gamer-stats").then(r=>r.json());
      setStats(s);
    } catch { alert("爬蟲失敗，請確認網路連線"); }
    setCrawling(false);
  }

  async function doTest() {
    if (!testQ.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`/api/gamer-search?q=${encodeURIComponent(testQ)}`);
      const data = await res.json();
      setTestResult(data);
    } catch { setTestResult({ error: "連線失敗" }); }
    setTesting(false);
  }

  return (
    <div style={{ marginTop:14, background:"#0d1a0d", border:"1px solid #1a3a1a", borderRadius:10, padding:"10px 12px" }}>
      <div style={{ fontSize:12, color:"#4ade80", fontWeight:700, marginBottom:6 }}>
        🏪 巴哈商城遊戲名稱庫
      </div>
      {stats && (
        <div style={{ fontSize:11, color:"#555", marginBottom:8 }}>
          已收錄：<span style={{ color:"#4ade80" }}>{stats.total}</span> 款
          {stats.by_platform && Object.entries(stats.by_platform).map(([p,n]) => (
            <span key={p} style={{ marginLeft:8 }}>{p}: {n}</span>
          ))}
        </div>
      )}

      {/* 即時搜尋測試 */}
      <div style={{ marginBottom:10, background:"#111", borderRadius:8, padding:"8px 10px" }}>
        <div style={{ fontSize:10, color:"#666", marginBottom:5, textTransform:"uppercase", letterSpacing:0.5 }}>測試即時搜尋</div>
        <div style={{ display:"flex", gap:5, marginBottom:6 }}>
          <input value={testQ} onChange={e=>setTestQ(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&doTest()}
            style={{ flex:1, background:"#1a1a24", border:"1px solid #2a2a38", borderRadius:7, padding:"5px 8px", color:"#ddd", fontSize:12, outline:"none" }}
            placeholder="輸入英文遊戲名測試..." />
          <button onClick={doTest} disabled={testing}
            style={{ background:"#1d4ed8", border:"none", color:"#fff", padding:"5px 10px", borderRadius:7, fontSize:11, cursor:"pointer", fontWeight:700 }}>
            {testing?"…":"測試"}
          </button>
        </div>
        {testResult && (
          <div style={{ fontSize:11 }}>
            {testResult.error
              ? <span style={{ color:"#f87171" }}>❌ {testResult.error}</span>
              : testResult.zh_name
                ? (<>
                    <div style={{ color:"#4ade80", marginBottom:4 }}>✅ 找到中文名：<strong>{testResult.zh_name}</strong></div>
                    {testResult.cover_url
                      ? (<div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <img src={testResult.cover_url} style={{ width:40, height:56, objectFit:"cover", borderRadius:5 }}
                            onError={e=>e.target.style.display="none"} alt="" />
                          <span style={{ color:"#4ade80", fontSize:10 }}>✅ 封面抓到了</span>
                        </div>)
                      : <span style={{ color:"#fbbf24" }}>⚠️ 找到名稱但沒有封面 URL</span>
                    }
                  </>)
              : <span style={{ color:"#fbbf24" }}>⚠️ 沒找到（將改用 Claude 翻譯）</span>
            }
          </div>
        )}
      </div>

      <div style={{ fontSize:11, color:"#555", marginBottom:8, lineHeight:1.5 }}>
        從巴哈商城爬取中文遊戲名稱，加入收藏時自動對應。
      </div>
      <button onClick={doCrawl} disabled={crawling}
        style={{ background: crawling?"#1a2a1a":"#16a34a", border:"none", color:"#fff",
                 padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:700,
                 cursor: crawling?"not-allowed":"pointer", width:"100%" }}>
        {crawling ? "🔄 爬蟲執行中..." : "🕷 執行巴哈商城爬蟲（更新名稱庫）"}
      </button>
    </div>
  );
}

function GameCard({ game, borrow, overdue, onClick, cols }) {
  const micro = cols >= 12;
  const small = cols >= 8;
  const medium = cols >= 6;
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
      <div style={{ position:"relative", width:"100%", paddingBottom:"150%", background:"#0a0a12", flexShrink:0 }}>
        {game.cover
          ? <img src={game.cover} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }} alt={game.name} />
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
            fontSize: small?9:medium?12:14, fontWeight:700, color:"#ddd", lineHeight:1.3,
            overflow:"hidden", display:"-webkit-box",
            WebkitLineClamp: small?1:2, WebkitBoxOrient:"vertical",
            marginBottom: small?1:2,
          }}>{game.name}</div>
          {/* 平台 */}
          <span style={{ fontSize: small?8:10, color:platColor, fontWeight:700 }}>
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
