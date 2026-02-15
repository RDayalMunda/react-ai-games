import { useRef, useEffect, useCallback, useState } from "react";
import "./PixelRunner.css";

// ── Types ──────────────────────────────────────────────────
interface GameSettings {
  baseSpeed: number; // px/s
  acceleration: number; // px/s²
  gapMin: number; // min gap between platforms (px)
  gapMax: number; // max gap
  platWidthMin: number;
  platWidthMax: number;
  obstacleChance: number; // 0-1
  coinChance: number; // 0-1
  doubleJump: boolean;
}

interface Platform {
  x: number;
  y: number;
  w: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "spike" | "flyer";
  baseY: number; // for flyer sine wave
  phase: number;
}

interface Coin {
  x: number;
  y: number;
  collected: boolean;
}

interface Player {
  x: number;
  y: number;
  vy: number;
  w: number;
  h: number;
  onGround: boolean;
  jumpsLeft: number;
  jumpHeld: boolean;
  jumpHoldTime: number;
  runFrame: number;
  runTimer: number;
}

interface ParallaxLayer {
  shapes: { x: number; y: number; w: number; h: number }[];
  speed: number; // fraction of scroll speed
  color: string;
}

type Difficulty = "easy" | "medium" | "hard";
type GameState = "menu" | "playing" | "paused" | "gameover";

// ── Constants ─────────────────────────────────────────────
const PRESETS: Record<Difficulty, GameSettings> = {
  easy: {
    baseSpeed: 180,
    acceleration: 1.5,
    gapMin: 40,
    gapMax: 90,
    platWidthMin: 120,
    platWidthMax: 260,
    obstacleChance: 0.15,
    coinChance: 0.5,
    doubleJump: true,
  },
  medium: {
    baseSpeed: 230,
    acceleration: 2.5,
    gapMin: 55,
    gapMax: 120,
    platWidthMin: 90,
    platWidthMax: 200,
    obstacleChance: 0.25,
    coinChance: 0.4,
    doubleJump: true,
  },
  hard: {
    baseSpeed: 280,
    acceleration: 3.5,
    gapMin: 70,
    gapMax: 150,
    platWidthMin: 60,
    platWidthMax: 150,
    obstacleChance: 0.4,
    coinChance: 0.35,
    doubleJump: false,
  },
};

const GRAVITY = 1400; // px/s²
const JUMP_VELOCITY = -520; // px/s (initial)
const JUMP_HOLD_BOOST = -200; // extra upward while holding
const JUMP_HOLD_MAX = 0.18; // seconds you can hold for boost
const PLAYER_W = 28;
const PLAYER_H = 34;
const PLATFORM_H = 16;
const COIN_R = 8;
const COIN_SCORE = 100;
const GROUND_Y_FRAC = 0.75; // ground sits at 75% of canvas height
const SPAWN_AHEAD = 400; // generate platforms this far ahead of screen right

// ── Pure helpers ──────────────────────────────────────────
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ── Parallax generation ──────────────────────────────────
function generateParallax(w: number, h: number): ParallaxLayer[] {
  const layers: ParallaxLayer[] = [];
  // far mountains
  const far: ParallaxLayer = { shapes: [], speed: 0.1, color: "#151530" };
  for (let x = 0; x < w * 2; x += rand(60, 140)) {
    const mw = rand(80, 200);
    const mh = rand(60, 160);
    far.shapes.push({ x, y: h * 0.7 - mh, w: mw, h: mh });
  }
  layers.push(far);
  // mid hills
  const mid: ParallaxLayer = { shapes: [], speed: 0.25, color: "#1a1a3a" };
  for (let x = 0; x < w * 2; x += rand(50, 110)) {
    const mw = rand(50, 130);
    const mh = rand(30, 90);
    mid.shapes.push({ x, y: h * 0.75 - mh, w: mw, h: mh });
  }
  layers.push(mid);
  // near clouds
  const near: ParallaxLayer = {
    shapes: [],
    speed: 0.15,
    color: "rgba(255,255,255,0.03)",
  };
  for (let x = 0; x < w * 2; x += rand(100, 250)) {
    const cw = rand(60, 150);
    const ch = rand(14, 30);
    near.shapes.push({ x, y: rand(30, h * 0.35), w: cw, h: ch });
  }
  layers.push(near);
  return layers;
}

