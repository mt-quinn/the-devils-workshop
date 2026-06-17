// Hex rosette radius in axial coordinates (radius 2 → 3/4/5/4/3 rows = 19 cells)
const radius = 2;

// Movement directions for flat-topped axial grid, named by on-screen compass:
// N (straight up), S (straight down), and the four diagonals NE, SE, SW, NW.
const directions = [
  { name: "N", dq: 0, dr: -1, vec: [0, -1] },
  { name: "NE", dq: 1, dr: -1, vec: [0.5, -Math.sqrt(3) / 2] },
  { name: "SE", dq: 1, dr: 0, vec: [0.5, Math.sqrt(3) / 2] },
  { name: "S", dq: 0, dr: 1, vec: [0, 1] },
  { name: "SW", dq: -1, dr: 1, vec: [-0.5, Math.sqrt(3) / 2] },
  { name: "NW", dq: -1, dr: 0, vec: [-0.5, -Math.sqrt(3) / 2] },
];

const valuesOrder = [1, 2, 3, 4, 5, 6, 66, 666, 777, 888, 999, 9999, 99999, 999999];
const valueClass = (v) => `v-${v}`;
const cellKey = (q, r) => `${q},${r}`;

const cells = [];
for (let q = -radius; q <= radius; q++) {
  const r1 = Math.max(-radius, -q - radius);
  const r2 = Math.min(radius, -q + radius);
  for (let r = r1; r <= r2; r++) {
    cells.push({ q, r });
  }
}
const cellSet = new Set(cells.map((c) => cellKey(c.q, c.r)));

const boardEl = document.getElementById("board");
const messageEl = document.getElementById("message");
const scoreEl = document.getElementById("score-value");
const bestScoreEl = document.getElementById("best-score");
const bestScorePanelEl = document.getElementById("best-score-panel");
const bestTileEl = document.getElementById("best-tile");
const bestTilePanelEl = document.getElementById("best-tile-panel");
const objectiveEl = document.getElementById("objective");
const objectiveTextEl = document.getElementById("objective-text");

const SAVE_KEY = "devils-workshop-save-v1";
const HIGH_SCORE_KEY = "devils-workshop-highscore-v1";
const BEST_TILE_KEY = "devils-workshop-besttile-v1";

const cellEls = new Map();
const tileEls = new Map();
// Legacy highlight divs are no longer used for visuals; we now draw highlights via SVG.
const highlightEls = new Map();
const directionEdges = new Map();

const state = {
  tiles: [],
  score: 0,
  bestTile: 0,
  bestTileAllTime: 0,
  highScore: 0,
  locked: false,
  previewDir: null,
  satanSummoned: false,
};

let nextId = 1;
let cellSize = 80;
let positions = new Map();
let offset = { x: 0, y: 0 };
let pointerStart = null;
let keyboardKeys = new Set();
let lastPreviewDir = null;
let messageTimeoutId = null;
let edgeSvg = null;
let boardWidth = 0;
let boardHeight = 0;
let stoneTexW = 512;
let stoneTexH = 512;
let stoneTexReady = false;

const spawnChanceTwo = 0.5;
const animationMs = 170;

// Flat-topped axial → pixel conversion
// `size` here is hex side length; rendered width is 2 * size.
function axialToPixel(q, r, size) {
  const x = size * (3 / 2) * q;
  const y = size * Math.sqrt(3) * (r + q / 2);
  return { x, y };
}

function computeLayout() {
  const side = cellSize / 2;
  const pts = cells.map((c) => axialToPixel(c.q, c.r, side));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));

  const baseWidth = maxX - minX + cellSize;
  const baseHeight = maxY - minY + cellSize;
  const margin = cellSize * 0.35;
  const width = baseWidth + margin * 2;
  const height = baseHeight + margin * 2;
  const pad = 12;
  const maxWidth = document.body.clientWidth - pad * 2;
  const maxHeight = Math.max(window.innerHeight - 240, 300);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);

  document.documentElement.style.setProperty("--cell-size", `${cellSize}px`);
  boardEl.style.width = `${width}px`;
  boardEl.style.height = `${height}px`;
  boardEl.style.transform = `scale(${scale})`;
  boardEl.style.transformOrigin = "50% 50%";

  boardWidth = width;
  boardHeight = height;

  offset = {
    x: -minX + cellSize / 2 + margin,
    y: -minY + cellSize / 2 + margin,
  };
  positions = new Map(
    cells.map((c) => {
      const p = axialToPixel(c.q, c.r, side);
      return [cellKey(c.q, c.r), { x: p.x + offset.x, y: p.y + offset.y }];
    })
  );
}

