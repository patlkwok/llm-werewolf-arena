import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  winner: text("winner"),
  seed: integer("seed").notNull(),
  rulesJson: text("rules_json").notNull(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    seat: integer("seat").notNull(),
    role: text("role").notNull(),
    modelId: text("model_id").notNull(),
    isAlive: integer("is_alive", { mode: "boolean" }).notNull(),
    departureJson: text("departure_json"),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.id] }),
    uniqueIndex("players_game_seat_unique").on(table.gameId, table.seat),
    index("players_game_idx").on(table.gameId),
  ],
);

export const gameEvents = sqliteTable(
  "game_events",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    visibility: text("visibility").notNull(),
    audiencePlayerIdsJson: text("audience_player_ids_json").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("game_events_game_sequence_unique").on(
      table.gameId,
      table.sequence,
    ),
    index("game_events_game_idx").on(table.gameId),
  ],
);

export const modelCalls = sqliteTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    playerId: text("player_id").notNull(),
    modelId: text("model_id").notNull(),
    actionKind: text("action_kind").notNull(),
    semanticAttempt: text("semantic_attempt").notNull(),
    responseAttempt: integer("response_attempt").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    outcome: text("outcome").notNull(),
    errorMessage: text("error_message"),
    structuredActionJson: text("structured_action_json"),
    reasoningText: text("reasoning_text"),
    moveExplanation: text("move_explanation"),
    reasoningDetailsJson: text("reasoning_details_json"),
    responseId: text("response_id"),
    responseModelId: text("response_model_id"),
    providerName: text("provider_name"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cachedTokens: integer("cached_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    totalTokens: integer("total_tokens"),
    cost: real("cost"),
    upstreamInferenceCost: real("upstream_inference_cost"),
    fallbackApplied: integer("fallback_applied", { mode: "boolean" }).notNull(),
    correctionUsed: integer("correction_used", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("model_calls_game_idx").on(table.gameId),
    index("model_calls_turn_idx").on(table.turnId),
    index("model_calls_player_idx").on(table.gameId, table.playerId),
  ],
);

export const gameControls = sqliteTable("game_controls", {
  gameId: text("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  inFlight: integer("in_flight", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type GameRow = typeof games.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type GameEventRow = typeof gameEvents.$inferSelect;
export type ModelCallRow = typeof modelCalls.$inferSelect;
export type GameControlRow = typeof gameControls.$inferSelect;
