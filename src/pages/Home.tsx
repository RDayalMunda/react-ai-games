import GameCard from '../components/GameCard'
import './Home.css'

const games = [
  {
    title: 'Flappy Bird',
    description: 'Tap to fly through the pipes! A classic arcade game that tests your timing and reflexes.',
    path: '/flappy-bird',
    emoji: '🐦',
  },
  {
    title: 'Snake',
    description: 'Guide the snake, eat food, and grow longer. How long can you survive?',
    path: '/snake',
    emoji: '🐍',
  },
]

function Home() {
  return (
    <div className="home">
      <section className="home-hero">
        <h1 className="home-title">Browser Games</h1>
        <p className="home-subtitle">
          Pick a game and start playing instantly — no downloads, no installs.
        </p>
      </section>
      <section className="home-grid">
        {games.map((game) => (
          <GameCard key={game.path} {...game} />
        ))}
      </section>
    </div>
  )
}

export default Home
