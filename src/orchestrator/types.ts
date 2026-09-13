import type {
  EngineError,
  GameAction,
  GameState,
  PendingAction,
  PlayerId,
} from "@/game-engine/types";
import type { AdapterFailureCategory, SemanticAttempt } from "@/llm/types";
import type { ModelResponseMetadata } from "@/llm/types";

export type AttemptOutcome =
  | AdapterFailureCategory
  | "MALFORMED_JSON"
  | "SCHEMA_INVALID"
  | "ILLEGAL_ACTION"
  | "SUCCESS";

export interface TurnAttemptRecord {
  callId: string;
  playerId: PlayerId;
  modelId: string;
  actionKind: PendingAction["kind"];
  semanticAttempt: SemanticAttempt;
  responseAttempt: 1 | 2 | 3;
  outcome: AttemptOutcome;
  message: string | null;
  structuredAction: GameAction | null;
  reasoning: string | null;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  responseMetadata: ModelResponseMetadata | null;
}

export interface TurnExecutionResult {
  turnId: string;
  state: GameState;
  resolution:
    "ACTION_APPLIED" | "CORRECTED_ACTION_APPLIED" | "FALLBACK_APPLIED";
  attempts: TurnAttemptRecord[];
  acceptedAction: GameAction | null;
  firstIllegalActionError: EngineError | null;
}

export interface CompleteGameResult {
  state: GameState;
  turns: TurnExecutionResult[];
  attempts: TurnAttemptRecord[];
}

export interface GameStateSink {
  saveGame(state: GameState): void | Promise<void>;
  saveTurnExecution?(
    gameId: string,
    turn: TurnExecutionResult,
  ): void | Promise<void>;
}
