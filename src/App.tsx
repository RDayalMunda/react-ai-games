import { Routes, Route, Link, useLocation } from "react-router";
import Home from "./pages/Home";
import FlappyBird from "./pages/FlappyBird";
import Snake from "./pages/Snake";
import MatchThree from "./pages/MatchThree";
import PixelRunner from "./pages/PixelRunner";
import SpaceInvaders from "./pages/SpaceInvaders";
import "./App.css";

function App() {
  const location = useLocation();
  const isHome = location.pathname === "/";

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-logo">
          <span className="logo-icon">🎮</span>
          <span className="logo-text">Browser Games</span>
        </Link>
        {!isHome && (
          <Link to="/" className="back-link">
            ← Back to Games
          </Link>
        )}
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/flappy-bird" element={<FlappyBird />} />
          <Route path="/snake" element={<Snake />} />
          <Route path="/match-three" element={<MatchThree />} />
          <Route path="/pixel-runner" element={<PixelRunner />} />
          <Route path="/space-invaders" element={<SpaceInvaders />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