// ── Component ─────────────────────────────────────────────
function PixelRunner() {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [settings, setSettings] = useState<GameSettings>({ ...PRESETS.medium });
  const [gameState, setGameState] = useState<GameState>("menu");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayCoins, setDisplayCoins] = useState(0);
  const [best, setBest] = useState(() => {
    const v = localStorage.getItem("pixel-runner-best");
    return v ? parseInt(v, 10) : 0;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>("menu");
  const settingsRef = useRef<GameSettings>(settings);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const needsInitRef = useRef(false);

  const gameRef = useRef({
    player: {} as Player,
    platforms: [] as Platform[],
    obstacles: [] as Obstacle[],
    coins: [] as Coin[],
    scrollSpeed: 0,
    distance: 0,
    coinCount: 0,
    groundY: 0,
    parallax: [] as ParallaxLayer[],
    jumpPressed: false,
    lastPlatRight: 0, // rightmost edge of last generated platform
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const selectDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d);
    setSettings({ ...PRESETS[d] });
  }, []);

  // ── Init game state ──
  const initGame = useCallback(
    (canvasW: number, canvasH: number) => {
      const s = settingsRef.current;
      const groundY = Math.floor(canvasH * GROUND_Y_FRAC);
      const maxJumps = s.doubleJump ? 2 : 1;

      // Build initial platforms – a solid starting platform + generated ones
      const platforms: Platform[] = [];
      // starting platform under the player
      platforms.push({ x: 0, y: groundY, w: 300 });

      let lastRight = 300;
      while (lastRight < canvasW + SPAWN_AHEAD) {
        const gap = rand(s.gapMin, s.gapMax);
        const pw = rand(s.platWidthMin, s.platWidthMax);
        const py = clamp(
          groundY + rand(-60, 40),
          canvasH * 0.35,
          canvasH * 0.88,
        );
        platforms.push({ x: lastRight + gap, y: py, w: pw });
        lastRight = lastRight + gap + pw;
      }

      // Generate coins and obstacles on platforms (skip first)
      const coins: Coin[] = [];
      const obstacles: Obstacle[] = [];
      for (let i = 1; i < platforms.length; i++) {
        const p = platforms[i];
        if (Math.random() < s.coinChance) {
          const cx = p.x + p.w * rand(0.2, 0.8);
          coins.push({ x: cx, y: p.y - 30, collected: false });
        }
        if (Math.random() < s.obstacleChance) {
          if (Math.random() < 0.6) {
            // spike on platform
            const ox = p.x + p.w * rand(0.3, 0.7);
            obstacles.push({
              x: ox,
              y: p.y - 14,
              w: 14,
              h: 14,
              kind: "spike",
              baseY: 0,
              phase: 0,
            });
          } else {
            // flyer above platform
            const ox = p.x + p.w * rand(0.2, 0.8);
            const oy = p.y - rand(50, 90);
            obstacles.push({
              x: ox,
              y: oy,
              w: 20,
              h: 16,
              kind: "flyer",
              baseY: oy,
              phase: Math.random() * Math.PI * 2,
            });
          }
        }
      }

      gameRef.current = {
        player: {
          x: 80,
          y: groundY - PLAYER_H,
          vy: 0,
          w: PLAYER_W,
          h: PLAYER_H,
          onGround: true,
          jumpsLeft: maxJumps,
          jumpHeld: false,
          jumpHoldTime: 0,
          runFrame: 0,
          runTimer: 0,
        },
        platforms,
        obstacles,
        coins,
        scrollSpeed: s.baseSpeed,
        distance: 0,
        coinCount: 0,
        groundY,
        parallax: generateParallax(canvasW, canvasH),
        jumpPressed: false,
        lastPlatRight: lastRight,
      };

      setDisplayScore(0);
      setDisplayCoins(0);
    },
    [],
  );

  const startGame = useCallback(() => {
    needsInitRef.current = true;
    stateRef.current = "playing";
    setGameState("playing");
    lastTimeRef.current = 0;
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

    // Deferred init – canvas is now mounted and sized
    if (needsInitRef.current) {
      needsInitRef.current = false;
      initGame(canvas.width, canvas.height);
    }

    // ── Input ──
    function jumpStart() {
      if (stateRef.current !== "playing") return;
      gameRef.current.jumpPressed = true;
    }
    function jumpEnd() {
      const p = gameRef.current.player;
      p.jumpHeld = false;
      p.jumpHoldTime = 0;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === " " ||
        e.key === "ArrowUp" ||
        e.key === "w" ||
        e.key === "W"
      ) {
        e.preventDefault();
        if (e.repeat) return;
        if (stateRef.current === "playing") jumpStart();
      }
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (
          stateRef.current === "playing" ||
          stateRef.current === "paused"
        )
          togglePause();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (
        e.key === " " ||
        e.key === "ArrowUp" ||
        e.key === "w" ||
        e.key === "W"
      ) {
        jumpEnd();
      }
    }

    function onMouseDown(e: MouseEvent) {
      e.preventDefault();
      jumpStart();
    }
    function onMouseUp() {
      jumpEnd();
    }
    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      jumpStart();
    }
    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      jumpEnd();
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
    }

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ── Frame loop ──
    function frame(now: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      const game = gameRef.current;
      const s = settingsRef.current;

      // delta time (capped to avoid spiral of death)
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
        const player = game.player;
        const maxJumps = s.doubleJump ? 2 : 1;

        // Process jump input
        if (game.jumpPressed) {
          game.jumpPressed = false;
          if (player.jumpsLeft > 0) {
            player.vy = JUMP_VELOCITY;
            player.onGround = false;
            player.jumpsLeft--;
            player.jumpHeld = true;
            player.jumpHoldTime = 0;
          }
        }

        // Hold for higher jump
        if (player.jumpHeld) {
          player.jumpHoldTime += dt;
          if (player.jumpHoldTime < JUMP_HOLD_MAX) {
            player.vy += JUMP_HOLD_BOOST * dt;
          } else {
            player.jumpHeld = false;
          }
        }

        // Gravity
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        player.onGround = false;

        // Scroll
        const scrollDist = game.scrollSpeed * dt;
        game.distance += scrollDist;
        game.scrollSpeed += s.acceleration * dt;

        // Move world left
        for (const p of game.platforms) p.x -= scrollDist;
        for (const o of game.obstacles) {
          o.x -= scrollDist;
          if (o.kind === "flyer") {
            o.phase += dt * 3;
            o.y = o.baseY + Math.sin(o.phase) * 20;
            o.baseY -= scrollDist * 0; // flyers stay at fixed world-y relative to their platform
          }
        }
        for (const c of game.coins) c.x -= scrollDist;

        // Parallax
        for (const layer of game.parallax) {
          for (const sh of layer.shapes) {
            sh.x -= scrollDist * layer.speed;
          }
          // wrap shapes that go off left
          const maxX = Math.max(...layer.shapes.map((s) => s.x + s.w));
          for (const sh of layer.shapes) {
            if (sh.x + sh.w < -50) {
              sh.x = maxX + rand(20, 100);
            }
          }
        }

        // Platform collision (land on top only)
        for (const plat of game.platforms) {
          if (
            player.vy >= 0 &&
            player.x + player.w > plat.x + 4 &&
            player.x < plat.x + plat.w - 4 &&
            player.y + player.h >= plat.y &&
            player.y + player.h <= plat.y + PLATFORM_H + player.vy * dt + 4
          ) {
            player.y = plat.y - player.h;
            player.vy = 0;
            player.onGround = true;
            player.jumpsLeft = maxJumps;
            player.jumpHeld = false;
          }
        }

        // Obstacle collision
        for (const obs of game.obstacles) {
          const shrink = 3; // collision forgiveness
          if (
            rectsOverlap(
              player.x + shrink,
              player.y + shrink,
              player.w - shrink * 2,
              player.h - shrink * 2,
              obs.x + shrink,
              obs.y + shrink,
              obs.w - shrink * 2,
              obs.h - shrink * 2,
            )
          ) {
            // Die
            stateRef.current = "gameover";
            setGameState("gameover");
            const total =
              Math.floor(game.distance / 10) + game.coinCount * COIN_SCORE;
            const cur = parseInt(
              localStorage.getItem("pixel-runner-best") || "0",
              10,
            );
            if (total > cur) {
              localStorage.setItem("pixel-runner-best", String(total));
              setBest(total);
            }
          }
        }

        // Coin collection
        for (const coin of game.coins) {
          if (coin.collected) continue;
          const cx = coin.x;
          const cy = coin.y;
          const px = player.x + player.w / 2;
          const py = player.y + player.h / 2;
          if (Math.hypot(cx - px, cy - py) < COIN_R + 14) {
            coin.collected = true;
            game.coinCount++;
            setDisplayCoins(game.coinCount);
          }
        }

        // Remove off-screen objects
        game.platforms = game.platforms.filter((p) => p.x + p.w > -50);
        game.obstacles = game.obstacles.filter((o) => o.x + o.w > -50);
        game.coins = game.coins.filter((c) => c.x > -50);

        // Generate new platforms ahead
        // Track the rightmost platform edge
        let lastRight = 0;
        for (const p of game.platforms) {
          const r = p.x + p.w;
          if (r > lastRight) lastRight = r;
        }

        while (lastRight < w + SPAWN_AHEAD) {
          const gap = rand(s.gapMin, s.gapMax);
          const pw = rand(s.platWidthMin, s.platWidthMax);
          const py = clamp(
            game.groundY + rand(-60, 40),
            h * 0.35,
            h * 0.88,
          );
          const nx = lastRight + gap;
          game.platforms.push({ x: nx, y: py, w: pw });

          // Maybe add coin
          if (Math.random() < s.coinChance) {
            game.coins.push({
              x: nx + pw * rand(0.2, 0.8),
              y: py - rand(25, 45),
              collected: false,
            });
          }
          // Maybe add obstacle
          if (Math.random() < s.obstacleChance) {
            if (Math.random() < 0.6) {
              game.obstacles.push({
                x: nx + pw * rand(0.3, 0.7),
                y: py - 14,
                w: 14,
                h: 14,
                kind: "spike",
                baseY: 0,
                phase: 0,
              });
            } else {
              const oy = py - rand(50, 90);
              game.obstacles.push({
                x: nx + pw * rand(0.2, 0.8),
                y: oy,
                w: 20,
                h: 16,
                kind: "flyer",
                baseY: oy,
                phase: Math.random() * Math.PI * 2,
              });
            }
          }

          lastRight = nx + pw;
        }

        // Run animation
        if (player.onGround) {
          player.runTimer += dt;
          if (player.runTimer > 0.1) {
            player.runTimer = 0;
            player.runFrame = (player.runFrame + 1) % 4;
          }
        }

        // Fall death
        if (player.y > h + 50) {
          stateRef.current = "gameover";
          setGameState("gameover");
          const total =
            Math.floor(game.distance / 10) + game.coinCount * COIN_SCORE;
          const cur = parseInt(
            localStorage.getItem("pixel-runner-best") || "0",
            10,
          );
          if (total > cur) {
            localStorage.setItem("pixel-runner-best", String(total));
            setBest(total);
          }
        }

        // Update display score
        setDisplayScore(
          Math.floor(game.distance / 10) + game.coinCount * COIN_SCORE,
        );
      }

      // ── Draw ──
      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      skyGrad.addColorStop(0, "#0a0a1a");
      skyGrad.addColorStop(1, "#151530");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h);

      // Parallax layers
      for (const layer of game.parallax) {
        ctx.fillStyle = layer.color;
        for (const sh of layer.shapes) {
          ctx.beginPath();
          // draw as rounded hills / clouds
          ctx.ellipse(
            sh.x + sh.w / 2,
            sh.y + sh.h,
            sh.w / 2,
            sh.h,
            0,
            Math.PI,
            0,
          );
          ctx.fill();
        }
      }

      // Platforms
      for (const plat of game.platforms) {
        if (plat.x + plat.w < 0 || plat.x > w) continue;
        // Top surface
        const topGrad = ctx.createLinearGradient(
          0,
          plat.y,
          0,
          plat.y + PLATFORM_H,
        );
        topGrad.addColorStop(0, "#5a7d3a");
        topGrad.addColorStop(1, "#3d5a28");
        ctx.fillStyle = topGrad;
        ctx.beginPath();
        ctx.roundRect(plat.x, plat.y, plat.w, PLATFORM_H, 3);
        ctx.fill();
        // Dirt below
        ctx.fillStyle = "#6b4226";
        ctx.fillRect(plat.x + 2, plat.y + PLATFORM_H, plat.w - 4, 200);
        ctx.fillStyle = "#5a3620";
        // brick lines
        for (let by = plat.y + PLATFORM_H + 10; by < plat.y + 200; by += 14) {
          ctx.fillRect(plat.x + 2, by, plat.w - 4, 1);
        }
      }

      // Coins
      const coinPhase = (performance.now() / 300) % (Math.PI * 2);
      for (const coin of game.coins) {
        if (coin.collected) continue;
        if (coin.x < -20 || coin.x > w + 20) continue;
        const scaleX = Math.abs(Math.cos(coinPhase));
        ctx.save();
        ctx.translate(coin.x, coin.y);
        ctx.scale(scaleX, 1);
        const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, COIN_R);
        grad.addColorStop(0, "#ffe680");
        grad.addColorStop(1, "#f5a623");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
        ctx.fill();
        // inner circle
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.arc(-1, -1, COIN_R * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Obstacles
      for (const obs of game.obstacles) {
        if (obs.x + obs.w < 0 || obs.x > w) continue;
        if (obs.kind === "spike") {
          ctx.fillStyle = "#e94560";
          ctx.beginPath();
          ctx.moveTo(obs.x + obs.w / 2, obs.y);
          ctx.lineTo(obs.x + obs.w, obs.y + obs.h);
          ctx.lineTo(obs.x, obs.y + obs.h);
          ctx.closePath();
          ctx.fill();
          // highlight
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.beginPath();
          ctx.moveTo(obs.x + obs.w / 2, obs.y + 2);
          ctx.lineTo(obs.x + obs.w * 0.65, obs.y + obs.h * 0.6);
          ctx.lineTo(obs.x + obs.w * 0.35, obs.y + obs.h * 0.6);
          ctx.closePath();
          ctx.fill();
        } else {
          // flyer – a small bat/enemy
          ctx.fillStyle = "#c060e0";
          ctx.beginPath();
          ctx.ellipse(
            obs.x + obs.w / 2,
            obs.y + obs.h / 2,
            obs.w / 2,
            obs.h / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          // wings
          const wingFlap = Math.sin(performance.now() / 80) * 6;
          ctx.fillStyle = "#a040c0";
          ctx.beginPath();
          ctx.ellipse(
            obs.x - 2,
            obs.y + obs.h / 2 + wingFlap,
            8,
            4,
            -0.3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(
            obs.x + obs.w + 2,
            obs.y + obs.h / 2 - wingFlap,
            8,
            4,
            0.3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          // eyes
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(obs.x + obs.w * 0.35, obs.y + obs.h * 0.4, 2, 0, Math.PI * 2);
          ctx.arc(obs.x + obs.w * 0.65, obs.y + obs.h * 0.4, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Player
      if (stateRef.current !== "menu") {
        const p = game.player;
        // Body
        ctx.fillStyle = "#4a9eff";
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.w, p.h - 10, 4);
        ctx.fill();
        // Head
        ctx.fillStyle = "#ffd5a5";
        ctx.beginPath();
        ctx.roundRect(p.x + 4, p.y - 8, p.w - 8, 14, 4);
        ctx.fill();
        // Eyes
        ctx.fillStyle = "#222";
        ctx.fillRect(p.x + p.w - 10, p.y - 4, 3, 3);
        // Legs (animated)
        ctx.fillStyle = "#3578c4";
        if (p.onGround) {
          const legOffset = p.runFrame % 2 === 0 ? 0 : 4;
          ctx.fillRect(p.x + 4 + legOffset, p.y + p.h - 10, 7, 10);
          ctx.fillRect(p.x + p.w - 11 - legOffset, p.y + p.h - 10, 7, 10);
        } else {
          // Jumping pose – legs tucked
          ctx.fillRect(p.x + 6, p.y + p.h - 8, 6, 8);
          ctx.fillRect(p.x + p.w - 12, p.y + p.h - 8, 6, 8);
        }
        // Arm
        ctx.fillStyle = "#4a9eff";
        if (!p.onGround) {
          // Arms up while jumping
          ctx.fillRect(p.x - 4, p.y + 2, 5, 10);
          ctx.fillRect(p.x + p.w - 1, p.y + 2, 5, 10);
        } else {
          ctx.fillRect(p.x - 3, p.y + 8, 4, 12);
          ctx.fillRect(p.x + p.w - 1, p.y + 8, 4, 12);
        }
      }

      // ── Paused overlay on canvas ──
      if (stateRef.current === "paused") {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
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

      // ── Game over overlay on canvas ──
      if (stateRef.current === "gameover") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#e94560";
        ctx.font = 'bold 42px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Game Over!", w / 2, h / 2 - 30);
        ctx.fillStyle = "#fff";
        ctx.font = '24px "Segoe UI", system-ui, sans-serif';
        const total =
          Math.floor(game.distance / 10) + game.coinCount * COIN_SCORE;
        ctx.fillText(`Score: ${total}`, w / 2, h / 2 + 15);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [gameState, togglePause, initGame]);

  // ── Menu screen ──
  if (gameState === "menu") {
    return (
      <div className="pr-menu">
        <div className="pr-menu-panel">
          <h1 className="pr-menu-title">Pixel Runner</h1>
          <p className="pr-menu-sub">
            Jump across platforms, dodge obstacles, and collect coins!
          </p>

          <div className="pr-diff-buttons">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`pr-diff-btn ${difficulty === d ? "pr-diff-btn-active" : ""}`}
                onClick={() => selectDifficulty(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <div className="pr-settings-summary">
            <span>Speed: {settings.baseSpeed}</span>
            <span>Double Jump: {settings.doubleJump ? "Yes" : "No"}</span>
          </div>

          {best > 0 && (
            <p className="pr-best-line">
              Best Score: <span className="pr-best-val">{best}</span>
            </p>
          )}

          <button className="pr-start-btn" onClick={startGame}>
            Start Game
          </button>
        </div>
      </div>
    );
  }

  // ── Game screen ──
  return (
    <div className="pr-container" ref={containerRef}>
      <canvas ref={canvasRef} className="pr-canvas" />

      <div className="pr-hud">
        <span className="pr-hud-item">Score: {displayScore}</span>
        <span className="pr-hud-item pr-hud-coins">Coins: {displayCoins}</span>
        <span className="pr-hud-item pr-hud-best">Best: {best}</span>
        {gameState === "playing" && (
          <button className="pr-hud-pause" onClick={togglePause}>
            Pause
          </button>
        )}
      </div>

      {gameState === "paused" && (
        <div className="pr-overlay">
          <button className="pr-overlay-btn" onClick={togglePause}>
            Resume
          </button>
          <button
            className="pr-overlay-btn pr-overlay-btn-sec"
            onClick={backToMenu}
          >
            Quit to Menu
          </button>
        </div>
      )}

      {gameState === "gameover" && (
        <div className="pr-overlay">
          <button className="pr-overlay-btn" onClick={playAgain}>
            Play Again
          </button>
          <button
            className="pr-overlay-btn pr-overlay-btn-sec"
            onClick={backToMenu}
          >
            Back to Menu
          </button>
        </div>
      )}
    </div>
  );
}

export default PixelRunner;
