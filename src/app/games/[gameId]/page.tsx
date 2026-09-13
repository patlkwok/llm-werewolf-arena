import { notFound } from "next/navigation";
import { getSpectatorGameView } from "@/server/game-view";
import { SpectatorArena } from "@/ui/spectator-arena";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const view = getSpectatorGameView(gameId);
  if (!view) notFound();
  return <SpectatorArena initialView={view} />;
}
