import { useRef, useEffect, useCallback, useState } from "react";
import "./MatchThree.css";

// ── Types ──────────────────────────────────────────────────
interface GameSettings {
  timeLimit: number; // seconds
  gridSize: number; // cells per row/col
  gemTypes: number; // number of distinct gem colors
}

interface CellPos {
  row: number;
  col: number;
}

interface FallInfo {
  col: number;
  toRow: number;
  fromRow: number; // negative values = new gem entering from above
  gemType: number;
}

interface ScoreFloater {
  x: number;
  y: number;
  text: string;
  start: number;
}

type Difficulty = "easy" | "medium" | "hard";
type GameState = "menu" | "playing" | "paused" | "gameover";
type AnimState = "idle" | "swapping" | "swapping-back" | "clearing" | "falling";

// ── Constants ─────────────────────────────────────────────
const PRESETS: Record<Difficulty, GameSettings> = {
  easy: { timeLimit: 180, gridSize: 7, gemTypes: 5 },
  medium: { timeLimit: 120, gridSize: 8, gemTypes: 6 },
  hard: { timeLimit: 90, gridSize: 9, gemTypes: 7 },
};

const GEM_COLORS = [
  { light: "#ff7b90", dark: "#c02040" }, // Red
  { light: "#ffc560", dark: "#d08800" }, // Orange
  { light: "#fff180", dark: "#c8b800" }, // Yellow
  { light: "#80ff98", dark: "#28c050" }, // Green
  { light: "#80c0ff", dark: "#2878c0" }, // Blue
  { light: "#c080e0", dark: "#7840a0" }, // Purple
  { light: "#ff99cc", dark: "#e04890" }, // Pink
];

const SWAP_MS = 200;
const CLEAR_MS = 250;
const FALL_MS = 300;
const HINT_DELAY = 5000;
const FLOATER_MS = 900;

// ── Pure helpers ──────────────────────────────────────────
function randomGem(n: number): number {
  return Math.floor(Math.random() * n);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ── Board algorithms ──────────────────────────────────────
function createBoard(size: number, types: number): number[][] {
  const g: number[][] = [];
  for (let r = 0; r < size; r++) {
    g[r] = [];
    for (let c = 0; c < size; c++) {
      let gem: number;
      do {
        gem = randomGem(types);
      } while (
        (c >= 2 && g[r][c - 1] === gem && g[r][c - 2] === gem) ||
        (r >= 2 && g[r - 1][c] === gem && g[r - 2][c] === gem)
      );
      g[r][c] = gem;
    }
  }
  return g;
}

interface MatchGroup {
  cells: CellPos[];
}

function findMatches(grid: number[][]): MatchGroup[] {
  const n = grid.length;
  const matches: MatchGroup[] = [];

  // horizontal
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      const t = grid[r][c];
      if (t < 0) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < n && grid[r][end] === t) end++;
      if (end - c >= 3) {
        const cells: CellPos[] = [];
        for (let i = c; i < end; i++) cells.push({ row: r, col: i });
        matches.push({ cells });
      }
      c = end;
    }
  }

  // vertical
  for (let c = 0; c < n; c++) {
    let r = 0;
    while (r < n) {
      const t = grid[r][c];
      if (t < 0) {
        r++;
        continue;
      }
      let end = r + 1;
      while (end < n && grid[end][c] === t) end++;
      if (end - r >= 3) {
        const cells: CellPos[] = [];
        for (let i = r; i < end; i++) cells.push({ row: i, col: c });
        matches.push({ cells });
      }
      r = end;
    }
  }

  return matches;
}

function getMatchedSet(matches: MatchGroup[]): Set<string> {
  const s = new Set<string>();
  for (const m of matches) for (const c of m.cells) s.add(`${c.row},${c.col}`);
  return s;
}