function formatTileValue(value) {
  if (value === 999999) {
    return "999\n999";
  }
  return String(value);
}

// Scale the gothic title so it always sits on one row beside the New Game
// button, no matter the column width or the font's metrics. We grow to a max
// then shrink one px at a time until the header row no longer overflows.
function fitTitle() {
  const row = document.querySelector(".header-row");
  const title = document.querySelector(".title");
  if (!row || !title) return;
  const MAX = 40;
  const MIN = 14;
  let size = MAX;
  title.style.fontSize = size + "px";
  while (size > MIN && row.scrollWidth > row.clientWidth) {
    size -= 1;
    title.style.fontSize = size + "px";
  }
}

function updateGoalText() {
  if (!objectiveTextEl) return;
  if (state.satanSummoned) {
    objectiveTextEl.innerHTML = 'Reach 999,999 to <s>kill</s> banish Satan';
    if (objectiveEl) objectiveEl.classList.add("summoned");
  } else {
    objectiveTextEl.innerHTML = 'Reach 666 to <s>win</s> summon Satan';
    if (objectiveEl) objectiveEl.classList.remove("summoned");
  }
}

function buildCells() {
  boardEl.innerHTML = "";
  cellEls.clear();
  tileEls.clear();
  cells.forEach((c) => {
    const key = cellKey(c.q, c.r);
    const pos = positions.get(key);

    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
    boardEl.appendChild(cell);
    cellEls.set(key, cell);
  });
}

function ensureEdgeSvg() {
  if (!edgeSvg) {
    edgeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    edgeSvg.setAttribute("id", "edge-overlay");
    boardEl.appendChild(edgeSvg);
  }
  edgeSvg.setAttribute("width", String(boardWidth));
  edgeSvg.setAttribute("height", String(boardHeight));
  edgeSvg.setAttribute("viewBox", `0 0 ${boardWidth} ${boardHeight}`);
}

function ensureStoneTextureInfo() {
  const img = new Image();
  img.src = "./stonetexture.png";
  img.onload = () => {
    stoneTexW = img.naturalWidth || stoneTexW;
    stoneTexH = img.naturalHeight || stoneTexH;
    stoneTexReady = true;
    tileEls.forEach((el, id) => {
      setTileTextureOffset(el, id);
    });
  };
}

function setTileTextureOffset(el, id) {
  if (!stoneTexReady) {
    // Defer until texture info is available; use a neutral center crop.
    el.style.setProperty("--tx", "0px");
    el.style.setProperty("--ty", "0px");
    return;
  }

  const tileW = cellSize;
  const tileH = cellSize * 0.8660254;

  const availW = Math.max(0, stoneTexW - tileW);
  const availH = Math.max(0, stoneTexH - tileH);

  if (availW === 0 && availH === 0) {
    el.style.setProperty("--tx", "0px");
    el.style.setProperty("--ty", "0px");
    return;
  }

  // Golden-ratio-based pseudo-random but deterministic per id.
  const u = (id * 0.61803398875) % 1;
  const v = (id * 0.32471795724) % 1;

  const maxMargin = Math.min(48, tileW * 0.6, tileH * 0.6);

  const safeMarginX = Math.min(maxMargin, availW / 2);
  const safeMarginY = Math.min(maxMargin, availH / 2);

  let minX = 0;
  let maxX = availW;
  if (safeMarginX > 0) {
    minX = safeMarginX;
    maxX = availW - safeMarginX;
  }

  let minY = 0;
  let maxY = availH;
  if (safeMarginY > 0) {
    minY = safeMarginY;
    maxY = availH - safeMarginY;
  }

  const x = minX + (maxX - minX) * u;
  const y = minY + (maxY - minY) * v;

  el.style.setProperty("--tx", `${-x}px`);
  el.style.setProperty("--ty", `${-y}px`);
}

