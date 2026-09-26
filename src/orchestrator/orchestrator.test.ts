import { describe, expect, it } from "vitest";
import { getPendingAction } from "@/game-engine/engine";
import { fallback, playerWithRole, testGame } from "@/game-engine/test-helpers";
import { GameStatus, Phase, Role, type GameState } from "@/game-engine/types";
import {
  AdapterFailureCategory,
  OpenRouterAdapter,
  RuleBasedFakeAdapter,
  ScriptedModelAdapter,
} from "@/llm";
import { openDatabase } from "@/persistence/database";
import { GameRepository } from "@/persistence/repository";
import { GameOrchestrator } from "./orchestrator";

function response(output: unknown, reasoning?: string) {
  return { type: "response" as const, output, reasoning };
}

function modelSeat(state: GameState, playerId: string): number {
  return state.players.find((player) => player.id === playerId)!.seat + 1;
}

describe("network-free game orchestrator", () => {
  it("retries three response/API failures and then uses the phase fallback", async () => {
    const state = testGame();
    const adapter = new ScriptedModelAdapter([
      response("{not json"),
      response({ action: "protect" }),
      { type: "failure", category: AdapterFailureCategory.TIMEOUT },
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);

    expect(result.resolution).toBe("FALLBACK_APPLIED");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "MALFORMED_JSON",
      "SCHEMA_INVALID",
      "TIMEOUT",
    ]);
    expect(adapter.requests.map((request) => request.responseAttempt)).toEqual([
      1, 2, 3,
    ]);
    expect(result.state.phase).toBe(Phase.NIGHT_SEER);
    expect(result.state.currentNight?.doctorTargetId).toBeNull();
  });

  it("allows exactly one correction for an illegal parsed action", async () => {
    const state = fallback(testGame());
    const seer = playerWithRole(state, Role.SEER);
    const legalTarget = getPendingAction(state)!;
    if (legalTarget.kind !== "SEER_INSPECT")
      throw new Error("Expected Seer action.");
    const adapter = new ScriptedModelAdapter([
      response({ action: "inspect", targetSeat: seer.seat + 1 }),
      response({
        action: "inspect",
        targetSeat: modelSeat(state, legalTarget.legalTargetIds[0]!),
      }),
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);

    expect(result.resolution).toBe("CORRECTED_ACTION_APPLIED");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "ILLEGAL_ACTION",
      "SUCCESS",
    ]);
    expect(result.acceptedAction).toEqual({
      action: "inspect",
      targetPlayerId: legalTarget.legalTargetIds[0],
    });
    expect(adapter.requests.map((request) => request.semanticAttempt)).toEqual([
      "INITIAL",
      "CORRECTION",
    ]);
    expect(adapter.requests[1]?.correctionError).toContain(
      "cannot inspect themselves",
    );
  });

  it("treats an out-of-range seat as an illegal move and corrects it", async () => {
    const state = testGame();
    const pending = getPendingAction(state)!;
    if (pending.kind !== "DOCTOR_PROTECT")
      throw new Error("Expected Doctor action.");
    const adapter = new ScriptedModelAdapter([
      response({ action: "protect", targetSeat: 99 }),
      response({
        action: "protect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
      }),
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "ILLEGAL_ACTION",
      "SUCCESS",
    ]);
    expect(result.acceptedAction).toEqual({
      action: "protect",
      targetPlayerId: pending.legalTargetIds[0],
    });
  });

  it("falls back after the corrected action is also illegal", async () => {
    const state = fallback(testGame());
    const seer = playerWithRole(state, Role.SEER);
    const adapter = new ScriptedModelAdapter([
      response({ action: "inspect", targetSeat: seer.seat + 1 }),
      response({ action: "inspect", targetSeat: seer.seat + 1 }),
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);

    expect(result.resolution).toBe("FALLBACK_APPLIED");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "ILLEGAL_ACTION",
      "ILLEGAL_ACTION",
    ]);
    expect(result.state.phase).toBe(Phase.NIGHT_WEREWOLF_PROPOSAL);
    expect(result.state.currentNight?.seerInspection).toBeNull();
  });

  it("keeps correction and response-failure budgets independent", async () => {
    const state = fallback(testGame());
    const seer = playerWithRole(state, Role.SEER);
    const pending = getPendingAction(state)!;
    if (pending.kind !== "SEER_INSPECT")
      throw new Error("Expected Seer action.");
    const adapter = new ScriptedModelAdapter([
      response({ action: "inspect" }),
      response("bad json"),
      response({ action: "inspect", targetSeat: seer.seat + 1 }),
      { type: "failure", category: AdapterFailureCategory.PROVIDER_ERROR },
      response("also bad"),
      response({
        action: "inspect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
      }),
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);

    expect(result.resolution).toBe("CORRECTED_ACTION_APPLIED");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "SCHEMA_INVALID",
      "MALFORMED_JSON",
      "ILLEGAL_ACTION",
      "PROVIDER_ERROR",
      "MALFORMED_JSON",
      "SUCCESS",
    ]);
    expect(adapter.requests.map((request) => request.responseAttempt)).toEqual([
      1, 2, 3, 1, 2, 3,
    ]);
  });

  it("does schema validation before game-legality validation", async () => {
    const state = fallback(testGame());
    const pending = getPendingAction(state)!;
    if (pending.kind !== "SEER_INSPECT")
      throw new Error("Expected Seer action.");
    const adapter = new ScriptedModelAdapter([
      response({ action: "inspect" }),
      response({
        action: "inspect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
      }),
    ]);
    const result = await new GameOrchestrator(adapter).advanceOne(state);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "SCHEMA_INVALID",
      "SUCCESS",
    ]);
    expect(
      adapter.requests.every(
        (request) => request.semanticAttempt === "INITIAL",
      ),
    ).toBe(true);
  });

  it("keeps provider reasoning spectator-side and out of later prompts", async () => {
    let state = testGame();
    const pending = getPendingAction(state)!;
    if (pending.kind !== "DOCTOR_PROTECT")
      throw new Error("Expected Doctor action.");
    const reasoningSecret = "SPECTATOR_ONLY_REASONING";
    const adapter = new ScriptedModelAdapter([
      response(
        {
          action: "protect",
          targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
        },
        reasoningSecret,
      ),
      response({
        action: "inspect",
        targetSeat:
          state.players.find((player) => player.role !== Role.SEER)!.seat + 1,
      }),
    ]);
    const orchestrator = new GameOrchestrator(adapter);
    const first = await orchestrator.advanceOne(state);
    state = first.state;
    expect(first.attempts.at(-1)?.reasoning).toBe(reasoningSecret);
    await orchestrator.advanceOne(state);
    expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain(
      reasoningSecret,
    );
  });

  it("requires and persists a private move explanation without sharing it with later players", async () => {
    let state = testGame({ experience: { requireMoveExplanation: true } });
    const pending = getPendingAction(state)!;
    if (pending.kind !== "DOCTOR_PROTECT")
      throw new Error("Expected Doctor action.");
    const secret = "PRIVATE_DOCTOR_PLAN";
    const adapter = new ScriptedModelAdapter([
      response({
        action: "protect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
      }),
      response({
        action: "protect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
        explanation: secret,
      }),
      response({
        action: "inspect",
        targetSeat:
          state.players.find((player) => player.role !== Role.SEER)!.seat + 1,
        explanation: "A private Seer plan.",
      }),
    ]);
    const orchestrator = new GameOrchestrator(adapter);
    const first = await orchestrator.advanceOne(state);
    expect(first.attempts.map((attempt) => attempt.outcome)).toEqual([
      "SCHEMA_INVALID",
      "SUCCESS",
    ]);
    expect(first.attempts.at(-1)?.moveExplanation).toBe(secret);
    state = first.state;
    await orchestrator.advanceOne(state);
    expect(JSON.stringify(adapter.requests[2]?.messages)).not.toContain(secret);
    expect(adapter.requests[0]?.responseJsonSchema.required).toContain(
      "explanation",
    );
  });

  it("keeps routing model IDs out of model-visible messages", async () => {
    const state = testGame();
    const pending = getPendingAction(state)!;
    if (pending.kind !== "DOCTOR_PROTECT")
      throw new Error("Expected Doctor action.");
    const player = state.players.find(
      (candidate) => candidate.id === pending.playerId,
    )!;
    player.modelId = "SECRET_ROUTING_MODEL_ID";
    const adapter = new ScriptedModelAdapter([
      response({
        action: "protect",
        targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
      }),
    ]);
    await new GameOrchestrator(adapter).advanceOne(state);
    expect(adapter.requests[0]?.modelId).toBe("SECRET_ROUTING_MODEL_ID");
    expect(JSON.stringify(adapter.requests[0]?.messages)).not.toContain(
      "SECRET_ROUTING_MODEL_ID",
    );
    expect(JSON.stringify(adapter.requests[0]?.messages)).not.toMatch(
      /"player-\d+"/,
    );
    expect(adapter.requests[0]?.responseJsonSchema.properties).toMatchObject({
      targetSeat: { type: "integer", minimum: 1 },
    });
  });

  it("runs a complete deterministic game without network calls", async () => {
    const initial = testGame({ gameId: "complete-fake-game" });
    const adapter = new RuleBasedFakeAdapter();
    const result = await new GameOrchestrator(adapter).advanceUntilComplete(
      initial,
    );

    expect(result.state.status).toBe(GameStatus.COMPLETE);
    expect(result.state.winner).not.toBeNull();
    expect(result.turns.length).toBeLessThan(500);
    expect(
      result.attempts.every((attempt) => attempt.outcome === "SUCCESS"),
    ).toBe(true);
    const roleById = new Map(
      initial.players.map((player) => [player.id, player.role]),
    );
    const nightKinds = new Set([
      "DOCTOR_PROTECT",
      "SEER_INSPECT",
      "WEREWOLF_PROPOSE",
      "WEREWOLF_RESPOND",
    ]);
    expect(
      adapter.requests
        .filter((request) => nightKinds.has(request.action.kind))
        .every((request) => roleById.get(request.playerId) !== Role.VILLAGER),
    ).toBe(true);
  });

  it("persists each successfully advanced state through an injected sink", async () => {
    const connection = openDatabase(":memory:");
    try {
      const repository = new GameRepository(connection);
      const state = testGame({ gameId: "orchestrator-persistence" });
      repository.saveGame(state, 1000);
      const pending = getPendingAction(state)!;
      if (pending.kind !== "DOCTOR_PROTECT")
        throw new Error("Expected Doctor action.");
      const adapter = new ScriptedModelAdapter([
        response({
          action: "protect",
          targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
        }),
      ]);
      const result = await new GameOrchestrator(adapter, repository).advanceOne(
        state,
      );
      expect(repository.loadGame(state.id)).toEqual(result.state);
    } finally {
      connection.close();
    }
  });

  it("persists idempotent operator telemetry without placing it in game state", async () => {
    const connection = openDatabase(":memory:");
    try {
      const repository = new GameRepository(connection);
      const state = testGame({
        gameId: "telemetry-persistence",
        experience: { requireMoveExplanation: true },
      });
      repository.saveGame(state, 1000);
      const pending = getPendingAction(state)!;
      if (pending.kind !== "DOCTOR_PROTECT")
        throw new Error("Expected Doctor action.");
      const adapter = new ScriptedModelAdapter([
        {
          type: "response",
          output: {
            action: "protect",
            targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
            explanation: "Protecting the player I trust most.",
          },
          reasoning: "operator-only reasoning",
          metadata: {
            responseId: "response-1",
            responseModelId: "resolved/model",
            providerName: "Provider A",
            reasoningDetails: [{ type: "summary", text: "detail" }],
            usage: {
              promptTokens: 100,
              completionTokens: 20,
              reasoningTokens: 5,
              cachedTokens: 3,
              cacheWriteTokens: 1,
              totalTokens: 120,
              cost: 0.001,
              upstreamInferenceCost: 0.0008,
            },
          },
        },
      ]);
      const clockValues = [10_000, 10_075];
      const result = await new GameOrchestrator(adapter, repository, () =>
        clockValues.shift()!,
      ).advanceOne(state);

      const calls = repository.listModelCalls(state.id);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        id: result.attempts[0]?.callId,
        turnId: result.turnId,
        modelId: state.players.find((player) => player.id === pending.playerId)
          ?.modelId,
        latencyMs: 75,
        outcome: "SUCCESS",
        providerName: "Provider A",
        reasoningText: null,
        moveExplanation: "Protecting the player I trust most.",
        promptTokens: 100,
        reasoningTokens: 5,
        cost: 0.001,
        fallbackApplied: false,
        correctionUsed: false,
      });
      expect(calls[0]?.reasoningDetailsJson).toBeNull();
      expect(adapter.requests[0]?.excludeReasoningFromResponse).toBe(true);
      expect(JSON.stringify(result.state)).not.toContain(
        "operator-only reasoning",
      );
      expect(JSON.stringify(result.state)).not.toContain(
        "Protecting the player I trust most.",
      );

      repository.saveTurnExecution(state.id, result);
      expect(repository.listModelCalls(state.id)).toHaveLength(1);
    } finally {
      connection.close();
    }
  });

  it("never persists the server-side OpenRouter API key", async () => {
    const connection = openDatabase(":memory:");
    try {
      const repository = new GameRepository(connection);
      const state = testGame({ gameId: "api-key-leak-test" });
      repository.saveGame(state, 1000);
      const pending = getPendingAction(state)!;
      if (pending.kind !== "DOCTOR_PROTECT")
        throw new Error("Expected Doctor action.");
      const apiKey = "SUPER_SECRET_OPENROUTER_KEY";
      let providerBody = "";
      const adapter = new OpenRouterAdapter({
        apiKey,
        fetchImpl: async (_input, init) => {
          providerBody = String(init?.body);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      action: "protect",
                      targetSeat: modelSeat(state, pending.legalTargetIds[0]!),
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });
      const result = await new GameOrchestrator(adapter, repository).advanceOne(
        state,
      );

      expect(providerBody).not.toMatch(/"player-\d+"/);
      expect(providerBody).toContain('"targetSeat"');

      expect(
        JSON.stringify({
          state: repository.loadGame(state.id),
          events: repository.listEvents(state.id),
          calls: repository.listModelCalls(state.id),
          result,
        }),
      ).not.toContain(apiKey);
    } finally {
      connection.close();
    }
  });
});
