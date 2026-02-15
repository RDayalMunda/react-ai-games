import { useRef, useEffect, useCallback, useState } from 'react'
import './FlappyBird.css'

// ── Constants ──────────────────────────────────────────────
const GRAVITY = 0.45
const FLAP_STRENGTH = -7.5
const PIPE_WIDTH = 60
const PIPE_GAP = 160
const PIPE_SPEED = 2.8
const PIPE_SPAWN_INTERVAL = 100 // frames
const BIRD_RADIUS = 16
const GROUND_HEIGHT = 60

// ── Types ──────────────────────────────────────────────────
interface Bird {
  x: number
  y: number
  velocity: number
  rotation: number
  wingPhase: number
}

interface Pipe {
  x: number
  gapY: number // centre of the gap
  scored: boolean
}

type GameState = 'ready' | 'playing' | 'gameover'

// ── Drawing helpers ────────────────────────────────────────
function drawBird(ctx: CanvasRenderingContext2D, bird: Bird) {
  ctx.save()
  ctx.translate(bird.x, bird.y)
  ctx.rotate(Math.min(bird.rotation, Math.PI / 4))

  // body
  ctx.beginPath()
  ctx.ellipse(0, 0, BIRD_RADIUS, BIRD_RADIUS * 0.82, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#f5c842'
  ctx.fill()
  ctx.strokeStyle = '#e0a800'
  ctx.lineWidth = 2
  ctx.stroke()

  // wing
  const wingY = Math.sin(bird.wingPhase) * 5
  ctx.beginPath()
  ctx.ellipse(-4, wingY, 10, 6, -0.3, 0, Math.PI * 2)
  ctx.fillStyle = '#f0b430'
  ctx.fill()

  // eye
  ctx.beginPath()
  ctx.arc(8, -5, 4, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(9, -5, 2, 0, Math.PI * 2)
  ctx.fillStyle = '#222'
  ctx.fill()

  // beak
  ctx.beginPath()
  ctx.moveTo(14, -1)
  ctx.lineTo(22, 2)
  ctx.lineTo(14, 5)
  ctx.closePath()
  ctx.fillStyle = '#e85d3a'
  ctx.fill()

  ctx.restore()
}

function drawPipe(ctx: CanvasRenderingContext2D, pipe: Pipe, canvasH: number) {
  const halfGap = PIPE_GAP / 2
  const topH = pipe.gapY - halfGap
  const bottomY = pipe.gapY + halfGap
  const bottomH = canvasH - GROUND_HEIGHT - bottomY

  // top pipe
  const topGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0)
  topGrad.addColorStop(0, '#2ecc40')
  topGrad.addColorStop(0.5, '#5dea6e')
  topGrad.addColorStop(1, '#2ecc40')
  ctx.fillStyle = topGrad
  ctx.fillRect(pipe.x, 0, PIPE_WIDTH, topH)
  // top cap
  ctx.fillStyle = '#27ae36'
  ctx.fillRect(pipe.x - 4, topH - 24, PIPE_WIDTH + 8, 24)
  // border
  ctx.strokeStyle = '#1a7a24'
  ctx.lineWidth = 2
  ctx.strokeRect(pipe.x, 0, PIPE_WIDTH, topH)
  ctx.strokeRect(pipe.x - 4, topH - 24, PIPE_WIDTH + 8, 24)

  // bottom pipe
  const botGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0)
  botGrad.addColorStop(0, '#2ecc40')
  botGrad.addColorStop(0.5, '#5dea6e')
  botGrad.addColorStop(1, '#2ecc40')
  ctx.fillStyle = botGrad
  ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, bottomH)
  // bottom cap
  ctx.fillStyle = '#27ae36'
  ctx.fillRect(pipe.x - 4, bottomY, PIPE_WIDTH + 8, 24)
  // border
  ctx.strokeStyle = '#1a7a24'
  ctx.lineWidth = 2
  ctx.strokeRect(pipe.x, bottomY, PIPE_WIDTH, bottomH)
  ctx.strokeRect(pipe.x - 4, bottomY, PIPE_WIDTH + 8, 24)
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, offset: number) {
  const groundY = h - GROUND_HEIGHT
  // dirt
  ctx.fillStyle = '#d2b48c'
  ctx.fillRect(0, groundY, w, GROUND_HEIGHT)
  // grass
  ctx.fillStyle = '#5dbb3f'
  ctx.fillRect(0, groundY, w, 12)
  // grass pattern
  ctx.strokeStyle = '#4aa832'
  ctx.lineWidth = 1
  for (let i = -offset % 20; i < w; i += 20) {
    ctx.beginPath()
    ctx.moveTo(i, groundY)
    ctx.lineTo(i + 10, groundY + 12)
    ctx.stroke()
  }
}

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, h - GROUND_HEIGHT)
  grad.addColorStop(0, '#4ec5f1')
  grad.addColorStop(1, '#71d6ff')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h - GROUND_HEIGHT)

  // clouds
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  const clouds = [
    { x: 80, y: 60, r: 30 },
    { x: 120, y: 50, r: 24 },
    { x: 50, y: 55, r: 20 },
    { x: 320, y: 90, r: 28 },
    { x: 360, y: 80, r: 22 },
    { x: 290, y: 85, r: 18 },
  ]
  for (const c of clouds) {
    ctx.beginPath()
    ctx.arc(c.x % w, c.y, c.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ── Component ──────────────────────────────────────────────
function FlappyBird() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [displayScore, setDisplayScore] = useState(0)
  const [best, setBest] = useState(() => {
    const saved = localStorage.getItem('flappy-best')
    return saved ? parseInt(saved, 10) : 0
  })
  const [gameState, setGameState] = useState<GameState>('ready')

  // Mutable game state kept in refs so the loop doesn't depend on React state
  const stateRef = useRef<GameState>('ready')
  const birdRef = useRef<Bird>({ x: 0, y: 0, velocity: 0, rotation: 0, wingPhase: 0 })
  const pipesRef = useRef<Pipe[]>([])
  const scoreRef = useRef(0)
  const frameRef = useRef(0)
  const groundOffsetRef = useRef(0)
  const rafRef = useRef(0)

  // Initialize / reset
  const resetGame = useCallback((w: number, h: number) => {
    birdRef.current = {
      x: w * 0.25,
      y: (h - GROUND_HEIGHT) / 2,
      velocity: 0,
      rotation: 0,
      wingPhase: 0,
    }
    pipesRef.current = []
    scoreRef.current = 0
    frameRef.current = 0
    setDisplayScore(0)
  }, [])

  const flap = useCallback(() => {
    if (stateRef.current === 'ready') {
      stateRef.current = 'playing'
      setGameState('playing')
      birdRef.current.velocity = FLAP_STRENGTH
    } else if (stateRef.current === 'playing') {
      birdRef.current.velocity = FLAP_STRENGTH
    } else {
      // gameover → restart
      const canvas = canvasRef.current
      if (canvas) resetGame(canvas.width, canvas.height)
      stateRef.current = 'ready'
      setGameState('ready')
    }
  }, [resetGame])

  // ── Main game loop ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')!

    function resize() {
      const rect = container!.getBoundingClientRect()
      canvas!.width = rect.width
      canvas!.height = rect.height
      if (stateRef.current === 'ready') {
        resetGame(canvas!.width, canvas!.height)
      }
    }
    resize()
    window.addEventListener('resize', resize)

    function loop() {
      const w = canvas!.width
      const h = canvas!.height
      const playH = h - GROUND_HEIGHT
      const bird = birdRef.current
      const pipes = pipesRef.current

      // ── Update ──────────────────────
      if (stateRef.current === 'playing') {
        // bird physics
        bird.velocity += GRAVITY
        bird.y += bird.velocity
        bird.rotation = Math.atan2(bird.velocity, 8)
        bird.wingPhase += 0.3
        frameRef.current++
        groundOffsetRef.current += PIPE_SPEED

        // spawn pipes
        if (frameRef.current % PIPE_SPAWN_INTERVAL === 0) {
          const minGapY = PIPE_GAP / 2 + 40
          const maxGapY = playH - PIPE_GAP / 2 - 40
          const gapY = minGapY + Math.random() * (maxGapY - minGapY)
          pipes.push({ x: w, gapY, scored: false })
        }

        // move pipes + score
        for (let i = pipes.length - 1; i >= 0; i--) {
          pipes[i].x -= PIPE_SPEED

          // scoring
          if (!pipes[i].scored && pipes[i].x + PIPE_WIDTH < bird.x) {
            pipes[i].scored = true
            scoreRef.current++
            setDisplayScore(scoreRef.current)
          }

          // remove off-screen
          if (pipes[i].x + PIPE_WIDTH + 8 < 0) {
            pipes.splice(i, 1)
          }
        }

        // collision
        let dead = false
        // ground / ceiling
        if (bird.y + BIRD_RADIUS > playH || bird.y - BIRD_RADIUS < 0) {
          dead = true
        }
        // pipes
        for (const p of pipes) {
          const bLeft = bird.x - BIRD_RADIUS
          const bRight = bird.x + BIRD_RADIUS
          const bTop = bird.y - BIRD_RADIUS
          const bBottom = bird.y + BIRD_RADIUS
          const pLeft = p.x - 4 // account for cap overhang
          const pRight = p.x + PIPE_WIDTH + 4
          const gapTop = p.gapY - PIPE_GAP / 2
          const gapBottom = p.gapY + PIPE_GAP / 2

          if (bRight > pLeft && bLeft < pRight) {
            if (bTop < gapTop || bBottom > gapBottom) {
              dead = true
              break
            }
          }
        }

        if (dead) {
          stateRef.current = 'gameover'
          setGameState('gameover')
          if (scoreRef.current > best) {
            setBest(scoreRef.current)
            localStorage.setItem('flappy-best', String(scoreRef.current))
          }
        }
      } else if (stateRef.current === 'ready') {
        // gentle hover animation
        bird.y = playH / 2 + Math.sin(Date.now() / 300) * 8
        bird.wingPhase += 0.15
        bird.rotation = 0
      }

      // ── Draw ────────────────────────
      drawSky(ctx!, w, h)

      // pipes
      for (const p of pipes) {
        drawPipe(ctx!, p, h)
      }

      // ground
      drawGround(ctx!, w, h, groundOffsetRef.current)

      // bird
      drawBird(ctx!, bird)

      // score
      if (stateRef.current === 'playing') {
        ctx!.fillStyle = '#fff'
        ctx!.strokeStyle = '#000'
        ctx!.lineWidth = 4
        ctx!.font = 'bold 48px "Segoe UI", system-ui, sans-serif'
        ctx!.textAlign = 'center'
        ctx!.strokeText(String(scoreRef.current), w / 2, 60)
        ctx!.fillText(String(scoreRef.current), w / 2, 60)
      }

      // overlays
      if (stateRef.current === 'ready') {
        ctx!.fillStyle = 'rgba(0,0,0,0.25)'
        ctx!.fillRect(0, 0, w, h)
        ctx!.fillStyle = '#fff'
        ctx!.font = 'bold 36px "Segoe UI", system-ui, sans-serif'
        ctx!.textAlign = 'center'
        ctx!.fillText('Flappy Bird', w / 2, playH / 2 - 70)
        ctx!.font = '20px "Segoe UI", system-ui, sans-serif'
        ctx!.fillStyle = '#ddd'
        ctx!.fillText('Tap, click, or press Space to start', w / 2, playH / 2 + 50)
      }

      if (stateRef.current === 'gameover') {
        ctx!.fillStyle = 'rgba(0,0,0,0.45)'
        ctx!.fillRect(0, 0, w, h)
        ctx!.fillStyle = '#e94560'
        ctx!.font = 'bold 40px "Segoe UI", system-ui, sans-serif'
        ctx!.textAlign = 'center'
        ctx!.fillText('Game Over', w / 2, playH / 2 - 40)
        ctx!.fillStyle = '#fff'
        ctx!.font = '24px "Segoe UI", system-ui, sans-serif'
        ctx!.fillText(`Score: ${scoreRef.current}`, w / 2, playH / 2 + 10)
        ctx!.fillStyle = '#ddd'
        ctx!.font = '18px "Segoe UI", system-ui, sans-serif'
        ctx!.fillText('Tap or press Space to restart', w / 2, playH / 2 + 55)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    // input
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        flap()
      }
    }
    function onClick() {
      flap()
    }
    function onTouch(e: TouchEvent) {
      e.preventDefault()
      flap()
    }

    window.addEventListener('keydown', onKey)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('touchstart', onTouch, { passive: false })

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('touchstart', onTouch)
    }
  }, [flap, resetGame, best])

  return (
    <div className="flappy-container" ref={containerRef}>
      <canvas ref={canvasRef} className="flappy-canvas" />
      <div className="flappy-hud">
        <span className="hud-score">Score: {displayScore}</span>
        <span className="hud-best">Best: {best}</span>
        {gameState === 'gameover' && (
          <button className="hud-restart" onClick={flap}>
            Play Again
          </button>
        )}
      </div>
    </div>
  )
}

export default FlappyBird
