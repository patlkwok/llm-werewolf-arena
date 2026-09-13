import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_game_storage",
    sql: `
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
      CREATE UNIQUE INDEX game_events_game_sequence_unique
        ON game_events(game_id, sequence);
      CREATE INDEX game_events_game_idx ON game_events(game_id);
    `,
  },
  {
    version: 2,
    name: "model_call_telemetry",
    sql: `
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
    `,
  },
  {
    version: 3,
    name: "game_run_controls",
    sql: `
      CREATE TABLE game_controls (
        game_id TEXT PRIMARY KEY NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        in_flight INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export function applyMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = sqlite
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => (row as { version: number }).version);
  const appliedVersions = new Set(applied);

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      sqlite
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, Date.now());
    })();
  }
}
