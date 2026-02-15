import { Link } from 'react-router'
import './GameCard.css'

interface GameCardProps {
  title: string
  description: string
  path: string
  emoji: string
}

function GameCard({ title, description, path, emoji }: GameCardProps) {
  return (
    <Link to={path} className="game-card">
      <div className="game-card-emoji">{emoji}</div>
      <div className="game-card-info">
        <h2 className="game-card-title">{title}</h2>
        <p className="game-card-desc">{description}</p>
      </div>
      <span className="game-card-play">Play →</span>
    </Link>
  )
}

export default GameCard
