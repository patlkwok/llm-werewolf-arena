import {
  applyAction,
  applyFallback,
  getPendingAction,
} from "@/game-engine/engine";
import {
  GameStatus,
  type GameAction,
  type GameState,
  type PendingAction,
} from "@/game-engine/types";
import { buildPlayerObservation } from "@/observations/builder";
import { parseStructuredResponse, responseContractFor } from "@/llm/contracts";
import { buildModelMessages } from "@/llm/prompt";
import {
  AdapterFailureCategory,
  type ModelAdapter,
  type ModelResponseMetadata,
  type ModelTurnRequest,
  type SemanticAttempt,
} from "@/llm/types";
import type {
  CompleteGameResult,
  GameStateSink,
  TurnAttemptRecord,
  TurnExecutionResult,
} from "./types";

const MAX_RESPONSE_ATTEMPTS = 3;

interface SchemaValidResponse {
  action: GameAction;
  reasoning: string | null;
  callId: string;
  modelId: string;
  responseAttempt: 1 | 2 | 3;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  responseMetadata: ModelResponseMetadata | null;
}

interface SemanticResponseResult {
  response: SchemaValidResponse | null;
  attempts: TurnAttemptRecord[];
}

export class GameOrchestrator {
  constructor(
    private readonly adapter: ModelAdapter,
    private readonly stateSink?: GameStateSink,
    private readonly clock: () => number = Date.now,
  ) {}

  async advanceOne(state: GameState): Promise<TurnExecutionResult> {
    const pending = getPendingAction(state);
    if (!pending)
      throw new Error("Cannot advance a game with no pending action.");
    const player = state.players.find(
      (candidate) => candidate.id === pending.playerId,
    )!;
    const turnId = `${state.id}:${state.nextEventSequence}:${pending.kind}:${pending.playerId}`;
    const initial = await this.requestSchemaValidAction(
      state,
      pending,
      player.modelId,
      turnId,
      "INITIAL",
      null,
    );

    if (!initial.response) {
      return this.finishWithFallback(state, turnId, initial.attempts, null);
    }

    const initialApplied = applyAction(
      state,
      pending.playerId,
      initial.response.action,
    );
    if (initialApplied.ok) {
      const attempts = [
        ...initial.attempts,
        successRecord(pending, "INITIAL", initial.response),
      ];
      return this.finish({
        turnId,
        state: initialApplied.value,
        resolution: "ACTION_APPLIED",
        attempts,
        acceptedAction: initial.response.action,
        firstIllegalActionError: null,
      });
    }

    const illegalRecord = illegalActionRecord(
      pending,
      "INITIAL",
      initial.response,
      initialApplied.error,
    );
    const correction = await this.requestSchemaValidAction(
      state,
      pending,
      player.modelId,
      turnId,
      "CORRECTION",
      initialApplied.error.message,
    );
    const attempts = [
      ...initial.attempts,
      illegalRecord,
      ...correction.attempts,
    ];
    if (!correction.response) {
      return this.finishWithFallback(
        state,
        turnId,
        attempts,
        initialApplied.error,
      );
    }

    const correctedApplied = applyAction(
      state,
      pending.playerId,
      correction.response.action,
    );
    if (!correctedApplied.ok) {
      attempts.push(
        illegalActionRecord(
          pending,
          "CORRECTION",
          correction.response,
          correctedApplied.error,
        ),
      );
      return this.finishWithFallback(
        state,
        turnId,
        attempts,
        initialApplied.error,
      );
    }

    attempts.push(successRecord(pending, "CORRECTION", correction.response));
    return this.finish({
      turnId,
      state: correctedApplied.value,
      resolution: "CORRECTED_ACTION_APPLIED",
      attempts,
      acceptedAction: correction.response.action,
      firstIllegalActionError: initialApplied.error,
    });
  }

  async advanceUntilComplete(
    initialState: GameState,
    maxTurns = 500,
  ): Promise<CompleteGameResult> {
    let state = initialState;
    const turns: TurnExecutionResult[] = [];
    while (state.status === GameStatus.ACTIVE) {
      if (turns.length >= maxTurns) {
        throw new Error(
          `Game did not complete within ${maxTurns} model turns.`,
        );
      }
      const turn = await this.advanceOne(state);
      turns.push(turn);
      state = turn.state;
    }
    if (state.status !== GameStatus.COMPLETE) {
      throw new Error("Only an active game can be advanced to completion.");
    }
    return {
      state,
      turns,
      attempts: turns.flatMap((turn) => turn.attempts),
    };
  }

