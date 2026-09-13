import { NextResponse } from "next/server";
import { abortGame } from "@/game-engine/engine";
import { gameRepository } from "@/server/database";
import { getSpectatorGameView } from "@/server/game-view";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  if (crossOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403 },
    );
  }
  const { gameId } = await params;
  const repository = gameRepository();
  const state = repository.loadGame(gameId);
  if (!state) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  repository.initializeControl(gameId, "PAUSED");
  repository.setRunMode(gameId, "PAUSED");
  if (!repository.claimAdvance(gameId, true)) {
    return NextResponse.json(
      {
        error: "Wait for the current action to finish before ending the game.",
      },
      { status: 409 },
    );
  }
  try {
    const ended = abortGame(state);
    if (!ended.ok) {
      return NextResponse.json({ error: ended.error.message }, { status: 409 });
    }
    repository.saveGame(ended.value);
  } finally {
    repository.releaseAdvance(gameId);
  }
  return NextResponse.json(getSpectatorGameView(gameId));
}

function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}
