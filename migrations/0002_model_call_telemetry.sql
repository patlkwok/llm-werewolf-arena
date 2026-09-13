CREATE TABLE model_calls (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  semantic_attempt TEXT NOT NULL,
  response_attempt INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  error_message TEXT,
  structured_action_json TEXT,
  reasoning_text TEXT,
  reasoning_details_json TEXT,
  response_id TEXT,
  response_model_id TEXT,
  provider_name TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  cost REAL,
  upstream_inference_cost REAL,
  fallback_applied INTEGER NOT NULL,
  correction_used INTEGER NOT NULL
);

CREATE INDEX model_calls_game_idx ON model_calls(game_id);
CREATE INDEX model_calls_turn_idx ON model_calls(turn_id);
CREATE INDEX model_calls_player_idx ON model_calls(game_id, player_id);
