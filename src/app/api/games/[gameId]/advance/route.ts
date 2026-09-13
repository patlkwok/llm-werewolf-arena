import { NextResponse } from "next/server";
import { z } from "zod";
import { GameStatus } from "@/game-engine/types";
import { GameOrchestrator } from "@/orchestrator/orchestrator";
import { gameRepository } from "@/server/database";
import { getSpectatorGameView } from "@/server/game-view";
import { createArenaModelAdapter } from "@/server/model-runtime";

const advanceSchema = z.object({ step: z.boolean().default(false) }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const parsed = advanceSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid advance request." },
      { status: 400 },
    );
  }
  const repository = gameRepository();
  const state = repository.loadGame(gameId);
  if (!state) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  if (state.status !== GameStatus.ACTIVE) {
    repository.setRunMode(gameId, "PAUSED");
    return NextResponse.json(getSpectatorGameView(gameId));
  }
  repository.initializeControl(gameId, "PAUSED");
  if (!repository.claimAdvance(gameId, parsed.data.step)) {
    return NextResponse.json(
      { error: "The game is paused or another action is already in flight." },
      { status: 409 },
    );
  }

  try {
    const orchestrator = new GameOrchestrator(
      createArenaModelAdapter(),
      repository,
    );
    const result = await orchestrator.advanceOne(state);
    if (result.state.status === GameStatus.COMPLETE) {
      repository.setRunMode(gameId, "PAUSED");
    }
    return NextResponse.json(getSpectatorGameView(gameId));
  } catch (error) {
    repository.setRunMode(gameId, "PAUSED");
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.includes("OPENROUTER_API_KEY")
            ? "OpenRouter is not configured on this server."
            : "The next model action could not be completed.",
      },
      { status: 503 },
    );
  } finally {
    repository.releaseAdvance(gameId);
  }
}
