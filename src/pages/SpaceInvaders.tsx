import { useRef, useEffect, useCallback, useState } from "react";
import "./SpaceInvaders.css";

// ── Types ──────────────────────────────────────────────────
interface GameSettings {
  rows: number;
  cols: number;
  alienSpeed: number; // base px/step
  alienDropPx: number;
  enemyFireInterval: number; // ms between enemy shots
  playerSpeed: number; // px/s
  bulletSpeed: number; // px/s
  lives: number;
  maxPlayerBullets: number;
}

interface Alien {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
  type: number; // 0=top(squid), 1=mid(crab), 2=bot(octopus)
  animFrame: number;
}

interface Bullet {
  x: number;
  y: number;
  dy: number; // negative = up (player), positive = down (enemy)
  owner: "player" | "enemy";
}

interface Shield {
  x: number;
  y: number;
  blocks: boolean[][]; // 4-row x 6-col grid of alive blocks
}

interface UFO {
  active: boolean;
  x: number;
  y: number;
  dx: number;
  w: number;
  h: number;
}

interface Star {
  x: number;
  y: number;
  brightness: number;
  twinkleSpeed: number;
}

type Difficulty = "easy" | "medium" | "hard";
type GameState = "menu" | "playing" | "paused" | "gameover";

// ── Constants ─────────────────────────────────────────────
const PRESETS: Record<Difficulty, GameSettings> = {
  easy: {
    rows: 4,
    cols: 6,
    alienSpeed: 12,
    alienDropPx: 18,
    enemyFireInterval: 1800,
    playerSpeed: 280,
    bulletSpeed: 450,
    lives: 4,
    maxPlayerBullets: 2,
  },
  medium: {
    rows: 5,
    cols: 8,
    alienSpeed: 14,
    alienDropPx: 20,
    enemyFireInterval: 1200,
    playerSpeed: 300,
    bulletSpeed: 480,
    lives: 3,
    maxPlayerBullets: 1,
  },
  hard: {
    rows: 5,
    cols: 10,
    alienSpeed: 18,
    alienDropPx: 22,
    enemyFireInterval: 800,
    playerSpeed: 320,
    bulletSpeed: 520,
    lives: 2,
    maxPlayerBullets: 1,
  },
};

const ALIEN_W = 28;
const ALIEN_H = 22;
const ALIEN_PAD_X = 10;
const ALIEN_PAD_Y = 10;
const PLAYER_W = 36;
const PLAYER_H = 22;
const BULLET_W = 3;
const BULLET_H = 10;
const SHIELD_BLOCK = 6;
const SHIELD_ROWS = 4;
const SHIELD_COLS = 8;
const UFO_W = 36;
const UFO_H = 16;
const ALIEN_POINTS = [40, 20, 10]; // type 0, 1, 2
const UFO_POINTS = 200;
const STEP_INTERVAL_BASE = 600; // ms per formation step at full count
const STEP_INTERVAL_MIN = 80;

// ── Pure helpers ──────────────────────────────────────────
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function generateStars(w: number, h: number, count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      brightness: 0.3 + Math.random() * 0.7,
      twinkleSpeed: 1 + Math.random() * 3,
    });
  }
  return stars;
}