function applyGravity(
  grid: number[][],
  types: number,
): { newGrid: number[][]; fallData: FallInfo[] } {
  const n = grid.length;
  const newGrid: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(-1),
  );
  const fallData: FallInfo[] = [];

  for (let c = 0; c < n; c++) {
    const existing: { row: number; type: number }[] = [];
    for (let r = n - 1; r >= 0; r--) {
      if (grid[r][c] >= 0) existing.push({ row: r, type: grid[r][c] });
    }

    let write = n - 1;
    for (const { row: fromRow, type } of existing) {
      newGrid[write][c] = type;
      if (fromRow !== write) {
        fallData.push({ col: c, toRow: write, fromRow, gemType: type });
      }
      write--;
    }

    const numNew = write + 1;
    for (let i = write; i >= 0; i--) {
      const type = randomGem(types);
      newGrid[i][c] = type;
      fallData.push({ col: c, toRow: i, fromRow: i - numNew, gemType: type });
    }
  }

  return { newGrid, fallData };
}

function wouldMatch(
  grid: number[][],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const n = grid.length;
  const t1 = grid[r1][c1];
  const t2 = grid[r2][c2];
  if (t1 === t2) return false;

  // temporarily swap
  grid[r1][c1] = t2;
  grid[r2][c2] = t1;

  let found = false;

  // check around (r1,c1) which now holds t2
  let left = c1,
    right = c1;
  while (left > 0 && grid[r1][left - 1] === t2) left--;
  while (right < n - 1 && grid[r1][right + 1] === t2) right++;
  if (right - left + 1 >= 3) found = true;

  if (!found) {
    let top = r1,
      bot = r1;
    while (top > 0 && grid[top - 1][c1] === t2) top--;
    while (bot < n - 1 && grid[bot + 1][c1] === t2) bot++;
    if (bot - top + 1 >= 3) found = true;
  }

  // check around (r2,c2) which now holds t1
  if (!found) {
    let left2 = c2,
      right2 = c2;
    while (left2 > 0 && grid[r2][left2 - 1] === t1) left2--;
    while (right2 < n - 1 && grid[r2][right2 + 1] === t1) right2++;
    if (right2 - left2 + 1 >= 3) found = true;
  }

  if (!found) {
    let top2 = r2,
      bot2 = r2;
    while (top2 > 0 && grid[top2 - 1][c2] === t1) top2--;
    while (bot2 < n - 1 && grid[bot2 + 1][c2] === t1) bot2++;
    if (bot2 - top2 + 1 >= 3) found = true;
  }

  // swap back
  grid[r1][c1] = t1;
  grid[r2][c2] = t2;
  return found;
}

function findValidMove(grid: number[][]): CellPos[] | null {
  const n = grid.length;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c < n - 1 && wouldMatch(grid, r, c, r, c + 1))
        return [
          { row: r, col: c },
          { row: r, col: c + 1 },
        ];
      if (r < n - 1 && wouldMatch(grid, r, c, r + 1, c))
        return [
          { row: r, col: c },
          { row: r + 1, col: c },
        ];
    }
  }
  return null;
}

function shuffleBoard(grid: number[][], types: number): number[][] {
  const n = grid.length;
  for (let attempt = 0; attempt < 100; attempt++) {
    const flat = grid.flat();
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    const ng: number[][] = [];
    for (let r = 0; r < n; r++) ng[r] = flat.slice(r * n, (r + 1) * n);
    if (findMatches(ng).length === 0 && findValidMove(ng) !== null) return ng;
  }
  return createBoard(n, types);
}

function calcScore(matches: MatchGroup[], cascade: number): number {
  let total = 0;
  for (const m of matches) {
    const len = m.cells.length;
    if (len <= 3) total += 50;
    else if (len === 4) total += 150;
    else total += 300;
  }
  return total * cascade;
}

