CREATE TABLE games (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  winner TEXT,
  seed INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  seat INTEGER NOT NULL,
  role TEXT NOT NULL,
  model_id TEXT NOT NULL,
  is_alive INTEGER NOT NULL,
  departure_json TEXT,
  PRIMARY KEY (game_id, id)
);
CREATE UNIQUE INDEX players_game_seat_unique ON players(game_id, seat);
CREATE INDEX players_game_idx ON players(game_id);

CREATE TABLE game_events (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  audience_player_ids_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX game_events_game_sequence_unique ON game_events(game_id, sequence);
CREATE INDEX game_events_game_idx ON game_events(game_id);