// ── Alien drawing ─────────────────────────────────────────
function drawAlien(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  type: number, frame: number,
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h) * 0.42;

  if (type === 0) {
    // Squid – top tier, small diamond-ish
    ctx.fillStyle = "#ff4080";
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.8, cy);
    ctx.lineTo(cx + s * 0.5, cy + s * 0.7);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.7);
    ctx.lineTo(cx - s * 0.8, cy);
    ctx.closePath();
    ctx.fill();
    // tentacles
    const tOff = frame % 2 === 0 ? 2 : -2;
    ctx.fillRect(cx - s * 0.6, cy + s * 0.7, 3, 5 + tOff);
    ctx.fillRect(cx + s * 0.4, cy + s * 0.7, 3, 5 - tOff);
    // eyes
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - 4, cy - 2, 3, 3);
    ctx.fillRect(cx + 2, cy - 2, 3, 3);
  } else if (type === 1) {
    // Crab – middle tier
    ctx.fillStyle = "#60e0ff";
    const bw = s * 1.4;
    const bh = s * 0.9;
    ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
    // claws
    const cOff = frame % 2 === 0 ? -2 : 2;
    ctx.fillRect(cx - bw / 2 - 5, cy - 2 + cOff, 5, 6);
    ctx.fillRect(cx + bw / 2, cy - 2 - cOff, 5, 6);
    // eyes
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - 4, cy - bh / 2 + 3, 3, 3);
    ctx.fillRect(cx + 2, cy - bh / 2 + 3, 3, 3);
  } else {
    // Octopus – bottom tier, round-ish
    ctx.fillStyle = "#80ff60";
    ctx.beginPath();
    ctx.arc(cx, cy - 1, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // legs
    const lOff = frame % 2 === 0 ? 1 : -1;
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(cx + i * 5 - 1, cy + s * 0.5, 3, 5 + lOff * (i % 2));
    }
    // eyes
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - 4, cy - 4, 3, 3);
    ctx.fillRect(cx + 2, cy - 4, 3, 3);
  }
}

