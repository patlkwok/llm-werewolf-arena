import type { PendingAction, PlayerId } from "@/game-engine/types";
import type { PlayerObservation } from "@/observations/types";

export type SemanticAttempt = "INITIAL" | "CORRECTION";

export interface ModelMessage {
  role: "system" | "user";
  content: string;
}

export interface ModelTurnRequest {
  callId: string;
  turnId: string;
  gameId: string;
  playerId: PlayerId;
  modelId: string;
  action: PendingAction;
  observation: PlayerObservation;
  semanticAttempt: SemanticAttempt;
  responseAttempt: 1 | 2 | 3;
  correctionError: string | null;
  schemaName: string;
  responseJsonSchema: Record<string, unknown>;
  messages: ModelMessage[];
}

export interface ModelUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  upstreamInferenceCost: number | null;
}

export interface ModelResponseMetadata {
  responseId: string | null;
  responseModelId: string | null;
  providerName: string | null;
  reasoningDetails: unknown | null;
  usage: ModelUsage | null;
}

export enum AdapterFailureCategory {
  TIMEOUT = "TIMEOUT",
  PROVIDER_ERROR = "PROVIDER_ERROR",
}

export type ModelAdapterResult =
  | {
      ok: true;
      output: unknown;
      reasoning?: string;
      metadata?: ModelResponseMetadata;
    }
  | {
      ok: false;
      category: AdapterFailureCategory;
      message: string;
    };

export interface ModelAdapter {
  requestAction(request: ModelTurnRequest): Promise<ModelAdapterResult>;
}
