import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fallback,
  playerWithRole,
  testGame,
} from "@/game-engine/test-helpers";
import { Role } from "@/game-engine/types";
import { openDatabase, type DatabaseConnection } from "./database";
import { GameRepository, PersistenceConflictError } from "./repository";

const openConnections: DatabaseConnection[] = [];
const temporaryDirectories: string[] = [];

function memoryRepository() {
  const connection = openDatabase(":memory:");
  openConnections.push(connection);
  return new GameRepository(connection);
}

afterEach(() => {
  for (const connection of openConnections.splice(0)) connection.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite game repository", () => {
  it("persists and reconstructs an authoritative game snapshot and players", () => {
    const repository = memoryRepository();
    const state = testGame({ gameId: "snapshot-test" });
    repository.saveGame(state, 1000);

    expect(repository.loadGame(state.id)).toEqual(state);
    expect(repository.listPlayers(state.id)).toEqual(state.players);
    expect(repository.loadGame("missing")).toBeNull();
  });

  it("appends events in sequence and preserves original persistence timestamps", () => {
    const repository = memoryRepository();
    const original = testGame({ gameId: "event-order-test" });
    repository.saveGame(original, 1000);
    const progressed = fallback(original);
    repository.saveGame(progressed, 2000);

    const events = repository.listEvents(original.id);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: progressed.events.length }, (_, index) => index + 1),
    );
    expect(
      events
        .slice(0, original.events.length)
        .every((event) => event.createdAt === 1000),
    ).toBe(true);
    expect(
      events
        .slice(original.events.length)
        .every((event) => event.createdAt === 2000),
    ).toBe(true);
  });

  it("is idempotent when the same framework request saves the same revision twice", () => {
    const repository = memoryRepository();
    const state = fallback(testGame({ gameId: "idempotency-test" }));
    repository.saveGame(state, 1000);
    repository.saveGame(state, 2000);

    expect(repository.listEvents(state.id)).toHaveLength(state.events.length);
    expect(repository.loadGame(state.id)).toEqual(state);
  });

  it("rejects stale snapshots and conflicting append-only events", () => {
    const repository = memoryRepository();
    const original = testGame({ gameId: "conflict-test" });
    const progressed = fallback(original);
    repository.saveGame(progressed, 1000);

    expect(() => repository.saveGame(original, 2000)).toThrow(
      PersistenceConflictError,
    );

    const later = fallback(progressed);
    (later.events[0] as { payload: unknown }).payload = {
      gameId: "tampered",
      nightNumber: 0,
    };
    expect(() => repository.saveGame(later, 3000)).toThrow(
      PersistenceConflictError,
    );
    expect(repository.loadGame(original.id)).toEqual(progressed);
  });

  it("survives closing and reopening a file-backed database", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-persistence-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "arena.db");
    const firstConnection = openDatabase(filename);
    const state = fallback(testGame({ gameId: "reload-test" }));
    new GameRepository(firstConnection).saveGame(state, 1000);
    firstConnection.close();

    const reopened = openDatabase(filename);
    openConnections.push(reopened);
    const repository = new GameRepository(reopened);
    expect(repository.loadGame(state.id)).toEqual(state);
    expect(repository.listEvents(state.id)).toHaveLength(state.events.length);
  });

  it("updates persisted living/departure state after a night elimination", () => {
    const repository = memoryRepository();
    let state = testGame({ gameId: "departure-test" });
    const victim = playerWithRole(state, Role.VILLAGER);
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: victim.id,
    });
    state = act(state, { action: "agree" });
    repository.saveGame(state, 1000);

    expect(
      repository
        .listPlayers(state.id)
        .find((player) => player.id === victim.id),
    ).toMatchObject({
      isAlive: false,
      departure: { kind: "NIGHT_ELIMINATION", nightNumber: 0 },
    });
  });

  it("persists pause/resume state and permits only one claimed action", () => {
    const repository = memoryRepository();
    const state = testGame({ gameId: "control-test" });
    repository.saveGame(state, 1000);
    repository.initializeControl(state.id, "RUNNING", 1000);

    expect(repository.claimAdvance(state.id, false, 1100)).toBe(true);
    expect(repository.claimAdvance(state.id, false, 1101)).toBe(false);
    repository.setRunMode(state.id, "PAUSED", 1102);
    repository.releaseAdvance(state.id, 1103);
    expect(repository.claimAdvance(state.id, false, 1104)).toBe(false);

    expect(repository.claimAdvance(state.id, true, 1105)).toBe(true);
    expect(repository.getControl(state.id)).toMatchObject({
      mode: "PAUSED",
      inFlight: true,
    });
    repository.releaseAdvance(state.id, 1106);
    repository.setRunMode(state.id, "RUNNING", 1107);
    expect(repository.getControl(state.id)).toMatchObject({
      mode: "RUNNING",
      inFlight: false,
    });
  });

  it("lists saved games newest first for history browsing", () => {
    const repository = memoryRepository();
    const older = testGame({ gameId: "older-game" });
    const newer = testGame({ gameId: "newer-game" });
    repository.saveGame(older, 1000);
    repository.saveGame(newer, 2000);

    expect(repository.listGames().map((game) => game.id)).toEqual([
      "newer-game",
      "older-game",
    ]);
    expect(repository.listGames()[0]?.playerNames).toEqual(
      newer.players.map((player) => player.displayName),
    );
  });

  it("deletes one saved game and all of its dependent records", () => {
    const repository = memoryRepository();
    const state = testGame({ gameId: "delete-me" });
    repository.saveGame(state, 1000);
    repository.initializeControl(state.id, "PAUSED", 1000);

    expect(repository.deleteGame(state.id)).toBe(true);
    expect(repository.deleteGame(state.id)).toBe(false);
    expect(repository.loadGame(state.id)).toBeNull();
    expect(repository.listPlayers(state.id)).toEqual([]);
    expect(repository.listEvents(state.id)).toEqual([]);
    expect(repository.listModelCalls(state.id)).toEqual([]);
    expect(repository.getControl(state.id)).toBeNull();
  });

  it("clears all saved games", () => {
    const repository = memoryRepository();
    repository.saveGame(testGame({ gameId: "first-delete" }), 1000);
    repository.saveGame(testGame({ gameId: "second-delete" }), 2000);

    expect(repository.deleteAllGames()).toBe(2);
    expect(repository.listGames()).toEqual([]);
  });
});
