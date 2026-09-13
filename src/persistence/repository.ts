import { and, asc, desc, eq } from "drizzle-orm";
import type { GameEvent } from "@/game-engine/events";
import type { GamePlayer, GameState } from "@/game-engine/types";
import type { TurnExecutionResult } from "@/orchestrator/types";
import type { DatabaseConnection } from "./database";
import { gameControls, gameEvents, games, modelCalls, players } from "./schema";

export type PersistedGameEvent = GameEvent & { createdAt: number };
export type GameRunMode = "RUNNING" | "PAUSED";
export interface GameControl {
  gameId: string;
  mode: GameRunMode;
  inFlight: boolean;
  updatedAt: number;
}
export interface GameSummary {
  id: string;
  status: GameState["status"];
  phase: GameState["phase"];
  winner: GameState["winner"];
  dayNumber: number;
  nightNumber: number;
  playerNames: string[];
  updatedAt: number;
}

export class PersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Stored ${label} is not valid JSON.`, { cause: error });
  }
}

export class GameRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  saveGame(state: GameState, now = Date.now()): void {
    const stateJson = JSON.stringify(state);
    const rulesJson = JSON.stringify(state.rules);
    const revision = state.nextEventSequence - 1;

    this.connection.sqlite.transaction(() => {
      const existing = this.connection.db
        .select({ revision: games.revision, stateJson: games.stateJson })
        .from(games)
        .where(eq(games.id, state.id))
        .get();

      if (existing && existing.revision > revision) {
        throw new PersistenceConflictError(
          `Refusing to overwrite revision ${existing.revision} with stale revision ${revision}.`,
        );
      }
      if (existing?.revision === revision && existing.stateJson !== stateJson) {
        throw new PersistenceConflictError(
          `Revision ${revision} for game ${state.id} has conflicting state.`,
        );
      }

      this.connection.db
        .insert(games)
        .values({
          id: state.id,
          status: state.status,
          phase: state.phase,
          winner: state.winner,
          seed: state.seed,
          rulesJson,
          stateJson,
          revision,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: games.id,
          set: {
            status: state.status,
            phase: state.phase,
            winner: state.winner,
            rulesJson,
            stateJson,
            revision,
            updatedAt: now,
          },
        })
        .run();

      for (const player of state.players) {
        this.upsertPlayer(state.id, player);
      }
      for (const event of state.events) {
        this.appendEvent(state.id, event, now);
      }
    })();
  }

  loadGame(gameId: string): GameState | null {
    const row = this.connection.db
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .get();
    return row
      ? parseJson<GameState>(row.stateJson, `game ${gameId} state`)
      : null;
  }

  listGames(): GameSummary[] {
    return this.connection.db
      .select({
        id: games.id,
        status: games.status,
        phase: games.phase,
        winner: games.winner,
        stateJson: games.stateJson,
        updatedAt: games.updatedAt,
      })
      .from(games)
      .orderBy(desc(games.updatedAt))
      .all()
      .map((row) => {
        const state = parseJson<GameState>(
          row.stateJson,
          `game ${row.id} state`,
        );
        return {
          id: row.id,
          status: state.status,
          phase: state.phase,
          winner: state.winner,
          dayNumber: state.dayNumber,
          nightNumber: state.nightNumber,
          playerNames: state.players.map((player) => player.displayName),
          updatedAt: row.updatedAt,
        };
      });
  }

  deleteGame(gameId: string): boolean {
    const result = this.connection.db
      .delete(games)
      .where(eq(games.id, gameId))
      .run();
    return result.changes === 1;
  }

  deleteAllGames(): number {
    return this.connection.db.delete(games).run().changes;
  }

  listPlayers(gameId: string): GamePlayer[] {
    return this.connection.db
      .select()
      .from(players)
      .where(eq(players.gameId, gameId))
      .orderBy(asc(players.seat))
      .all()
      .map((row) => ({
        id: row.id,
        displayName: row.displayName,
        modelId: row.modelId,
        seat: row.seat,
        role: row.role as GamePlayer["role"],
        isAlive: row.isAlive,
        departure: row.departureJson
          ? parseJson<GamePlayer["departure"]>(
              row.departureJson,
              "player departure",
            )
          : null,
      }));
  }

  listEvents(gameId: string): PersistedGameEvent[] {
    return this.connection.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameId))
      .orderBy(asc(gameEvents.sequence))
      .all()
      .map(
        (row) =>
          ({
            sequence: row.sequence,
            type: row.type,
            visibility: row.visibility,
            audiencePlayerIds: parseJson(
              row.audiencePlayerIdsJson,
              "event audience",
            ),
            payload: parseJson(row.payloadJson, "event payload"),
            createdAt: row.createdAt,
          }) as PersistedGameEvent,
      );
  }

  saveTurnExecution(gameId: string, turn: TurnExecutionResult): void {
    if (turn.state.id !== gameId) {
      throw new PersistenceConflictError(
        `Turn game ${turn.state.id} does not match persistence target ${gameId}.`,
      );
    }

    this.connection.sqlite.transaction(() => {
      for (const attempt of turn.attempts) {
        const metadata = attempt.responseMetadata;
        const usage = metadata?.usage;
        const values: typeof modelCalls.$inferInsert = {
          id: attempt.callId,
          gameId,
          turnId: turn.turnId,
          playerId: attempt.playerId,
          modelId: attempt.modelId,
          actionKind: attempt.actionKind,
          semanticAttempt: attempt.semanticAttempt,
          responseAttempt: attempt.responseAttempt,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
          latencyMs: attempt.latencyMs,
          outcome: attempt.outcome,
          errorMessage: attempt.message,
          structuredActionJson: attempt.structuredAction
            ? JSON.stringify(attempt.structuredAction)
            : null,
          reasoningText: attempt.reasoning,
          reasoningDetailsJson:
            metadata?.reasoningDetails == null
              ? null
              : JSON.stringify(metadata.reasoningDetails),
          responseId: metadata?.responseId ?? null,
          responseModelId: metadata?.responseModelId ?? null,
          providerName: metadata?.providerName ?? null,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          cachedTokens: usage?.cachedTokens ?? null,
          cacheWriteTokens: usage?.cacheWriteTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          cost: usage?.cost ?? null,
          upstreamInferenceCost: usage?.upstreamInferenceCost ?? null,
          fallbackApplied: turn.resolution === "FALLBACK_APPLIED",
          correctionUsed: turn.firstIllegalActionError !== null,
        };
        const existing = this.connection.db
          .select()
          .from(modelCalls)
          .where(eq(modelCalls.id, attempt.callId))
          .get();
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(values)) {
            throw new PersistenceConflictError(
              `Model call ${attempt.callId} has conflicting telemetry.`,
            );
          }
          continue;
        }
        this.connection.db.insert(modelCalls).values(values).run();
      }
    })();
  }

  listModelCalls(gameId: string): (typeof modelCalls.$inferSelect)[] {
    return this.connection.db
      .select()
      .from(modelCalls)
      .where(eq(modelCalls.gameId, gameId))
      .orderBy(asc(modelCalls.startedAt), asc(modelCalls.id))
      .all();
  }

  initializeControl(
    gameId: string,
    mode: GameRunMode = "RUNNING",
    now = Date.now(),
  ): void {
    this.connection.db
      .insert(gameControls)
      .values({ gameId, mode, inFlight: false, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }

  getControl(gameId: string): GameControl | null {
    const row = this.connection.db
      .select()
      .from(gameControls)
      .where(eq(gameControls.gameId, gameId))
      .get();
    return row ? { ...row, mode: row.mode as GameRunMode } : null;
  }

  setRunMode(gameId: string, mode: GameRunMode, now = Date.now()): boolean {
    const result = this.connection.db
      .update(gameControls)
      .set({ mode, updatedAt: now })
      .where(eq(gameControls.gameId, gameId))
      .run();
    return result.changes === 1;
  }

  claimAdvance(gameId: string, forceStep = false, now = Date.now()): boolean {
    return this.connection.sqlite.transaction(() => {
      const control = this.getControl(gameId);
      if (!control || control.inFlight) return false;
      if (!forceStep && control.mode !== "RUNNING") return false;
      const result = this.connection.db
        .update(gameControls)
        .set({
          mode: forceStep ? "PAUSED" : control.mode,
          inFlight: true,
          updatedAt: now,
        })
        .where(eq(gameControls.gameId, gameId))
        .run();
      return result.changes === 1;
    })();
  }

  releaseAdvance(gameId: string, now = Date.now()): void {
    this.connection.db
      .update(gameControls)
      .set({ inFlight: false, updatedAt: now })
      .where(eq(gameControls.gameId, gameId))
      .run();
  }

  private upsertPlayer(gameId: string, player: GamePlayer): void {
    this.connection.db
      .insert(players)
      .values({
        gameId,
        id: player.id,
        displayName: player.displayName,
        seat: player.seat,
        role: player.role,
        modelId: player.modelId,
        isAlive: player.isAlive,
        departureJson: player.departure
          ? JSON.stringify(player.departure)
          : null,
      })
      .onConflictDoUpdate({
        target: [players.gameId, players.id],
        set: {
          displayName: player.displayName,
          seat: player.seat,
          role: player.role,
          modelId: player.modelId,
          isAlive: player.isAlive,
          departureJson: player.departure
            ? JSON.stringify(player.departure)
            : null,
        },
      })
      .run();
  }

  private appendEvent(
    gameId: string,
    event: GameEvent,
    createdAt: number,
  ): void {
    const audienceJson = JSON.stringify(event.audiencePlayerIds);
    const payloadJson = JSON.stringify(event.payload);
    const existing = this.connection.db
      .select()
      .from(gameEvents)
      .where(
        and(
          eq(gameEvents.gameId, gameId),
          eq(gameEvents.sequence, event.sequence),
        ),
      )
      .get();

    if (existing) {
      if (
        existing.type !== event.type ||
        existing.visibility !== event.visibility ||
        existing.audiencePlayerIdsJson !== audienceJson ||
        existing.payloadJson !== payloadJson
      ) {
        throw new PersistenceConflictError(
          `Event ${gameId}:${event.sequence} conflicts with the append-only event stream.`,
        );
      }
      return;
    }

    this.connection.db
      .insert(gameEvents)
      .values({
        id: `${gameId}:${event.sequence}`,
        gameId,
        sequence: event.sequence,
        type: event.type,
        visibility: event.visibility,
        audiencePlayerIdsJson: audienceJson,
        payloadJson,
        createdAt,
      })
      .run();
  }
}
