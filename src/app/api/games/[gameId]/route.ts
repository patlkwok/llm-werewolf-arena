import { NextResponse } from "next/server";
import { getSpectatorGameView } from "@/server/game-view";
import { gameRepository } from "@/server/database";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const view = getSpectatorGameView(gameId);
  return view
    ? NextResponse.json(view)
    : NextResponse.json({ error: "Game not found." }, { status: 404 });
}

export async function DELETE(
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
  if (!repository.loadGame(gameId)) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  repository.initializeControl(gameId, "PAUSED");
  repository.setRunMode(gameId, "PAUSED");
  if (!repository.claimAdvance(gameId, true)) {
    return NextResponse.json(
      { error: "Wait for the current action to finish before deleting." },
      { status: 409 },
    );
  }
  if (repository.deleteGame(gameId)) {
    return NextResponse.json({ deleted: true });
  }
  repository.releaseAdvance(gameId);
  return NextResponse.json(
    { error: "Game could not be deleted." },
    { status: 409 },
  );
}

function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}