// ── Drawing helpers ───────────────────────────────────────
function drawGem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  gemType: number,
  scale = 1,
  alpha = 1,
) {
  if (gemType < 0 || gemType >= GEM_COLORS.length) return;
  const color = GEM_COLORS[gemType];
  const pad = Math.max(1, cellSize * 0.08);
  const size = (cellSize - pad * 2) * scale;
  const cx = x + cellSize / 2;
  const cy = y + cellSize / 2;
  const gx = cx - size / 2;
  const gy = cy - size / 2;
  const r = Math.max(2, size * 0.22);

  ctx.globalAlpha = alpha;

  // gradient body
  const grad = ctx.createLinearGradient(gx, gy, gx, gy + size);
  grad.addColorStop(0, color.light);
  grad.addColorStop(1, color.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(gx, gy, size, size, r);
  ctx.fill();

  // shine
  ctx.fillStyle = `rgba(255,255,255,0.30)`;
  ctx.beginPath();
  ctx.ellipse(
    cx - size * 0.16,
    cy - size * 0.16,
    size * 0.18,
    size * 0.1,
    -0.5,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // inner shape
  drawInnerShape(ctx, cx, cy, size * 0.16, gemType);

  ctx.globalAlpha = 1;
}

function drawInnerShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  type: number,
) {
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  switch (type % 7) {
    case 0: // circle
      ctx.beginPath();
      ctx.arc(cx, cy, s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: {
      // diamond
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 2: {
      // star
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 === 0 ? s : s * 0.42;
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const px = cx + Math.cos(a) * rr,
          py = cy + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 3: {
      // triangle
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy + s * 0.7);
      ctx.lineTo(cx - s, cy + s * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 4: // square
      ctx.fillRect(cx - s * 0.7, cy - s * 0.7, s * 1.4, s * 1.4);
      break;
    case 5: {
      // hexagon
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        const px = cx + Math.cos(a) * s,
          py = cy + Math.sin(a) * s;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 6: {
      // cross
      const w = s * 0.38;
      ctx.fillRect(cx - w, cy - s, w * 2, s * 2);
      ctx.fillRect(cx - s, cy - w, s * 2, w * 2);
      break;
    }
  }
}

// ── Component ─────────────────────────────────────────────
function MatchThree() {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [settings, setSettings] = useState<GameSettings>({ ...PRESETS.medium });
  const [gameState, setGameState] = useState<GameState>("menu");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [best, setBest] = useState(() => {
    const v = localStorage.getItem("match3-best");
    return v ? parseInt(v, 10) : 0;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>("menu");
  const settingsRef = useRef<GameSettings>(settings);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const layoutRef = useRef({ offsetX: 0, offsetY: 0, cellSize: 1 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    cell: CellPos;
  } | null>(null);

  const gameRef = useRef({
    grid: [] as number[][],
    score: 0,
    timeRemaining: 0,
    cascadeLevel: 0,
    selected: null as CellPos | null,
    animState: "idle" as AnimState,
    animStart: 0,
    swapFrom: { row: 0, col: 0 } as CellPos,
    swapTo: { row: 0, col: 0 } as CellPos,
    matchedCells: new Set<string>(),
    fallData: [] as FallInfo[],
    lastInteraction: 0,
    lastTickTime: 0,
    hintMove: null as CellPos[] | null,
    floaters: [] as ScoreFloater[],
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const selectDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d);
    setSettings({ ...PRESETS[d] });
  }, []);

  const initGame = useCallback(() => {
    const s = settingsRef.current;
    let grid = createBoard(s.gridSize, s.gemTypes);
    if (!findValidMove(grid)) grid = shuffleBoard(grid, s.gemTypes);
    gameRef.current = {
      grid,
      score: 0,
      timeRemaining: s.timeLimit,
      cascadeLevel: 0,
      selected: null,
      animState: "idle",
      animStart: 0,
      swapFrom: { row: 0, col: 0 },
      swapTo: { row: 0, col: 0 },
      matchedCells: new Set(),
      fallData: [],
      lastInteraction: performance.now(),
      lastTickTime: 0,
      hintMove: null,
      floaters: [],
    };
    setDisplayScore(0);
    setDisplayTime(s.timeLimit);
  }, []);

  const startGame = useCallback(() => {
    initGame();
    stateRef.current = "playing";
    setGameState("playing");
  }, [initGame]);

  const togglePause = useCallback(() => {
    if (stateRef.current === "playing") {
      stateRef.current = "paused";
      setGameState("paused");
    } else if (stateRef.current === "paused") {
      gameRef.current.lastTickTime = 0; // avoid time jump
      stateRef.current = "playing";
      setGameState("playing");
    }
  }, []);

  const backToMenu = useCallback(() => {
    stateRef.current = "menu";
    setGameState("menu");
  }, []);

  const playAgain = useCallback(() => {
    initGame();
    stateRef.current = "playing";
    setGameState("playing");
  }, [initGame]);

  // ── Main render loop ──
  useEffect(() => {
    if (gameState === "menu") return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      const rect = container!.getBoundingClientRect();
      canvas!.width = rect.width;
      canvas!.height = rect.height;
    }
    resize();
    window.addEventListener("resize", resize);

    // ── Helpers: convert client coords → grid cell ──
    function clientToCell(clientX: number, clientY: number): CellPos | null {
      const rect = canvas!.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const { offsetX, offsetY, cellSize } = layoutRef.current;
      const gs = settingsRef.current.gridSize;
      const col = Math.floor((x - offsetX) / cellSize);
      const row = Math.floor((y - offsetY) / cellSize);
      if (row < 0 || row >= gs || col < 0 || col >= gs) return null;
      return { row, col };
    }

    // ── Tap handler (small movement / no drag) ──
    function handleTap(clientX: number, clientY: number) {
      if (stateRef.current !== "playing") return;
      const game = gameRef.current;
      if (game.animState !== "idle") return;

      const cell = clientToCell(clientX, clientY);
      if (!cell) {
        game.selected = null;
        return;
      }

      game.lastInteraction = performance.now();
      game.hintMove = null;

      if (!game.selected) {
        game.selected = cell;
        return;
      }

      const sel = game.selected;
      if (sel.row === cell.row && sel.col === cell.col) {
        game.selected = null;
        return;
      }

      if (Math.abs(sel.row - cell.row) + Math.abs(sel.col - cell.col) === 1) {
        game.swapFrom = { ...sel };
        game.swapTo = cell;
        game.animState = "swapping";
        game.animStart = performance.now();
        game.selected = null;
      } else {
        game.selected = cell;
      }
    }

    // ── Drag/swipe handler (significant movement) ──
    function handleSwipe(startCell: CellPos, dx: number, dy: number) {
      if (stateRef.current !== "playing") return;
      const game = gameRef.current;
      if (game.animState !== "idle") return;

      const gs = settingsRef.current.gridSize;
      let targetRow = startCell.row;
      let targetCol = startCell.col;

      if (Math.abs(dx) > Math.abs(dy)) {
        targetCol += dx > 0 ? 1 : -1;
      } else {
        targetRow += dy > 0 ? 1 : -1;
      }

      if (targetRow < 0 || targetRow >= gs || targetCol < 0 || targetCol >= gs)
        return;

      game.lastInteraction = performance.now();
      game.hintMove = null;
      game.selected = null;
      game.swapFrom = { ...startCell };
      game.swapTo = { row: targetRow, col: targetCol };
      game.animState = "swapping";
      game.animStart = performance.now();
    }

    const DRAG_THRESHOLD = 10;

    // ── Drag start (shared by mouse + touch) ──
    function onDragStart(clientX: number, clientY: number) {
      const cell = clientToCell(clientX, clientY);
      if (cell) {
        dragRef.current = { startX: clientX, startY: clientY, cell };
      } else {
        dragRef.current = null;
      }
    }

    // ── Drag end (shared by mouse + touch) ──
    function onDragEnd(clientX: number, clientY: number) {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      const dx = clientX - drag.startX;
      const dy = clientY - drag.startY;

      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
        // Small movement → treat as a tap
        handleTap(drag.startX, drag.startY);
      } else {
        // Significant drag → swipe in the dominant direction
        handleSwipe(drag.cell, dx, dy);
      }
    }

    // ── Mouse events ──
    function onMouseDown(e: MouseEvent) {
      onDragStart(e.clientX, e.clientY);
    }
    function onMouseUp(e: MouseEvent) {
      onDragEnd(e.clientX, e.clientY);
    }

    // ── Touch events ──
    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      const t = e.touches[0];
      onDragStart(t.clientX, t.clientY);
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault(); // prevent scrolling while dragging on the grid
    }
    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      const t = e.changedTouches[0];
      onDragEnd(t.clientX, t.clientY);
    }

    // ── Keyboard ──
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        if (stateRef.current === "playing" || stateRef.current === "paused")
          togglePause();
      }
    }

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    window.addEventListener("keydown", onKey);

    // ── Animation state machine + draw ──
    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      const now = performance.now();
      const game = gameRef.current;
      const gs = settingsRef.current.gridSize;

      frameRef.current++;

      // ── Timer ──
      if (stateRef.current === "playing") {
        if (game.lastTickTime > 0) {
          const dt = (now - game.lastTickTime) / 1000;
          if (dt < 0.5) game.timeRemaining -= dt;
        }
        game.lastTickTime = now;

        if (game.timeRemaining <= 0) {
          game.timeRemaining = 0;
          stateRef.current = "gameover";
          setGameState("gameover");
          const cur = parseInt(
            localStorage.getItem("match3-best") || "0",
            10,
          );
          if (game.score > cur) {
            localStorage.setItem("match3-best", String(game.score));
            setBest(game.score);
          }
        }
      } else {
        game.lastTickTime = 0;
      }

      setDisplayTime(Math.ceil(Math.max(0, game.timeRemaining)));

      // ── Animation transitions ──
      if (game.animState === "swapping" && now - game.animStart >= SWAP_MS) {
        const { grid, swapFrom: sf, swapTo: st } = game;
        [grid[sf.row][sf.col], grid[st.row][st.col]] = [
          grid[st.row][st.col],
          grid[sf.row][sf.col],
        ];
        const matches = findMatches(grid);
        if (matches.length > 0) {
          game.matchedCells = getMatchedSet(matches);
          game.cascadeLevel = 1;
          const pts = calcScore(matches, game.cascadeLevel);
          game.score += pts;
          setDisplayScore(game.score);
          addFloaters(game, matches, pts, now);
          game.animState = "clearing";
          game.animStart = now;
        } else {
          [grid[sf.row][sf.col], grid[st.row][st.col]] = [
            grid[st.row][st.col],
            grid[sf.row][sf.col],
          ];
          game.animState = "swapping-back";
          game.animStart = now;
        }
      }

      if (
        game.animState === "swapping-back" &&
        now - game.animStart >= SWAP_MS
      ) {
        game.animState = "idle";
      }

      if (game.animState === "clearing" && now - game.animStart >= CLEAR_MS) {
        for (const key of game.matchedCells) {
          const [r, c] = key.split(",").map(Number);
          game.grid[r][c] = -1;
        }
        const { newGrid, fallData } = applyGravity(
          game.grid,
          settingsRef.current.gemTypes,
        );
        game.grid = newGrid;
        game.fallData = fallData;
        game.matchedCells = new Set();
        game.animState = "falling";
        game.animStart = now;
      }

      if (game.animState === "falling" && now - game.animStart >= FALL_MS) {
        const matches = findMatches(game.grid);
        if (matches.length > 0) {
          game.matchedCells = getMatchedSet(matches);
          game.cascadeLevel++;
          const pts = calcScore(matches, game.cascadeLevel);
          game.score += pts;
          setDisplayScore(game.score);
          addFloaters(game, matches, pts, now);
          game.animState = "clearing";
          game.animStart = now;
        } else {
          game.cascadeLevel = 0;
          if (!findValidMove(game.grid)) {
            game.grid = shuffleBoard(game.grid, settingsRef.current.gemTypes);
          }
          game.animState = "idle";
          game.hintMove = null;
        }
      }

      // ── Layout ──
      const timerBarH = 6;
      const topReserve = timerBarH + 20;
      const cellSize = Math.floor(Math.min(w - 16, h - topReserve - 8) / gs);
      const gridPx = cellSize * gs;
      const offsetX = Math.floor((w - gridPx) / 2);
      const offsetY = Math.floor((h - gridPx) / 2) + Math.floor(topReserve / 2);
      layoutRef.current = { offsetX, offsetY, cellSize };

      // ── Clear ──
      ctx.fillStyle = "#0f0f1a";
      ctx.fillRect(0, 0, w, h);

      // ── Timer bar ──
      const tbY = offsetY - timerBarH - 10;
      const fraction = game.timeRemaining / settingsRef.current.timeLimit;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(offsetX, tbY, gridPx, timerBarH, 3);
      ctx.fill();
      if (fraction > 0) {
        ctx.fillStyle =
          fraction > 0.5
            ? "#4aea6e"
            : fraction > 0.25
              ? "#f5c842"
              : fraction > 0.1
                ? "#f5a623"
                : "#e94560";
        ctx.beginPath();
        ctx.roundRect(offsetX, tbY, gridPx * fraction, timerBarH, 3);
        ctx.fill();
      }

      // ── Grid background ──
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX, offsetY, gridPx, gridPx);
      ctx.clip();

      for (let r = 0; r < gs; r++) {
        for (let c = 0; c < gs; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? "#1a1a32" : "#16162a";
          ctx.fillRect(
            offsetX + c * cellSize,
            offsetY + r * cellSize,
            cellSize,
            cellSize,
          );
        }
      }

      // ── Build fall lookup ──
      const fallMap = new Map<string, FallInfo>();
      if (game.animState === "falling") {
        for (const f of game.fallData) fallMap.set(`${f.toRow},${f.col}`, f);
      }

      const animT = (anim: AnimState) => {
        if (game.animState !== anim) return 0;
        return Math.min(
          1,
          (now - game.animStart) /
            (anim === "clearing"
              ? CLEAR_MS
              : anim === "falling"
                ? FALL_MS
                : SWAP_MS),
        );
      };

      // ── Draw gems ──
      for (let r = 0; r < gs; r++) {
        for (let c = 0; c < gs; c++) {
          const gemType = game.grid[r][c];
          if (gemType < 0) continue;

          const key = `${r},${c}`;

          // skip swapping gems (drawn separately)
          if (
            (game.animState === "swapping" ||
              game.animState === "swapping-back") &&
            ((r === game.swapFrom.row && c === game.swapFrom.col) ||
              (r === game.swapTo.row && c === game.swapTo.col))
          )
            continue;

          // clearing animation
          if (game.animState === "clearing" && game.matchedCells.has(key)) {
            const t = animT("clearing");
            drawGem(
              ctx,
              offsetX + c * cellSize,
              offsetY + r * cellSize,
              cellSize,
              gemType,
              1 - t * 0.6,
              1 - t,
            );
            continue;
          }

          // falling animation
          if (game.animState === "falling" && fallMap.has(key)) {
            const f = fallMap.get(key)!;
            const t = easeOut(animT("falling"));
            const visRow = f.fromRow + (f.toRow - f.fromRow) * t;
            drawGem(
              ctx,
              offsetX + c * cellSize,
              offsetY + visRow * cellSize,
              cellSize,
              gemType,
            );
            continue;
          }

          drawGem(
            ctx,
            offsetX + c * cellSize,
            offsetY + r * cellSize,
            cellSize,
            gemType,
          );
        }
      }

      // ── Draw swapping gems ──
      if (game.animState === "swapping" || game.animState === "swapping-back") {
        const sf = game.swapFrom,
          st = game.swapTo;
        const t = easeOut(animT(game.animState));
        const fX = offsetX + sf.col * cellSize;
        const fY = offsetY + sf.row * cellSize;
        const tX = offsetX + st.col * cellSize;
        const tY = offsetY + st.row * cellSize;

        if (game.animState === "swapping") {
          drawGem(
            ctx,
            fX + (tX - fX) * t,
            fY + (tY - fY) * t,
            cellSize,
            game.grid[sf.row][sf.col],
          );
          drawGem(
            ctx,
            tX + (fX - tX) * t,
            tY + (fY - tY) * t,
            cellSize,
            game.grid[st.row][st.col],
          );
        } else {
          drawGem(
            ctx,
            tX + (fX - tX) * t,
            tY + (fY - tY) * t,
            cellSize,
            game.grid[sf.row][sf.col],
          );
          drawGem(
            ctx,
            fX + (tX - fX) * t,
            fY + (tY - fY) * t,
            cellSize,
            game.grid[st.row][st.col],
          );
        }
      }

      ctx.restore(); // remove clip

      // ── Selection highlight ──
      if (
        game.selected &&
        game.animState === "idle" &&
        stateRef.current === "playing"
      ) {
        const s = game.selected;
        const pulse = Math.sin(frameRef.current * 0.1) * 0.15 + 0.85;
        const pad = Math.max(1, cellSize * 0.06);
        ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(
          offsetX + s.col * cellSize + pad,
          offsetY + s.row * cellSize + pad,
          cellSize - pad * 2,
          cellSize - pad * 2,
          Math.max(2, cellSize * 0.18),
        );
        ctx.stroke();
      }

      // ── Hint ──
      if (
        game.animState === "idle" &&
        stateRef.current === "playing" &&
        now - game.lastInteraction > HINT_DELAY
      ) {
        if (!game.hintMove) game.hintMove = findValidMove(game.grid);
        if (game.hintMove) {
          const pulse = Math.sin(frameRef.current * 0.08) * 0.2 + 0.25;
          ctx.fillStyle = `rgba(255,255,255,${pulse})`;
          for (const hc of game.hintMove) {
            ctx.beginPath();
            ctx.roundRect(
              offsetX + hc.col * cellSize + 2,
              offsetY + hc.row * cellSize + 2,
              cellSize - 4,
              cellSize - 4,
              Math.max(2, cellSize * 0.18),
            );
            ctx.fill();
          }
        }
      }

      // ── Cascade text ──
      if (
        game.cascadeLevel > 1 &&
        (game.animState === "clearing" || game.animState === "falling")
      ) {
        const pulseA = Math.sin(frameRef.current * 0.15) * 0.1 + 0.9;
        ctx.fillStyle = `rgba(245,200,66,${pulseA})`;
        ctx.font = `bold ${Math.round(cellSize * 0.6)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 3;
        const txt = `Combo x${game.cascadeLevel}!`;
        ctx.strokeText(txt, w / 2, offsetY - 30);
        ctx.fillText(txt, w / 2, offsetY - 30);
      }

      // ── Score floaters (x/y stored as grid col/row) ──
      for (let i = game.floaters.length - 1; i >= 0; i--) {
        const f = game.floaters[i];
        const age = now - f.start;
        if (age > FLOATER_MS) {
          game.floaters.splice(i, 1);
          continue;
        }
        const t = age / FLOATER_MS;
        const px = offsetX + (f.x + 0.5) * cellSize;
        const py = offsetY + (f.y + 0.5) * cellSize - t * 35;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 2;
        ctx.font = `bold ${Math.round(cellSize * 0.42)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(f.text, px, py);
        ctx.fillText(f.text, px, py);
        ctx.globalAlpha = 1;
      }

      // ── Paused overlay ──
      if (stateRef.current === "paused") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff";
        ctx.font = 'bold 40px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Paused", w / 2, h / 2 - 20);
        ctx.font = '18px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = "#aaa";
        ctx.fillText("Press Space or Esc to resume", w / 2, h / 2 + 25);
      }

      // ── Game over overlay ──
      if (stateRef.current === "gameover") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e94560";
        ctx.font = 'bold 42px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Time's Up!", w / 2, h / 2 - 30);
        ctx.fillStyle = "#fff";
        ctx.font = '24px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`Score: ${game.score}`, w / 2, h / 2 + 15);
      }

      // ── Grid border ──
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX, offsetY, gridPx, gridPx);

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [gameState, togglePause]);

  // ── Menu screen ──
  if (gameState === "menu") {
    return (
      <div className="m3-menu">
        <div className="m3-menu-panel">
          <h1 className="m3-menu-title">Match Three</h1>
          <p className="m3-menu-sub">
            Match 3 or more gems before time runs out!
          </p>

          <div className="m3-diff-buttons">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`m3-diff-btn ${difficulty === d ? "m3-diff-btn-active" : ""}`}
                onClick={() => selectDifficulty(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <div className="m3-settings-summary">
            <span>
              Time: {Math.floor(settings.timeLimit / 60)}:
              {String(settings.timeLimit % 60).padStart(2, "0")}
            </span>
            <span>
              Grid: {settings.gridSize}x{settings.gridSize}
            </span>
            <span>Colors: {settings.gemTypes}</span>
          </div>

          {best > 0 && (
            <p className="m3-best-line">
              Best Score: <span className="m3-best-val">{best}</span>
            </p>
          )}

          <button className="m3-start-btn" onClick={startGame}>
            Start Game
          </button>
        </div>
      </div>
    );
  }

  // ── Game screen ──
  const timeClass =
    displayTime <= 10
      ? "hud-time-critical"
      : displayTime <= 30
        ? "hud-time-warning"
        : "";

  return (
    <div className="m3-container" ref={containerRef}>
      <canvas ref={canvasRef} className="m3-canvas" />

      <div className="m3-hud">
        <span className="m3-hud-item">Score: {displayScore}</span>
        <span className={`m3-hud-item m3-hud-time ${timeClass}`}>
          {Math.floor(displayTime / 60)}:
          {String(displayTime % 60).padStart(2, "0")}
        </span>
        <span className="m3-hud-item m3-hud-best">Best: {best}</span>
        {gameState === "playing" && (
          <button className="m3-hud-pause" onClick={togglePause}>
            Pause
          </button>
        )}
      </div>

      {gameState === "paused" && (
        <div className="m3-overlay">
          <button className="m3-overlay-btn" onClick={togglePause}>
            Resume
          </button>
          <button
            className="m3-overlay-btn m3-overlay-btn-sec"
            onClick={backToMenu}
          >
            Quit to Menu
          </button>
        </div>
      )}

      {gameState === "gameover" && (
        <div className="m3-overlay">
          <button className="m3-overlay-btn" onClick={playAgain}>
            Play Again
          </button>
          <button
            className="m3-overlay-btn m3-overlay-btn-sec"
            onClick={backToMenu}
          >
            Back to Menu
          </button>
        </div>
      )}
    </div>
  );
}

// ── Floater helper (outside component to avoid closure issues) ──
function addFloaters(
  game: { floaters: ScoreFloater[]; grid: number[][] },
  matches: MatchGroup[],
  pts: number,
  now: number,
) {
  // Add one floater at the average position of all matched cells.
  let sumR = 0,
    sumC = 0,
    count = 0;
  for (const m of matches)
    for (const c of m.cells) {
      sumR += c.row;
      sumC += c.col;
      count++;
    }
  if (count > 0) {
    // Store grid coords; the draw loop will convert
    game.floaters.push({
      x: sumC / count,
      y: sumR / count,
      text: `+${pts}`,
      start: now,
    });
  }
}

export default MatchThree;
