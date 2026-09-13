import Link from "next/link";
import { gameRepository } from "@/server/database";
import { HistoryList } from "@/ui/history-list";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const games = gameRepository().listGames();
  return (
    <main className="shell history-page">
      <p className="eyebrow">Local archive</p>
      <div className="history-title">
        <h1>Saved games.</h1>
        <Link href="/">New game</Link>
      </div>
      <HistoryList initialGames={games} />
    </main>
  );
}
