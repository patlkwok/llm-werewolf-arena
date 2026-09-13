"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameSummary } from "@/persistence/repository";

export function HistoryList({ initialGames }: { initialGames: GameSummary[] }) {
  const [games, setGames] = useState(initialGames);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function deleteGame(gameId: string) {
    if (!window.confirm("Delete this saved game permanently?")) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed.");
      setGames((current) => current.filter((game) => game.id !== gameId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm("Delete every saved game permanently?")) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/games", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "History could not be cleared.");
      setGames([]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "History could not be cleared.",
      );
    } finally {
      setPending(false);
    }
  }

  if (games.length === 0) {
    return (
      <div className="empty-history">
        <h2>No stories yet.</h2>
        <p>Completed and in-progress games will remain available here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="history-actions">
        <button type="button" disabled={pending} onClick={clearHistory}>
          Clear all history
        </button>
      </div>
      {notice && (
        <div className="arena-notice" role="alert">
          {notice}
        </div>
      )}
      <div className="history-list">
        {games.map((game) => (
          <article key={game.id}>
            <Link href={`/games/${game.id}`}>
              <div>
                <span>{statusLabel(game)}</span>
                <strong>{gameLabel(game)}</strong>
                <small>{game.playerNames.join(" · ")}</small>
              </div>
              <time dateTime={new Date(game.updatedAt).toISOString()}>
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(game.updatedAt)}
              </time>
            </Link>
            <button
              type="button"
              disabled={pending}
              aria-label={`Delete saved game ${game.id}`}
              onClick={() => void deleteGame(game.id)}
            >
              Delete
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function statusLabel(game: GameSummary): string {
  if (game.status === "COMPLETE") return "Complete";
  if (game.status === "ABANDONED") return "Ended by operator";
  return "In progress";
}

function gameLabel(game: GameSummary): string {
  if (game.winner) {
    return `${game.winner === "VILLAGE" ? "Village" : "Werewolves"} won`;
  }
  if (game.status === "ABANDONED") return "Game ended early";
  return game.phase.replaceAll("_", " ").toLocaleLowerCase("en-US");
}