function getHexVertices(q, r) {
  const key = cellKey(q, r);
  const center = positions.get(key);
  if (!center) return null;

  const w = cellSize;
  const h = cellSize * 0.8660254;
  const halfW = w / 2;
  const halfH = h / 2;

  const local = [
    { x: 0.25 * w, y: 0 },       // top
    { x: 0.75 * w, y: 0 },       // top-right
    { x: w,         y: 0.5 * h },// right
    { x: 0.75 * w, y: h },       // bottom-right
    { x: 0.25 * w, y: h },       // bottom
    { x: 0,         y: 0.5 * h } // left
  ];

  return local.map((p) => ({
    x: center.x + (p.x - halfW),
    y: center.y + (p.y - halfH),
  }));
}

function drawEdgeHighlight(dirName) {
  if (!edgeSvg) return;
  edgeSvg.innerHTML = "";
  if (!dirName) return;

  const keys = directionEdges.get(dirName) || [];
  const edgeIndex = {
    N: [0, 1],
    NE: [1, 2],
    SE: [2, 3],
    S: [3, 4],
    SW: [4, 5],
    NW: [5, 0],
  }[dirName];

  if (!edgeIndex) return;

  keys.forEach((key) => {
    const [qStr, rStr] = key.split(",");
    const q = Number(qStr);
    const r = Number(rStr);
    const verts = getHexVertices(q, r);
    if (!verts) return;
    const a0 = verts[edgeIndex[0]];
    const b0 = verts[edgeIndex[1]];

    // Shrink the line segment slightly so it doesn't overshoot the edge
    const dx = b0.x - a0.x;
    const dy = b0.y - a0.y;
    const t = 0.12; // trim proportion from each end
    const a = { x: a0.x + dx * t, y: a0.y + dy * t };
    const b = { x: b0.x - dx * t, y: b0.y - dy * t };
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("class", "edge-line");
    edgeSvg.appendChild(line);
  });
}

function computeEdges() {
  directions.forEach((dir) => {
    const list = [];
    cells.forEach((c) => {
      const nq = c.q + dir.dq;
      const nr = c.r + dir.dr;
      if (!cellSet.has(cellKey(nq, nr))) {
        list.push(cellKey(c.q, c.r));
      }
    });
    directionEdges.set(dir.name, list);
  });
}

function setEdgeHighlight(dirName) {
  drawEdgeHighlight(dirName);
}

function nextValue(v) {
  const idx = valuesOrder.indexOf(v);
  if (idx === -1 || idx === valuesOrder.length - 1) return null;
  return valuesOrder[idx + 1];
}

function planMove(dir) {
  const vector = directions.find((d) => d.name === dir);
  if (!vector) return { moved: false };

  const projection = (t) => t.q * vector.dq + t.r * vector.dr;
  const order = [...state.tiles].sort((a, b) => projection(b) - projection(a));

  const occupied = new Map();
  const finalTiles = [];
  const steps = new Map();
  const mergedNewIds = [];
  let moved = false;
  let scoreGain = 0;

  order.forEach((tile) => {
    steps.set(tile.id, { id: tile.id, from: { q: tile.q, r: tile.r } });
  });

  for (const tile of order) {
    let q = tile.q;
    let r = tile.r;

    while (cellSet.has(cellKey(q + vector.dq, r + vector.dr))) {
      const nextKey = cellKey(q + vector.dq, r + vector.dr);
      if (occupied.has(nextKey)) break;
      q += vector.dq;
      r += vector.dr;
    }

    const blockingKey = cellKey(q + vector.dq, r + vector.dr);
    const blocker = cellSet.has(blockingKey) ? occupied.get(blockingKey) : null;

    if (
      blocker &&
      !blocker.justMerged &&
      blocker.value === tile.value &&
      nextValue(tile.value)
    ) {
      const mergedVal = nextValue(tile.value);
      const mergedTile = {
        ...blocker,
        value: mergedVal,
        justMerged: true,
      };
      occupied.set(blockingKey, mergedTile);
      mergedNewIds.push(mergedTile.id);
      scoreGain += mergedVal;
      steps.get(tile.id).to = { q: blocker.q, r: blocker.r };
      steps.get(tile.id).removed = true;
      if (steps.has(blocker.id)) {
        steps.get(blocker.id).to = { q: blocker.q, r: blocker.r };
      }
      moved = moved || blocker.q !== tile.q || blocker.r !== tile.r;
    } else {
      const destKey = cellKey(q, r);
      occupied.set(destKey, { ...tile, q, r, justMerged: false });
      const step = steps.get(tile.id);
      step.to = { q, r };
      moved = moved || q !== tile.q || r !== tile.r;
    }
  }

  occupied.forEach((t) => finalTiles.push({ ...t, justMerged: !!t.justMerged }));

  return { moved, steps, finalTiles, mergedNewIds, scoreGain };
}

