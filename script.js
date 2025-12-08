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

const valuesOrder = [1, 2, 3, 4, 5, 6, 66, 666, 777, 888, 999, 999999];
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
const bestTileEl = document.getElementById("best-tile");
const taglineEl = document.getElementById("tagline");

const cellEls = new Map();
const tileEls = new Map();
// Legacy highlight divs are no longer used for visuals; we now draw highlights via SVG.
const highlightEls = new Map();
const directionEdges = new Map();

const state = {
  tiles: [],
  score: 0,
  bestTile: 0,
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

function updateGoalText() {
  if (!taglineEl) return;
  if (state.satanSummoned) {
    taglineEl.textContent = "You summoned Satan. Reach 999,999 to kill Satan.";
  } else {
    taglineEl.innerHTML = 'Hex-based 2048. Reach 666 to <s>win</s> summon Satan.';
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

    el.textContent = formatTileValue(tile.value);
    el.className = `tile ${valueClass(tile.value)}`;
    if (newIds.includes(tile.id)) el.classList.add("new");
    if (mergedIds.includes(tile.id)) el.classList.add("merged");

    el.style.setProperty("--x", `${pos.x}px`);
    el.style.setProperty("--y", `${pos.y}px`);
  });
}

function updateHud() {
  scoreEl.textContent = state.score;
  bestTileEl.textContent = state.bestTile;
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
    state.tiles = plan.finalTiles.map((t) => ({ ...t, justMerged: undefined }));
    state.score += plan.scoreGain;
    state.bestTile = Math.max(
      state.bestTile,
      ...state.tiles.map((t) => t.value)
    );
    const newIds = [];
    const best = state.bestTile;
    const spawnCount = best >= 666 ? 2 : 1;

    for (let i = 0; i < spawnCount; i++) {
      const id = spawnRandomTile();
      if (id != null) newIds.push(id);
    }

    renderTiles({
      newIds,
      mergedIds: plan.mergedNewIds,
    });
    updateHud();

    const justSummoned =
      !state.satanSummoned &&
      state.bestTile >= 666 &&
      state.bestTile < 999999;

    if (checkWin()) {
      showMessage("You killed Satan. Victory!");
    } else if (justSummoned) {
      state.satanSummoned = true;
      updateGoalText();
      showMessage("You have summoned Satan. Two tiles now spawn after each move. Reach 999,999 to kill Satan.", {
        autoFade: false,
        dismissible: true,
      });
    } else if (!hasMoves()) {
      showMessage("No moves left. Try again.");
    } else {
      hideMessage();
    }
    state.locked = false;
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
  setupInput();
  document.getElementById("new-game").addEventListener("click", resetGame);
   updateGoalText();
  resetGame();
}

window.addEventListener("resize", () => {
  computeLayout();
  buildCells();
  computeEdges();
  ensureEdgeSvg();
  renderTiles();
});

init();

