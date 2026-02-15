import { useRef, useEffect, useCallback, useState } from 'react'
import './Snake.css'

// ── Types ──────────────────────────────────────────────────
interface GameSettings {
  speed: number       // ticks per second
  gridSize: number    // cells per row/col
  wallTeleport: boolean
}

interface Point {
  x: number
  y: number
}

type Direction = 'up' | 'down' | 'left' | 'right'
type Difficulty = 'easy' | 'medium' | 'hard' | 'custom'
type GameState = 'menu' | 'playing' | 'paused' | 'gameover'

// ── Presets ────────────────────────────────────────────────
const PRESETS: Record<Exclude<Difficulty, 'custom'>, GameSettings> = {
  easy:   { speed: 8,  gridSize: 15, wallTeleport: true  },
  medium: { speed: 12, gridSize: 20, wallTeleport: false },
  hard:   { speed: 18, gridSize: 25, wallTeleport: false },
}

const DIRECTION_VECTORS: Record<Direction, Point> = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
}

// ── Helpers ────────────────────────────────────────────────
function spawnFood(gridSize: number, snake: Point[]): Point {
  const occupied = new Set(snake.map(p => `${p.x},${p.y}`))
  const free: Point[] = []
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  return free.length > 0 ? free[Math.floor(Math.random() * free.length)] : { x: 0, y: 0 }
}

// ── Drawing ────────────────────────────────────────────────
function drawGrid(
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  gridSize: number,
  offsetX: number,
  offsetY: number,
) {
  // background
  ctx.fillStyle = '#141425'
  ctx.fillRect(offsetX, offsetY, cellSize * gridSize, cellSize * gridSize)

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 1
  for (let i = 0; i <= gridSize; i++) {
    const x = offsetX + i * cellSize
    const y = offsetY + i * cellSize
    ctx.beginPath(); ctx.moveTo(x, offsetY); ctx.lineTo(x, offsetY + gridSize * cellSize); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(offsetX, y); ctx.lineTo(offsetX + gridSize * cellSize, y); ctx.stroke()
  }
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: Point[],
  cellSize: number,
  offsetX: number,
  offsetY: number,
) {
  const pad = Math.max(1, cellSize * 0.08)
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i]
    const x = offsetX + seg.x * cellSize + pad
    const y = offsetY + seg.y * cellSize + pad
    const s = cellSize - pad * 2
    const r = Math.max(2, s * 0.2)

    if (i === 0) {
      // head — brighter
      ctx.fillStyle = '#4aea6e'
      ctx.shadowColor = 'rgba(78,234,110,0.4)'
      ctx.shadowBlur = 8
    } else {
      // body — gradient from bright to darker toward tail
      const t = i / snake.length
      const g = Math.round(200 - t * 80)
      ctx.fillStyle = `rgb(46,${g},64)`
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    ctx.beginPath()
    ctx.roundRect(x, y, s, s, r)
    ctx.fill()
  }
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // eyes on head
  if (snake.length > 0) {
    const head = snake[0]
    const cx = offsetX + head.x * cellSize + cellSize / 2
    const cy = offsetY + head.y * cellSize + cellSize / 2
    const eyeR = Math.max(1.5, cellSize * 0.1)
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(cx - cellSize * 0.15, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + cellSize * 0.15, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111'
    ctx.beginPath(); ctx.arc(cx - cellSize * 0.15, cy - cellSize * 0.1, eyeR * 0.55, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + cellSize * 0.15, cy - cellSize * 0.1, eyeR * 0.55, 0, Math.PI * 2); ctx.fill()
  }
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  food: Point,
  cellSize: number,
  offsetX: number,
  offsetY: number,
  frame: number,
) {
  const cx = offsetX + food.x * cellSize + cellSize / 2
  const cy = offsetY + food.y * cellSize + cellSize / 2
  const baseR = cellSize * 0.35
  const pulse = Math.sin(frame * 0.1) * cellSize * 0.04
  const r = baseR + pulse

  ctx.shadowColor = 'rgba(233,69,96,0.5)'
  ctx.shadowBlur = 10
  ctx.fillStyle = '#e94560'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  // highlight
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2)
  ctx.fill()
}