function applyMovement(steps) {
  steps.forEach((step) => {
    const el = tileEls.get(step.id);
    if (!el || !step.to) return;
    const pos = positions.get(cellKey(step.to.q, step.to.r));
    if (pos) {
      el.style.setProperty("--x", `${pos.x}px`);
      el.style.setProperty("--y", `${pos.y}px`);
    }
  });
}

function renderTiles(options = {}) {
  const { newIds = [], mergedIds = [] } = options;
  const present = new Set(state.tiles.map((t) => t.id));
  Array.from(tileEls.keys()).forEach((id) => {
    if (!present.has(id)) {
      const el = tileEls.get(id);
      if (el) el.remove();
      tileEls.delete(id);
    }
  });

  state.tiles.forEach((tile) => {
    let el = tileEls.get(tile.id);
    const pos = positions.get(cellKey(tile.q, tile.r));
    if (!pos) return;

    if (!el) {
      el = document.createElement("div");
      el.className = "tile";
      el.dataset.id = tile.id;
      boardEl.appendChild(el);
      tileEls.set(tile.id, el);
    }

    let label = el.querySelector(".num");
    if (!label) {
      label = document.createElement("span");
      label.className = "num";
      el.appendChild(label);
    }
    label.textContent = formatTileValue(tile.value);
    el.className = `tile ${valueClass(tile.value)}`;
    if (newIds.includes(tile.id)) el.classList.add("new");
    if (mergedIds.includes(tile.id)) el.classList.add("merged");

    setTileTextureOffset(el, tile.id);
    el.style.setProperty("--x", `${pos.x}px`);
    el.style.setProperty("--y", `${pos.y}px`);
  });
}

let lastShownScore = 0;

function updateHud() {
  if (state.score > lastShownScore) {
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth; // restart the animation
    scoreEl.classList.add("bump");
  }
  lastShownScore = state.score;
  scoreEl.textContent = state.score;
  bestTileEl.textContent = state.bestTileAllTime;
  bestScoreEl.textContent = state.highScore;
}

// --- Persistence -----------------------------------------------------------
// The in-progress game and the all-time best score are stored separately so a
// fresh game never wipes the high score.

function loadHighScore() {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const n = raw == null ? 0 : Number(raw);
    state.highScore = Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    state.highScore = 0;
  }
}

function recordHighScore() {
  if (state.score > state.highScore) {
    state.highScore = state.score;
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    } catch (e) {
      /* storage unavailable — keep playing without persistence */
    }
    // Brief celebratory flash on the Best panel.
    if (bestScorePanelEl) {
      bestScorePanelEl.classList.remove("record");
      void bestScorePanelEl.offsetWidth; // restart the animation
      bestScorePanelEl.classList.add("record");
    }
  }
}

function loadBestTile() {
  try {
    const raw = localStorage.getItem(BEST_TILE_KEY);
    const n = raw == null ? 0 : Number(raw);
    state.bestTileAllTime = Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    state.bestTileAllTime = 0;
  }
}

// The all-time best tile persists across new games (like the high score),
// while state.bestTile stays per-game because it drives spawn rate and the
// summon trigger.
function recordBestTile() {
  if (state.bestTile > state.bestTileAllTime) {
    state.bestTileAllTime = state.bestTile;
    try {
      localStorage.setItem(BEST_TILE_KEY, String(state.bestTileAllTime));
    } catch (e) {
      /* storage unavailable — keep playing without persistence */
    }
    if (bestTilePanelEl) {
      bestTilePanelEl.classList.remove("record");
      void bestTilePanelEl.offsetWidth; // restart the animation
      bestTilePanelEl.classList.add("record");
    }
  }
}