// ── Component ─────────────────────────────────────────────
function SpaceInvaders() {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [settings, setSettings] = useState<GameSettings>({ ...PRESETS.medium });
  const [gameState, setGameState] = useState<GameState>("menu");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayLives, setDisplayLives] = useState(3);
  const [displayWave, setDisplayWave] = useState(1);
  const [best, setBest] = useState(() => {
    const v = localStorage.getItem("space-invaders-best");
    return v ? parseInt(v, 10) : 0;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>("menu");
  const settingsRef = useRef<GameSettings>(settings);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const needsInitRef = useRef(false);

  const keysRef = useRef<Set<string>>(new Set());

  const gameRef = useRef({
    aliens: [] as Alien[],
    bullets: [] as Bullet[],
    shields: [] as Shield[],
    ufo: { active: false, x: 0, y: 0, dx: 0, w: UFO_W, h: UFO_H } as UFO,
    stars: [] as Star[],
    playerX: 0,
    playerY: 0,
    score: 0,
    lives: 3,
    wave: 1,
    alienDir: 1 as 1 | -1,
    stepTimer: 0,
    stepInterval: STEP_INTERVAL_BASE,
    enemyFireTimer: 0,
    ufoTimer: 0,
    alienCount: 0,
    alienAnimFrame: 0,
    invincibleUntil: 0, // brief invincibility after hit
    touchLeft: false,
    touchRight: false,
    touchShoot: false,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const selectDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d);
    setSettings({ ...PRESETS[d] });
  }, []);

  // ── Init game ──
  const initGame = useCallback(
    (canvasW: number, canvasH: number, wave: number, carryScore: number, carryLives: number) => {
      const s = settingsRef.current;

      // Alien grid
      const gridW = s.cols * (ALIEN_W + ALIEN_PAD_X) - ALIEN_PAD_X;
      const startX = (canvasW - gridW) / 2;
      const startY = 60 + (wave - 1) * 8; // aliens start lower on later waves

      const aliens: Alien[] = [];
      for (let r = 0; r < s.rows; r++) {
        const type = r === 0 ? 0 : r <= Math.floor(s.rows / 2) ? 1 : 2;
        for (let c = 0; c < s.cols; c++) {
          aliens.push({
            row: r,
            col: c,
            x: startX + c * (ALIEN_W + ALIEN_PAD_X),
            y: startY + r * (ALIEN_H + ALIEN_PAD_Y),
            w: ALIEN_W,
            h: ALIEN_H,
            alive: true,
            type,
            animFrame: 0,
          });
        }
      }

      // Shields – only on wave 1
      const shields: Shield[] = [];
      if (wave === 1) {
        const shieldCount = canvasW < 400 ? 3 : 4;
        const shieldW = SHIELD_COLS * SHIELD_BLOCK;
        const totalShieldW = shieldCount * shieldW;
        const shieldGap = (canvasW - totalShieldW) / (shieldCount + 1);
        const shieldY = canvasH - 100;
        for (let i = 0; i < shieldCount; i++) {
          const blocks: boolean[][] = [];
          for (let r = 0; r < SHIELD_ROWS; r++) {
            blocks[r] = [];
            for (let cc = 0; cc < SHIELD_COLS; cc++) {
              // Arch shape: remove bottom-center blocks
              if (r >= SHIELD_ROWS - 1 && cc >= 2 && cc <= SHIELD_COLS - 3) {
                blocks[r][cc] = false;
              } else {
                blocks[r][cc] = true;
              }
            }
          }
          shields.push({
            x: shieldGap + i * (shieldW + shieldGap),
            y: shieldY,
            blocks,
          });
        }
      }

      const speedFactor = 1 + (wave - 1) * 0.12;
      const alienCount = aliens.length;

      gameRef.current = {
        aliens,
        bullets: [],
        shields: wave === 1 ? shields : gameRef.current.shields,
        ufo: { active: false, x: 0, y: 0, dx: 0, w: UFO_W, h: UFO_H },
        stars: wave === 1 ? generateStars(canvasW, canvasH, 80) : gameRef.current.stars,
        playerX: canvasW / 2 - PLAYER_W / 2,
        playerY: canvasH - 45,
        score: carryScore,
        lives: carryLives,
        wave,
        alienDir: 1,
        stepTimer: 0,
        stepInterval: Math.max(STEP_INTERVAL_MIN, STEP_INTERVAL_BASE / speedFactor),
        enemyFireTimer: 0,
        ufoTimer: 0,
        alienCount,
        alienAnimFrame: 0,
        invincibleUntil: 0,
        touchLeft: false,
        touchRight: false,
        touchShoot: false,
      };

      setDisplayScore(carryScore);
      setDisplayLives(carryLives);
      setDisplayWave(wave);
    },
    [],
  );

  const startGame = useCallback(() => {
    needsInitRef.current = true;
    stateRef.current = "playing";
    setGameState("playing");
    lastTimeRef.current = 0;
    // reset wave tracking for fresh start
    gameRef.current.wave = 0; // will be set to 1 in initGame
    gameRef.current.score = 0;
    gameRef.current.lives = settingsRef.current.lives;
  }, []);

  const togglePause = useCallback(() => {
    if (stateRef.current === "playing") {
      stateRef.current = "paused";
      setGameState("paused");
    } else if (stateRef.current === "paused") {
      lastTimeRef.current = 0;
      stateRef.current = "playing";
      setGameState("playing");
    }
  }, []);

  const backToMenu = useCallback(() => {
    stateRef.current = "menu";
    setGameState("menu");
  }, []);

  const playAgain = useCallback(() => {
    needsInitRef.current = true;
    gameRef.current.wave = 0;
    gameRef.current.score = 0;
    gameRef.current.lives = settingsRef.current.lives;
    lastTimeRef.current = 0;
    stateRef.current = "playing";
    setGameState("playing");
  }, []);

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

    // Deferred init
    if (needsInitRef.current) {
      needsInitRef.current = false;
      const s = settingsRef.current;
      initGame(canvas.width, canvas.height, 1, 0, s.lives);
    }

    // ── Input ──
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (stateRef.current === "playing" || stateRef.current === "paused")
          togglePause();
        return;
      }
      keysRef.current.add(e.key);
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key);
    }

    // Touch controls: left third = move left, right third = move right, center = shoot
    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      for (let i = 0; i < e.touches.length; i++) {
        const tx = e.touches[i].clientX - rect.left;
        const third = rect.width / 3;
        if (tx < third) gameRef.current.touchLeft = true;
        else if (tx > third * 2) gameRef.current.touchRight = true;
        else gameRef.current.touchShoot = true;
      }
    }
    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      // If no touches remain, clear all
      if (e.touches.length === 0) {
        gameRef.current.touchLeft = false;
        gameRef.current.touchRight = false;
        gameRef.current.touchShoot = false;
      }
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
    }

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let shootCooldown = 0;

    // ── Frame loop ──
    function frame(now: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      const game = gameRef.current;
      const s = settingsRef.current;

      let dt = 0;
      if (lastTimeRef.current > 0) {
        dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      }
      lastTimeRef.current = now;

      if (stateRef.current === "paused") {
        lastTimeRef.current = 0;
      }

      // ── Update ──
      if (stateRef.current === "playing" && dt > 0) {
        // Player movement
        const keys = keysRef.current;
        let moveDir = 0;
        if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || game.touchLeft) moveDir -= 1;
        if (keys.has("ArrowRight") || keys.has("d") || keys.has("D") || game.touchRight) moveDir += 1;
        game.playerX += moveDir * s.playerSpeed * dt;
        game.playerX = Math.max(4, Math.min(w - PLAYER_W - 4, game.playerX));

        // Player shooting
        shootCooldown -= dt;
        const wantsShoot = keys.has(" ") || game.touchShoot;
        if (wantsShoot && shootCooldown <= 0) {
          const playerBullets = game.bullets.filter((b) => b.owner === "player");
          if (playerBullets.length < s.maxPlayerBullets) {
            game.bullets.push({
              x: game.playerX + PLAYER_W / 2 - BULLET_W / 2,
              y: game.playerY - BULLET_H,
              dy: -s.bulletSpeed,
              owner: "player",
            });
            shootCooldown = 0.18;
          }
        }
        game.touchShoot = false; // consume tap

        // Move bullets
        for (const b of game.bullets) {
          b.y += b.dy * dt;
        }
        // Remove off-screen bullets
        game.bullets = game.bullets.filter((b) => b.y > -20 && b.y < h + 20);

        // Alien formation step
        game.stepTimer += dt * 1000;
        if (game.stepTimer >= game.stepInterval) {
          game.stepTimer = 0;
          game.alienAnimFrame = (game.alienAnimFrame + 1) % 2;

          // Check if any alive alien would go off-screen
          let needDrop = false;
          for (const a of game.aliens) {
            if (!a.alive) continue;
            const nx = a.x + game.alienDir * s.alienSpeed;
            if (nx < 4 || nx + a.w > w - 4) {
              needDrop = true;
              break;
            }
          }

          if (needDrop) {
            game.alienDir = (game.alienDir * -1) as 1 | -1;
            for (const a of game.aliens) {
              if (!a.alive) continue;
              a.y += s.alienDropPx;
              a.animFrame = game.alienAnimFrame;
            }
          } else {
            for (const a of game.aliens) {
              if (!a.alive) continue;
              a.x += game.alienDir * s.alienSpeed;
              a.animFrame = game.alienAnimFrame;
            }
          }
        }

        // Enemy fire
        game.enemyFireTimer += dt * 1000;
        const fireInterval = Math.max(300, s.enemyFireInterval - (game.wave - 1) * 80);
        if (game.enemyFireTimer >= fireInterval) {
          game.enemyFireTimer = 0;
          // Find bottom-most alive alien per column, pick one at random
          const bottomAliens: Alien[] = [];
          const colBottom = new Map<number, Alien>();
          for (const a of game.aliens) {
            if (!a.alive) continue;
            const existing = colBottom.get(a.col);
            if (!existing || a.row > existing.row) colBottom.set(a.col, a);
          }
          colBottom.forEach((a) => bottomAliens.push(a));
          if (bottomAliens.length > 0) {
            const shooter = bottomAliens[Math.floor(Math.random() * bottomAliens.length)];
            game.bullets.push({
              x: shooter.x + shooter.w / 2 - BULLET_W / 2,
              y: shooter.y + shooter.h,
              dy: s.bulletSpeed * 0.65,
              owner: "enemy",
            });
          }
        }

        // UFO
        game.ufoTimer += dt * 1000;
        if (!game.ufo.active && game.ufoTimer > 12000 + Math.random() * 8000) {
          game.ufoTimer = 0;
          const fromLeft = Math.random() > 0.5;
          game.ufo = {
            active: true,
            x: fromLeft ? -UFO_W : w,
            y: 28,
            dx: fromLeft ? 120 : -120,
            w: UFO_W,
            h: UFO_H,
          };
        }
        if (game.ufo.active) {
          game.ufo.x += game.ufo.dx * dt;
          if (game.ufo.x < -UFO_W - 10 || game.ufo.x > w + 10) {
            game.ufo.active = false;
          }
        }

        // ── Collisions ──

        // Player bullets vs aliens
        for (let bi = game.bullets.length - 1; bi >= 0; bi--) {
          const b = game.bullets[bi];
          if (b.owner !== "player") continue;
          for (const a of game.aliens) {
            if (!a.alive) continue;
            if (rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, a.x, a.y, a.w, a.h)) {
              a.alive = false;
              game.bullets.splice(bi, 1);
              game.alienCount--;
              game.score += ALIEN_POINTS[a.type] * game.wave;
              setDisplayScore(game.score);
              // Speed up formation
              const total = s.rows * s.cols;
              const ratio = game.alienCount / total;
              const speedFactor = (1 + (game.wave - 1) * 0.12) * (1 + (1 - ratio) * 2.5);
              game.stepInterval = Math.max(
                STEP_INTERVAL_MIN,
                STEP_INTERVAL_BASE / speedFactor,
              );
              break;
            }
          }
        }

        // Player bullets vs UFO
        if (game.ufo.active) {
          for (let bi = game.bullets.length - 1; bi >= 0; bi--) {
            const b = game.bullets[bi];
            if (b.owner !== "player") continue;
            if (rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, game.ufo.x, game.ufo.y, game.ufo.w, game.ufo.h)) {
              game.ufo.active = false;
              game.bullets.splice(bi, 1);
              game.score += UFO_POINTS * game.wave;
              setDisplayScore(game.score);
              break;
            }
          }
        }

        // Bullets vs shields
        for (let bi = game.bullets.length - 1; bi >= 0; bi--) {
          const b = game.bullets[bi];
          let hit = false;
          for (const sh of game.shields) {
            const shW = SHIELD_COLS * SHIELD_BLOCK;
            const shH = SHIELD_ROWS * SHIELD_BLOCK;
            if (!rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, sh.x, sh.y, shW, shH)) continue;
            // Check individual blocks
            const localX = b.x + BULLET_W / 2 - sh.x;
            const localY = b.y + (b.dy < 0 ? 0 : BULLET_H) - sh.y;
            const bc = Math.floor(localX / SHIELD_BLOCK);
            const br = Math.floor(localY / SHIELD_BLOCK);
            if (br >= 0 && br < SHIELD_ROWS && bc >= 0 && bc < SHIELD_COLS && sh.blocks[br][bc]) {
              sh.blocks[br][bc] = false;
              // Also damage a neighbor for more visible erosion
              const nbc = bc + (Math.random() > 0.5 ? 1 : -1);
              if (nbc >= 0 && nbc < SHIELD_COLS && sh.blocks[br][nbc]) {
                sh.blocks[br][nbc] = false;
              }
              game.bullets.splice(bi, 1);
              hit = true;
              break;
            }
          }
          if (hit) continue;
        }

        // Enemy bullets vs player
        if (now > game.invincibleUntil) {
          for (let bi = game.bullets.length - 1; bi >= 0; bi--) {
            const b = game.bullets[bi];
            if (b.owner !== "enemy") continue;
            if (rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, game.playerX, game.playerY, PLAYER_W, PLAYER_H)) {
              game.bullets.splice(bi, 1);
              game.lives--;
              setDisplayLives(game.lives);
              game.invincibleUntil = now + 1500;
              if (game.lives <= 0) {
                stateRef.current = "gameover";
                setGameState("gameover");
                const cur = parseInt(localStorage.getItem("space-invaders-best") || "0", 10);
                if (game.score > cur) {
                  localStorage.setItem("space-invaders-best", String(game.score));
                  setBest(game.score);
                }
              }
              break;
            }
          }
        }

        // Aliens reached player row
        for (const a of game.aliens) {
          if (a.alive && a.y + a.h >= game.playerY) {
            stateRef.current = "gameover";
            setGameState("gameover");
            const cur = parseInt(localStorage.getItem("space-invaders-best") || "0", 10);
            if (game.score > cur) {
              localStorage.setItem("space-invaders-best", String(game.score));
              setBest(game.score);
            }
            break;
          }
        }

        // All aliens dead → next wave
        if (game.alienCount <= 0 && stateRef.current === "playing") {
          const nextWave = game.wave + 1;
          initGame(w, h, nextWave, game.score, game.lives);
        }
      }

      // ── Draw ──
      // Background
      ctx.fillStyle = "#06060f";
      ctx.fillRect(0, 0, w, h);

      // Stars
      const time = now / 1000;
      for (const star of game.stars) {
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * star.twinkleSpeed + star.x));
        ctx.fillStyle = `rgba(255,255,255,${star.brightness * twinkle})`;
        ctx.fillRect(star.x, star.y, 1.5, 1.5);
      }

      // Shields
      for (const sh of game.shields) {
        for (let r = 0; r < SHIELD_ROWS; r++) {
          for (let c = 0; c < SHIELD_COLS; c++) {
            if (!sh.blocks[r][c]) continue;
            ctx.fillStyle = "#40e860";
            ctx.fillRect(
              sh.x + c * SHIELD_BLOCK,
              sh.y + r * SHIELD_BLOCK,
              SHIELD_BLOCK - 1,
              SHIELD_BLOCK - 1,
            );
          }
        }
      }

      // Aliens
      for (const a of game.aliens) {
        if (!a.alive) continue;
        drawAlien(ctx, a.x, a.y, a.w, a.h, a.type, a.animFrame);
      }

      // UFO
      if (game.ufo.active) {
        const u = game.ufo;
        ctx.fillStyle = "#e94560";
        ctx.beginPath();
        ctx.ellipse(u.x + u.w / 2, u.y + u.h * 0.6, u.w / 2, u.h * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        // dome
        ctx.fillStyle = "#ff6b81";
        ctx.beginPath();
        ctx.ellipse(u.x + u.w / 2, u.y + u.h * 0.35, u.w * 0.25, u.h * 0.35, 0, Math.PI, 0);
        ctx.fill();
        // lights
        const lPhase = Math.sin(now / 100) > 0;
        ctx.fillStyle = lPhase ? "#ffe680" : "#ff9060";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(u.x + u.w * 0.25 + i * u.w * 0.25, u.y + u.h * 0.65, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Bullets
      for (const b of game.bullets) {
        if (b.owner === "player") {
          ctx.fillStyle = "#60e0ff";
          ctx.shadowColor = "#60e0ff";
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = "#ff6040";
          ctx.shadowColor = "#ff6040";
          ctx.shadowBlur = 4;
        }
        ctx.fillRect(b.x, b.y, BULLET_W, BULLET_H);
      }
      ctx.shadowBlur = 0;

      // Player
      if (stateRef.current !== "menu") {
        const px = game.playerX;
        const py = game.playerY;
        // Blinking when invincible
        const invincible = now < game.invincibleUntil;
        if (!invincible || Math.floor(now / 100) % 2 === 0) {
          // Ship body
          ctx.fillStyle = "#4a9eff";
          ctx.beginPath();
          ctx.moveTo(px + PLAYER_W / 2, py);
          ctx.lineTo(px + PLAYER_W, py + PLAYER_H);
          ctx.lineTo(px, py + PLAYER_H);
          ctx.closePath();
          ctx.fill();
          // Cockpit
          ctx.fillStyle = "#60e0ff";
          ctx.beginPath();
          ctx.moveTo(px + PLAYER_W / 2, py + 5);
          ctx.lineTo(px + PLAYER_W * 0.65, py + PLAYER_H - 4);
          ctx.lineTo(px + PLAYER_W * 0.35, py + PLAYER_H - 4);
          ctx.closePath();
          ctx.fill();
          // Engine glow
          const flicker = 0.6 + Math.random() * 0.4;
          ctx.fillStyle = `rgba(255,160,40,${flicker})`;
          ctx.beginPath();
          ctx.moveTo(px + PLAYER_W * 0.35, py + PLAYER_H);
          ctx.lineTo(px + PLAYER_W * 0.65, py + PLAYER_H);
          ctx.lineTo(px + PLAYER_W / 2, py + PLAYER_H + 6 + Math.random() * 4);
          ctx.closePath();
          ctx.fill();
        }
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
        ctx.fillText("Press Esc or P to resume", w / 2, h / 2 + 25);
      }

      // ── Game over overlay ──
      if (stateRef.current === "gameover") {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e94560";
        ctx.font = 'bold 42px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Game Over!", w / 2, h / 2 - 40);
        ctx.fillStyle = "#fff";
        ctx.font = '22px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`Score: ${game.score}`, w / 2, h / 2 + 5);
        ctx.fillStyle = "#aaa";
        ctx.font = '16px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`Wave ${game.wave}`, w / 2, h / 2 + 35);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [gameState, togglePause, initGame]);

  // ── Menu screen ──
  if (gameState === "menu") {
    return (
      <div className="si-menu">
        <div className="si-menu-panel">
          <h1 className="si-menu-title">Space Invaders</h1>
          <p className="si-menu-sub">
            Defend Earth! Destroy the alien invasion before they reach you.
          </p>

          <div className="si-diff-buttons">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`si-diff-btn ${difficulty === d ? "si-diff-btn-active" : ""}`}
                onClick={() => selectDifficulty(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <div className="si-settings-summary">
            <span>Grid: {settings.rows}x{settings.cols}</span>
            <span>Lives: {settings.lives}</span>
          </div>

          {best > 0 && (
            <p className="si-best-line">
              Best Score: <span className="si-best-val">{best}</span>
            </p>
          )}

          <button className="si-start-btn" onClick={startGame}>
            Start Game
          </button>
        </div>
      </div>
    );
  }

  // ── Game screen ──
  return (
    <div className="si-container" ref={containerRef}>
      <canvas ref={canvasRef} className="si-canvas" />

      <div className="si-hud">
        <span className="si-hud-item">Score: {displayScore}</span>
        <span className="si-hud-item si-hud-wave">Wave {displayWave}</span>
        <span className="si-hud-item si-hud-lives">
          {"♥".repeat(displayLives)}
        </span>
        <span className="si-hud-item si-hud-best">Best: {best}</span>
        {gameState === "playing" && (
          <button className="si-hud-pause" onClick={togglePause}>
            Pause
          </button>
        )}
      </div>

      {gameState === "paused" && (
        <div className="si-overlay">
          <button className="si-overlay-btn" onClick={togglePause}>
            Resume
          </button>
          <button
            className="si-overlay-btn si-overlay-btn-sec"
            onClick={backToMenu}
          >
            Quit to Menu
          </button>
        </div>
      )}

      {gameState === "gameover" && (
        <div className="si-overlay">
          <button className="si-overlay-btn" onClick={playAgain}>
            Play Again
          </button>
          <button
            className="si-overlay-btn si-overlay-btn-sec"
            onClick={backToMenu}
          >
            Back to Menu
          </button>
        </div>
      )}
    </div>
  );
}

export default SpaceInvaders;