// ── Component ──────────────────────────────────────────────
function Snake() {
  // ── Settings state ──
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [settings, setSettings] = useState<GameSettings>({ ...PRESETS.medium })
  const [gameState, setGameState] = useState<GameState>('menu')
  const [displayScore, setDisplayScore] = useState(0)
  const [best, setBest] = useState(() => {
    const saved = localStorage.getItem('snake-best')
    return saved ? parseInt(saved, 10) : 0
  })

  // ── Refs for mutable game state ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<GameState>('menu')
  const snakeRef = useRef<Point[]>([])
  const foodRef = useRef<Point>({ x: 0, y: 0 })
  const dirRef = useRef<Direction>('right')
  const nextDirRef = useRef<Direction>('right')
  const scoreRef = useRef(0)
  const frameRef = useRef(0)
  const settingsRef = useRef<GameSettings>(settings)
  const intervalRef = useRef<number>(0)
  const rafRef = useRef<number>(0)
  const touchStartRef = useRef<Point | null>(null)

  // keep settingsRef in sync
  useEffect(() => { settingsRef.current = settings }, [settings])

  // ── Difficulty change ──
  const selectDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d)
    if (d !== 'custom') {
      setSettings({ ...PRESETS[d] })
    }
  }, [])

  // ── Init / reset game ──
  const initGame = useCallback(() => {
    const gs = settingsRef.current.gridSize
    const mid = Math.floor(gs / 2)
    snakeRef.current = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ]
    dirRef.current = 'right'
    nextDirRef.current = 'right'
    scoreRef.current = 0
    frameRef.current = 0
    foodRef.current = spawnFood(gs, snakeRef.current)
    setDisplayScore(0)
  }, [])

  // ── Start game ──
  const startGame = useCallback(() => {
    initGame()
    stateRef.current = 'playing'
    setGameState('playing')
  }, [initGame])

  // ── Pause / resume ──
  const togglePause = useCallback(() => {
    if (stateRef.current === 'playing') {
      stateRef.current = 'paused'
      setGameState('paused')
    } else if (stateRef.current === 'paused') {
      stateRef.current = 'playing'
      setGameState('playing')
    }
  }, [])

  // ── Back to menu ──
  const backToMenu = useCallback(() => {
    stateRef.current = 'menu'
    setGameState('menu')
    clearInterval(intervalRef.current)
  }, [])

  // ── Play again (same settings) ──
  const playAgain = useCallback(() => {
    initGame()
    stateRef.current = 'playing'
    setGameState('playing')
  }, [initGame])

  // ── Game tick ──
  const tick = useCallback(() => {
    if (stateRef.current !== 'playing') return

    const { gridSize, wallTeleport } = settingsRef.current
    const snake = snakeRef.current
    dirRef.current = nextDirRef.current
    const vec = DIRECTION_VECTORS[dirRef.current]
    const head = snake[0]

    let newHead: Point = { x: head.x + vec.x, y: head.y + vec.y }

    // wall handling
    if (wallTeleport) {
      newHead.x = ((newHead.x % gridSize) + gridSize) % gridSize
      newHead.y = ((newHead.y % gridSize) + gridSize) % gridSize
    } else {
      if (newHead.x < 0 || newHead.x >= gridSize || newHead.y < 0 || newHead.y >= gridSize) {
        // die
        stateRef.current = 'gameover'
        setGameState('gameover')
        if (scoreRef.current > best) {
          setBest(scoreRef.current)
          localStorage.setItem('snake-best', String(scoreRef.current))
        }
        return
      }
    }

    // self collision (check against all but the tail which will be removed — unless eating)
    const willEat = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y
    const bodyToCheck = willEat ? snake : snake.slice(0, -1)
    for (const seg of bodyToCheck) {
      if (seg.x === newHead.x && seg.y === newHead.y) {
        stateRef.current = 'gameover'
        setGameState('gameover')
        if (scoreRef.current > best) {
          setBest(scoreRef.current)
          localStorage.setItem('snake-best', String(scoreRef.current))
        }
        return
      }
    }

    // move
    snake.unshift(newHead)
    if (willEat) {
      scoreRef.current++
      setDisplayScore(scoreRef.current)
      foodRef.current = spawnFood(gridSize, snake)
    } else {
      snake.pop()
    }
  }, [best])

  // ── Render loop (rAF for smooth drawing) ──
  useEffect(() => {
    if (gameState === 'menu') return

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')!

    function resize() {
      const rect = container!.getBoundingClientRect()
      canvas!.width = rect.width
      canvas!.height = rect.height
    }
    resize()
    window.addEventListener('resize', resize)

    // tick interval
    intervalRef.current = window.setInterval(tick, 1000 / settingsRef.current.speed)

    function draw() {
      const w = canvas!.width
      const h = canvas!.height
      const gs = settingsRef.current.gridSize
      const cellSize = Math.floor(Math.min(w, h) / gs)
      const gridPx = cellSize * gs
      const offsetX = Math.floor((w - gridPx) / 2)
      const offsetY = Math.floor((h - gridPx) / 2)
      frameRef.current++

      // clear
      ctx.fillStyle = '#0f0f1a'
      ctx.fillRect(0, 0, w, h)

      drawGrid(ctx, cellSize, gs, offsetX, offsetY)
      drawSnake(ctx, snakeRef.current, cellSize, offsetX, offsetY)
      drawFood(ctx, foodRef.current, cellSize, offsetX, offsetY, frameRef.current)

      // wall indicator
      if (settingsRef.current.wallTeleport) {
        ctx.strokeStyle = 'rgba(78,234,110,0.25)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.strokeRect(offsetX, offsetY, gridPx, gridPx)
        ctx.setLineDash([])
      } else {
        ctx.strokeStyle = 'rgba(233,69,96,0.5)'
        ctx.lineWidth = 3
        ctx.strokeRect(offsetX, offsetY, gridPx, gridPx)
      }

      // paused overlay
      if (stateRef.current === 'paused') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 40px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Paused', w / 2, h / 2 - 20)
        ctx.font = '18px "Segoe UI", system-ui, sans-serif'
        ctx.fillStyle = '#aaa'
        ctx.fillText('Press Space or Esc to resume', w / 2, h / 2 + 25)
      }

      // game over overlay on canvas
      if (stateRef.current === 'gameover') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#e94560'
        ctx.font = 'bold 42px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Game Over', w / 2, h / 2 - 30)
        ctx.fillStyle = '#fff'
        ctx.font = '24px "Segoe UI", system-ui, sans-serif'
        ctx.fillText(`Score: ${scoreRef.current}`, w / 2, h / 2 + 15)
      }

      // score during play
      if (stateRef.current === 'playing') {
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 3
        ctx.font = 'bold 36px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.strokeText(String(scoreRef.current), w / 2, 14)
        ctx.fillText(String(scoreRef.current), w / 2, 14)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)

    // ── Keyboard ──
    function onKey(e: KeyboardEvent) {
      const cur = dirRef.current

      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
          e.preventDefault()
          if (cur !== 'down') nextDirRef.current = 'up'
          break
        case 'ArrowDown': case 's': case 'S':
          e.preventDefault()
          if (cur !== 'up') nextDirRef.current = 'down'
          break
        case 'ArrowLeft': case 'a': case 'A':
          e.preventDefault()
          if (cur !== 'right') nextDirRef.current = 'left'
          break
        case 'ArrowRight': case 'd': case 'D':
          e.preventDefault()
          if (cur !== 'left') nextDirRef.current = 'right'
          break
        case ' ': case 'Escape':
          e.preventDefault()
          if (stateRef.current === 'playing' || stateRef.current === 'paused') {
            togglePause()
          }
          break
      }
    }

    // ── Touch / swipe ──
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY }
    }
    function onTouchEnd(e: TouchEvent) {
      if (!touchStartRef.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      touchStartRef.current = null

      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx < 20 && absDy < 20) return // too small, ignore

      const cur = dirRef.current
      if (absDx > absDy) {
        // horizontal swipe
        if (dx > 0 && cur !== 'left') nextDirRef.current = 'right'
        else if (dx < 0 && cur !== 'right') nextDirRef.current = 'left'
      } else {
        // vertical swipe
        if (dy > 0 && cur !== 'up') nextDirRef.current = 'down'
        else if (dy < 0 && cur !== 'down') nextDirRef.current = 'up'
      }
    }

    window.addEventListener('keydown', onKey)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      cancelAnimationFrame(rafRef.current)
      clearInterval(intervalRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [gameState, tick, togglePause])

  // ── Menu / Settings screen ──
  if (gameState === 'menu') {
    return (
      <div className="snake-menu">
        <div className="snake-menu-panel">
          <h1 className="snake-menu-title">Snake</h1>
          <p className="snake-menu-sub">Choose your difficulty</p>

          <div className="difficulty-buttons">
            {(['easy', 'medium', 'hard', 'custom'] as Difficulty[]).map((d) => (
              <button
                key={d}
                className={`diff-btn ${difficulty === d ? 'diff-btn-active' : ''}`}
                onClick={() => selectDifficulty(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          {difficulty === 'custom' && (
            <div className="custom-settings">
              <label className="setting-row">
                <span className="setting-label">Speed</span>
                <input
                  type="range"
                  min={4}
                  max={25}
                  value={settings.speed}
                  onChange={(e) => setSettings(s => ({ ...s, speed: Number(e.target.value) }))}
                />
                <span className="setting-value">{settings.speed}</span>
              </label>

              <label className="setting-row">
                <span className="setting-label">Grid Size</span>
                <input
                  type="range"
                  min={10}
                  max={35}
                  value={settings.gridSize}
                  onChange={(e) => setSettings(s => ({ ...s, gridSize: Number(e.target.value) }))}
                />
                <span className="setting-value">{settings.gridSize}x{settings.gridSize}</span>
              </label>

              <label className="setting-row setting-toggle-row">
                <span className="setting-label">Wall Teleport</span>
                <button
                  type="button"
                  className={`toggle-btn ${settings.wallTeleport ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => setSettings(s => ({ ...s, wallTeleport: !s.wallTeleport }))}
                >
                  {settings.wallTeleport ? 'ON' : 'OFF'}
                </button>
              </label>
            </div>
          )}

          <div className="settings-summary">
            <span>Speed: {settings.speed}</span>
            <span>Grid: {settings.gridSize}x{settings.gridSize}</span>
            <span>Walls: {settings.wallTeleport ? 'Teleport' : 'Deadly'}</span>
          </div>

          <button className="start-btn" onClick={startGame}>
            Start Game
          </button>
        </div>
      </div>
    )
  }

  // ── Game screen ──
  return (
    <div className="snake-container" ref={containerRef}>
      <canvas ref={canvasRef} className="snake-canvas" />

      {/* HUD */}
      <div className="snake-hud">
        <span className="hud-item">Score: {displayScore}</span>
        <span className="hud-item hud-best">Best: {best}</span>
        {gameState === 'playing' && (
          <button className="hud-pause-btn" onClick={togglePause}>
            Pause
          </button>
        )}
      </div>

      {/* Paused overlay buttons */}
      {gameState === 'paused' && (
        <div className="snake-overlay">
          <button className="overlay-btn" onClick={togglePause}>Resume</button>
          <button className="overlay-btn overlay-btn-secondary" onClick={backToMenu}>Quit to Menu</button>
        </div>
      )}

      {/* Game over overlay buttons */}
      {gameState === 'gameover' && (
        <div className="snake-overlay">
          <button className="overlay-btn" onClick={playAgain}>Play Again</button>
          <button className="overlay-btn overlay-btn-secondary" onClick={backToMenu}>Back to Menu</button>
        </div>
      )}
    </div>
  )
}

export default Snake