function saveGame() {
  try {
    const payload = {
      tiles: state.tiles.map((t) => ({ id: t.id, q: t.q, r: t.r, value: t.value })),
      score: state.score,
      bestTile: state.bestTile,
      satanSummoned: state.satanSummoned,
      nextId,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) {
    /* storage unavailable — game still works, just won't persist */
  }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
}

function loadSavedGame() {
  let data;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (e) {
    return false;
  }
  if (!data || !Array.isArray(data.tiles) || data.tiles.length === 0) return false;

  const validTiles = data.tiles.filter(
    (t) =>
      t &&
      cellSet.has(cellKey(t.q, t.r)) &&
      valuesOrder.includes(t.value)
  );
  if (validTiles.length === 0) return false;

  state.tiles = validTiles.map((t) => ({ id: t.id, q: t.q, r: t.r, value: t.value }));
  state.score = Number.isFinite(data.score) ? data.score : 0;
  state.bestTile = Number.isFinite(data.bestTile)
    ? data.bestTile
    : Math.max(...state.tiles.map((t) => t.value));
  state.satanSummoned = !!data.satanSummoned;
  nextId = Number.isFinite(data.nextId)
    ? data.nextId
    : Math.max(0, ...state.tiles.map((t) => t.id)) + 1;
  return true;
}

function spawnRandomTile() {
  const occupiedKeys = new Set(state.tiles.map((t) => cellKey(t.q, t.r)));
  const empties = cells.filter((c) => !occupiedKeys.has(cellKey(c.q, c.r)));
  if (!empties.length) return null;
  const spot = empties[Math.floor(Math.random() * empties.length)];
  const value = Math.random() < spawnChanceTwo ? 2 : 1;
  const tile = { id: nextId++, q: spot.q, r: spot.r, value };
  state.tiles.push(tile);
  state.bestTile = Math.max(state.bestTile, tile.value);
  return tile.id;
}

function checkWin() {
  return state.tiles.some((t) => t.value >= 999999);
}

function hasMoves() {
  const occupied = new Map(state.tiles.map((t) => [cellKey(t.q, t.r), t]));
  if (occupied.size < cells.length) return true;
  for (const t of state.tiles) {
    for (const dir of directions) {
      const key = cellKey(t.q + dir.dq, t.r + dir.dr);
      if (occupied.has(key) && occupied.get(key).value === t.value) {
        return true;
      }
    }
  }
  return false;
}

// --- Merge celebration -----------------------------------------------------
// Every channel below is driven off a single "tier": the resulting tile's rank
// in the value ladder (0..13). Higher merges read louder across every sense at
// once. The loud channels (screenshake, hitstop) are reserved for milestone
// merges so ordinary merges stay snappy.

function mergeTier(value) {
  const i = valuesOrder.indexOf(value);
  return i < 0 ? 0 : i;
}

function spawnSparks(x, y, tier) {
  const count = Math.min(28, 5 + tier * 2);
  const reach = 24 + tier * 6;
  const hot = tier >= 6;
  const palette = hot
    ? ["#fff3d6", "#ffce85", "#ff8a3d", "#ff3a23"]
    : ["#fff6e6", "#ffe2ad", "#ffc878"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "spark";
    const ang = Math.random() * Math.PI * 2;
    const dist = reach * (0.45 + Math.random() * 0.75);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - reach * 0.25; // slight upward bias
    const size = 3 + Math.random() * (hot ? 4 : 2.2);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.background = palette[(Math.random() * palette.length) | 0];
    p.style.setProperty("--tx", `${dx}px`);
    p.style.setProperty("--ty", `${dy}px`);
    p.style.setProperty("--d", `${380 + Math.random() * 360}ms`);
    boardEl.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
  }
}

function spawnScorePopup(x, y, value, tier) {
  const el = document.createElement("div");
  el.className = tier >= 6 ? "score-popup hot" : "score-popup";
  el.textContent = `+${value}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.fontSize = `${14 + tier * 2.2}px`;
  boardEl.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

function reactBoard(topTier) {
  const shell = document.querySelector(".board-shell");
  if (!shell) return;
  // Screenshake only for milestone merges (66 and up).
  if (topTier >= 6) {
    shell.style.setProperty("--shake", `${Math.min(10, 3 + (topTier - 6) * 1.1)}px`);
    shell.classList.remove("shake");
    void shell.offsetWidth;
    shell.classList.add("shake");
    setTimeout(() => shell.classList.remove("shake"), 420);
  }
}

function buzz(tier) {
  if (!navigator.vibrate || tier < 1) return;
  if (tier >= 6) {
    navigator.vibrate([0, 16 + (tier - 6) * 4, 28, 12]);
  } else {
    navigator.vibrate(5 + tier * 2);
  }
}

function celebrateMerge(mergedInfo) {
  let topTier = 0;
  mergedInfo.forEach((m) => {
    const tier = mergeTier(m.value);
    topTier = Math.max(topTier, tier);
    const el = tileEls.get(m.id);
    if (el) {
      el.style.setProperty("--pop", String(Math.min(0.45, 0.12 + tier * 0.024)));
      el.style.setProperty("--flash", String(Math.min(2.2, 0.5 + tier * 0.13)));
    }
    const pos = positions.get(cellKey(m.q, m.r));
    if (!pos) return;
    spawnSparks(pos.x, pos.y, tier);
    spawnScorePopup(pos.x, pos.y, m.value, tier);
  });
  reactBoard(topTier);
  buzz(topTier);
}

function performMove(dir) {
  if (state.locked) return;
  const plan = planMove(dir);
  if (!plan.moved) {
    setEdgeHighlight(null);
    return;
  }
  state.locked = true;
  applyMovement(Array.from(plan.steps.values()));

  setTimeout(() => {
    // Phase 1: land the merge and celebrate it.
    const mergedInfo = plan.finalTiles
      .filter((t) => t.justMerged)
      .map((t) => ({ id: t.id, q: t.q, r: t.r, value: t.value }));

    state.tiles = plan.finalTiles.map((t) => ({ ...t, justMerged: undefined }));
    state.score += plan.scoreGain;
    state.bestTile = Math.max(state.bestTile, ...state.tiles.map((t) => t.value));

    renderTiles({ mergedIds: plan.mergedNewIds });
    recordHighScore();
    recordBestTile();
    updateHud();

    let hitstopMs = 0;
    if (mergedInfo.length) {
      celebrateMerge(mergedInfo);
      const topTier = Math.max(...mergedInfo.map((m) => mergeTier(m.value)));
      // A brief weighty freeze before the board repopulates, milestone only.
      if (topTier >= 6) hitstopMs = Math.min(80, 28 + (topTier - 6) * 8);
    }

    // Phase 2: after the hitstop beat, spawn new tiles and resolve.
    setTimeout(() => {
      const newIds = [];
      const spawnCount = state.bestTile >= 666 ? 2 : 1;
      for (let i = 0; i < spawnCount; i++) {
        const id = spawnRandomTile();
        if (id != null) newIds.push(id);
      }

      renderTiles({ newIds, mergedIds: plan.mergedNewIds });
      updateHud();
      saveGame();

      const justSummoned =
        !state.satanSummoned &&
        state.bestTile >= 666 &&
        state.bestTile < 999999;

      if (checkWin()) {
        clearSavedGame();
        showMessage("You killed Satan. Victory!");
      } else if (justSummoned) {
        state.satanSummoned = true;
        updateGoalText();
        showMessage("You have summoned Satan. Two tiles now spawn after each move. Reach 999,999 to kill Satan.", {
          autoFade: false,
          dismissible: true,
        });
      } else if (!hasMoves()) {
        clearSavedGame();
        showMessage("No moves left. Try again.");
      } else {
        hideMessage();
      }
      state.locked = false;
    }, hitstopMs);
  }, animationMs);
}

function showMessage(text, options = {}) {
  const { autoFade = false, duration = 2600, dismissible = false } = options;
  if (!messageEl) return;

  if (dismissible) {
    messageEl.innerHTML = `
      <div class="message-inner">
        <p>${text}</p>
        <button type="button" class="message-ok">OK</button>
      </div>
    `;
    const btn = messageEl.querySelector(".message-ok");
    if (btn) {
      btn.addEventListener("click", () => {
        hideMessage();
      });
    }
  } else {
    messageEl.textContent = text;
  }
  messageEl.hidden = false;
  messageEl.classList.add("visible");
  messageEl.classList.remove("fade-out");

  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }

  if (autoFade && !dismissible) {
    messageEl.classList.add("fade-out");
    messageTimeoutId = setTimeout(() => {
      messageTimeoutId = null;
      hideMessage();
    }, duration);
  }
}

function showConfirm(text, onConfirm) {
  if (!messageEl) {
    if (onConfirm) onConfirm();
    return;
  }
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  messageEl.innerHTML = `
    <div class="message-inner">
      <p>${text}</p>
      <div class="message-actions">
        <button type="button" class="message-cancel">Cancel</button>
        <button type="button" class="message-ok">New Game</button>
      </div>
    </div>
  `;
  const okBtn = messageEl.querySelector(".message-ok");
  const cancelBtn = messageEl.querySelector(".message-cancel");
  if (okBtn) {
    okBtn.addEventListener("click", () => {
      hideMessage();
      if (onConfirm) onConfirm();
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => hideMessage());
  }
  messageEl.hidden = false;
  messageEl.classList.add("visible");
  messageEl.classList.remove("fade-out");
}

function hideMessage() {
  if (!messageEl) return;
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
    messageTimeoutId = null;
  }
  messageEl.classList.remove("visible", "fade-out");
  messageEl.hidden = true;
}

function resetGame() {
  state.tiles = [];
  state.score = 0;
  state.bestTile = 0;
  state.satanSummoned = false;
  nextId = 1;
  hideMessage();
  updateGoalText();
  spawnRandomTile();
  spawnRandomTile();
  renderTiles({ newIds: state.tiles.map((t) => t.id) });
  updateHud();
  saveGame();
}

// Wipe the in-progress game, but only confirm first if there's progress worth
// protecting (so an accidental tap doesn't erase a long run).
function requestNewGame() {
  if (state.locked) return;
  if (state.score > 0) {
    showConfirm("Start a new game? Your current board will be cleared.", resetGame);
  } else {
    resetGame();
  }
}

function directionFromVector(dx, dy) {
  if (Math.hypot(dx, dy) < 10) return null;
  let best = null;
  let bestDot = -Infinity;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  directions.forEach((dir) => {
    const [vx, vy] = dir.vec;
    const dot = nx * vx + ny * vy;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir.name;
    }
  });
  return best;
}

function directionFromKeys(set) {
  const up = set.has("ArrowUp");
  const down = set.has("ArrowDown");
  const left = set.has("ArrowLeft");
  const right = set.has("ArrowRight");

  // Diagonals override straight directions
  if (up && right) return "NE";
  if (down && right) return "SE";
  if (up && left) return "NW";
  if (down && left) return "SW";

  // Straight vertical moves
  if (up) return "N";
  if (down) return "S";

  // Left/right alone do nothing on this layout
  return null;
}

function setPreview(dir) {
  lastPreviewDir = dir;
  setEdgeHighlight(dir);
}

function handlePointerDown(e) {
  if (state.locked) return;
  pointerStart = { x: e.clientX, y: e.clientY };
  lastPreviewDir = null;
  setEdgeHighlight(null);
}

function handlePointerMove(e) {
  if (!pointerStart || state.locked) return;
  if (e.cancelable) e.preventDefault();
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  const dir = directionFromVector(dx, dy);
  setPreview(dir);
}

function handlePointerUp() {
  if (pointerStart && lastPreviewDir) {
    performMove(lastPreviewDir);
  }
  pointerStart = null;
  setEdgeHighlight(null);
}

function handleKeyDown(e) {
  if (!e.key.startsWith("Arrow")) return;
  e.preventDefault();
  keyboardKeys.add(e.key);
  const dir = directionFromKeys(keyboardKeys);
  setPreview(dir);
}

function handleKeyUp(e) {
  if (!e.key.startsWith("Arrow")) return;
  e.preventDefault();
  keyboardKeys.delete(e.key);
  if (keyboardKeys.size === 0) {
    if (lastPreviewDir) performMove(lastPreviewDir);
    setPreview(null);
  }
}

function setupInput() {
  const target = document;
  target.addEventListener("pointerdown", handlePointerDown);
  target.addEventListener("pointermove", handlePointerMove);
  target.addEventListener("pointerup", handlePointerUp);
  target.addEventListener("pointercancel", handlePointerUp);
  target.addEventListener("pointerleave", handlePointerUp);

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
}

function init() {
  computeLayout();
  buildCells();
  computeEdges();
  ensureEdgeSvg();
  ensureStoneTextureInfo();
  setupInput();
  document.getElementById("new-game").addEventListener("click", requestNewGame);

  loadHighScore();
  loadBestTile();
  if (loadSavedGame()) {
    hideMessage();
    updateGoalText();
    renderTiles({ newIds: state.tiles.map((t) => t.id) });
    lastShownScore = state.score; // resuming — don't bump as if just scored
    updateHud();
  } else {
    updateGoalText();
    resetGame();
  }

  fitTitle();
  // The blackletter font loads asynchronously; re-fit once it's ready so we
  // measure with the real glyph widths rather than the fallback serif.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitTitle);
  }
}

window.addEventListener("resize", () => {
  computeLayout();
  buildCells();
  computeEdges();
  ensureEdgeSvg();
  renderTiles();
  fitTitle();
});

init();

