import { NextResponse } from "next/server";
import { z } from "zod";
import { createGame } from "@/game-engine/setup";
import { gameRepository } from "@/server/database";
import {
  arenaModelCredentialsConfigured,
  createArenaModelCatalog,
} from "@/server/model-runtime";
import { setupSubmissionSchema } from "@/ui/setup";

const requestEnvelopeSchema = z
  .object({ requestId: z.uuid(), setup: z.unknown() })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const envelope = requestEnvelopeSchema.safeParse(body);
  const submission = setupSubmissionSchema.safeParse(
    envelope.success ? envelope.data.setup : null,
  );
  if (!envelope.success || !submission.success) {
    return NextResponse.json(
      {
        error: "Game setup is invalid.",
        issues: submission.success
          ? []
          : submission.error.issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
      },
      { status: 400 },
    );
  }

  const existing = gameRepository().loadGame(envelope.data.requestId);
  if (existing) {
    const sameSetup =
      JSON.stringify(
        existing.players.map((player) => ({
          displayName: player.displayName,
          modelId: player.modelId,
        })),
      ) === JSON.stringify(submission.data.players) &&
      Object.entries(submission.data.rules).every(
        ([key, value]) =>
          existing.rules[key as keyof typeof existing.rules] === value,
      );
    return sameSetup
      ? NextResponse.json({ gameId: existing.id, status: existing.status })
      : NextResponse.json(
          { error: "This create request conflicts with an existing game." },
          { status: 409 },
        );
  }

  if (!arenaModelCredentialsConfigured()) {
    return NextResponse.json(
      {
        error: "Add an OpenRouter API key in Settings before starting a game.",
      },
      { status: 412 },
    );
  }

  let eligibleModelIds: Set<string>;
  try {
    const eligibleModels = await createArenaModelCatalog().listEligibleModels();
    eligibleModelIds = new Set(eligibleModels.map((model) => model.id));
  } catch {
    return NextResponse.json(
      { error: "Model eligibility could not be verified." },
      { status: 503 },
    );
  }
  if (
    submission.data.players.some(
      (player) => !eligibleModelIds.has(player.modelId),
    )
  ) {
    return NextResponse.json(
      { error: "One or more selected models are no longer eligible." },
      { status: 400 },
    );
  }

  const created = createGame(submission.data.players, {
    gameId: envelope.data.requestId,
    seed: seedFromRequestId(envelope.data.requestId),
    rules: submission.data.rules,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error.message }, { status: 400 });
  }

  gameRepository().saveGame(created.value);
  gameRepository().initializeControl(created.value.id, "RUNNING");
  return NextResponse.json(
    { gameId: created.value.id, status: created.value.status },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  if (crossOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403 },
    );
  }
  const repository = gameRepository();
  const claimed: string[] = [];
  for (const game of repository.listGames()) {
    repository.initializeControl(game.id, "PAUSED");
    repository.setRunMode(game.id, "PAUSED");
    if (!repository.claimAdvance(game.id, true)) {
      for (const gameId of claimed) repository.releaseAdvance(gameId);
      return NextResponse.json(
        {
          error: "Wait for running actions to finish before clearing history.",
        },
        { status: 409 },
      );
    }
    claimed.push(game.id);
  }
  return NextResponse.json({ deletedCount: repository.deleteAllGames() });
}

function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

function seedFromRequestId(requestId: string): number {
  let hash = 2_166_136_261;
  for (const character of requestId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
