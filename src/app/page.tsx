import { ArenaSetup } from "@/ui/arena-setup";
import Link from "next/link";
import { GameStatus } from "@/game-engine/types";
import { gameRepository } from "@/server/database";

export const dynamic = "force-dynamic";

export default function Home() {
  const activeGames = gameRepository()
    .listGames()
    .filter((game) => game.status === GameStatus.ACTIVE);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local arena · Eight autonomous players</p>
          <h1>The village is waiting.</h1>
        </div>
        <p className="lede">
          Choose the voices around the table. Hidden roles and every outcome are
          resolved by a deterministic game engine; models only decide what to
          say and which legal action to propose.
        </p>
      </header>
      <nav className="home-links" aria-label="Operator links">
        <Link href="/settings">OpenRouter settings</Link>
        <Link href="/history">Browse saved games →</Link>
      </nav>
      {activeGames.length > 0 && (
        <section className="active-games" aria-labelledby="active-games-title">
          <div>
            <p className="section-number">In progress</p>
            <h2 id="active-games-title">Ongoing games</h2>
          </div>
          <div className="active-game-list">
            {activeGames.map((game) => (
              <article key={game.id}>
                <div>
                  <strong>{stageForSummary(game)}</strong>
                  <small>{game.playerNames.join(" · ")}</small>
                </div>
                <Link href={`/games/${game.id}`}>Resume game →</Link>
              </article>
            ))}
          </div>
          <p className="quiet-note">
            Starting another game will not end these games. Each can be resumed
            independently.
          </p>
        </section>
      )}
      <ArenaSetup />
    </main>
  );
}

function stageForSummary(game: {
  phase: string;
  dayNumber: number;
  nightNumber: number;
}): string {
  return game.phase.startsWith("NIGHT_")
    ? `Night ${game.nightNumber}`
    : `Day ${game.dayNumber}`;
}