  private async requestSchemaValidAction(
    state: GameState,
    pending: PendingAction,
    modelId: string,
    turnId: string,
    semanticAttempt: SemanticAttempt,
    correctionError: string | null,
  ): Promise<SemanticResponseResult> {
    const attempts: TurnAttemptRecord[] = [];
    const contract = responseContractFor(pending);
    const observation = buildPlayerObservation(state, pending.playerId);

    for (let attempt = 1; attempt <= MAX_RESPONSE_ATTEMPTS; attempt += 1) {
      const responseAttempt = attempt as 1 | 2 | 3;
      const callId = `${turnId}:${semanticAttempt.toLowerCase()}:${responseAttempt}`;
      const request: ModelTurnRequest = {
        callId,
        turnId,
        gameId: state.id,
        playerId: pending.playerId,
        modelId,
        action: structuredClone(pending),
        observation,
        semanticAttempt,
        responseAttempt,
        correctionError,
        schemaName: contract.schemaName,
        responseJsonSchema: contract.jsonSchema,
        messages: buildModelMessages(
          observation,
          pending,
          contract.jsonSchema,
          semanticAttempt,
          correctionError,
        ),
      };

      const startedAt = this.clock();
      let adapterResult;
      try {
        adapterResult = await this.adapter.requestAction(request);
      } catch (error) {
        const completedAt = this.clock();
        attempts.push(
          failedAttemptRecord(
            pending,
            callId,
            modelId,
            semanticAttempt,
            responseAttempt,
            AdapterFailureCategory.PROVIDER_ERROR,
            error instanceof Error
              ? error.message
              : "The model adapter threw an unknown error.",
            startedAt,
            completedAt,
          ),
        );
        continue;
      }
      const completedAt = this.clock();

      if (!adapterResult.ok) {
        attempts.push(
          failedAttemptRecord(
            pending,
            callId,
            modelId,
            semanticAttempt,
            responseAttempt,
            adapterResult.category,
            adapterResult.message,
            startedAt,
            completedAt,
          ),
        );
        continue;
      }

      const parsed = parseStructuredResponse(pending, adapterResult.output);
      if (!parsed.ok) {
        attempts.push(
          failedAttemptRecord(
            pending,
            callId,
            modelId,
            semanticAttempt,
            responseAttempt,
            parsed.category,
            parsed.message,
            startedAt,
            completedAt,
            adapterResult.reasoning ?? null,
            adapterResult.metadata ?? null,
          ),
        );
        continue;
      }

      return {
        response: {
          action: parsed.action,
          reasoning: adapterResult.reasoning ?? null,
          callId,
          modelId,
          responseAttempt,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          responseMetadata: adapterResult.metadata ?? null,
        },
        attempts,
      };
    }

    return { response: null, attempts };
  }

  private async finishWithFallback(
    state: GameState,
    turnId: string,
    attempts: TurnAttemptRecord[],
    firstIllegalActionError: TurnExecutionResult["firstIllegalActionError"],
  ): Promise<TurnExecutionResult> {
    const fallback = applyFallback(state);
    if (!fallback.ok) {
      throw new Error(`Engine fallback failed: ${fallback.error.message}`);
    }
    return this.finish({
      turnId,
      state: fallback.value,
      resolution: "FALLBACK_APPLIED",
      attempts,
      acceptedAction: null,
      firstIllegalActionError,
    });
  }

  private async finish(
    result: TurnExecutionResult,
  ): Promise<TurnExecutionResult> {
    await this.stateSink?.saveGame(result.state);
    await this.stateSink?.saveTurnExecution?.(result.state.id, result);
    return result;
  }
}

function failedAttemptRecord(
  pending: PendingAction,
  callId: string,
  modelId: string,
  semanticAttempt: SemanticAttempt,
  responseAttempt: 1 | 2 | 3,
  outcome: TurnAttemptRecord["outcome"],
  message: string,
  startedAt: number,
  completedAt: number,
  reasoning: string | null = null,
  responseMetadata: ModelResponseMetadata | null = null,
): TurnAttemptRecord {
  return {
    callId,
    playerId: pending.playerId,
    modelId,
    actionKind: pending.kind,
    semanticAttempt,
    responseAttempt,
    outcome,
    message,
    structuredAction: null,
    reasoning,
    startedAt,
    completedAt,
    latencyMs: Math.max(0, completedAt - startedAt),
    responseMetadata,
  };
}

function successRecord(
  pending: PendingAction,
  semanticAttempt: SemanticAttempt,
  response: SchemaValidResponse,
): TurnAttemptRecord {
  return {
    callId: response.callId,
    playerId: pending.playerId,
    modelId: response.modelId,
    actionKind: pending.kind,
    semanticAttempt,
    responseAttempt: response.responseAttempt,
    outcome: "SUCCESS",
    message: null,
    structuredAction: response.action,
    reasoning: response.reasoning,
    startedAt: response.startedAt,
    completedAt: response.completedAt,
    latencyMs: response.latencyMs,
    responseMetadata: response.responseMetadata,
  };
}

function illegalActionRecord(
  pending: PendingAction,
  semanticAttempt: SemanticAttempt,
  response: SchemaValidResponse,
  error: { message: string },
): TurnAttemptRecord {
  return {
    callId: response.callId,
    playerId: pending.playerId,
    modelId: response.modelId,
    actionKind: pending.kind,
    semanticAttempt,
    responseAttempt: response.responseAttempt,
    outcome: "ILLEGAL_ACTION",
    message: error.message,
    structuredAction: response.action,
    reasoning: response.reasoning,
    startedAt: response.startedAt,
    completedAt: response.completedAt,
    latencyMs: response.latencyMs,
    responseMetadata: response.responseMetadata,
  };
}
