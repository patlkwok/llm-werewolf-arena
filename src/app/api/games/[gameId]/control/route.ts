import { NextResponse } from "next/server";
import { z } from "zod";
import { GameStatus } from "@/game-engine/types";
import { gameRepository } from "@/server/database";
import { getSpectatorGameView } from "@/server/game-view";

const commandSchema = z
  .object({ command: z.enum(["PAUSE", "RESUME"]) })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const repository = gameRepository();
  const state = repository.loadGame(gameId);
  if (!state) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  const parsed = commandSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid control command." },
      { status: 400 },
    );
  }
  repository.initializeControl(gameId, "PAUSED");
  repository.setRunMode(
    gameId,
    parsed.data.command === "RESUME" && state.status === GameStatus.ACTIVE
      ? "RUNNING"
      : "PAUSED",
  );
  return NextResponse.json(getSpectatorGameView(gameId));
}
