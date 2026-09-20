import { describe, expect, it } from "vitest";
import { getPendingAction } from "./engine";
import {
  createGame,
  DEFAULT_PLAYER_COUNT,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  ROLE_DISTRIBUTIONS,
} from "./setup";
import { standardSetups } from "./test-helpers";
import { Phase, Role } from "./types";

describe("game setup", () => {
  it("accepts six through twelve players and rejects counts outside that range", () => {
    for (
      let playerCount = MIN_PLAYER_COUNT;
      playerCount <= MAX_PLAYER_COUNT;
      playerCount += 1
    ) {
      expect(createGame(standardSetups(playerCount), { seed: 1 }).ok).toBe(
        true,
      );
    }

    expect(
      createGame(standardSetups(MIN_PLAYER_COUNT - 1), { seed: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_SETUP" },
    });
    expect(
      createGame(standardSetups(MAX_PLAYER_COUNT + 1), { seed: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_SETUP" },
    });
  });

  it("trims names and rejects case-insensitive duplicates", () => {
    const valid = standardSetups();
    valid[0]!.displayName = "  Rowan  ";
    const created = createGame(valid, { seed: 1 });
    expect(created.ok && created.value.players[0]!.displayName).toBe("Rowan");

    const duplicate = standardSetups();
    duplicate[0]!.displayName = "Morgan";
    duplicate[1]!.displayName = "  MORGAN ";
    expect(createGame(duplicate, { seed: 1 })).toMatchObject({
      ok: false,
      error: { code: "INVALID_SETUP" },
    });
  });

  it("requires non-empty bounded names and model IDs", () => {
    const emptyName = standardSetups();
    emptyName[0]!.displayName = "   ";
    expect(createGame(emptyName, { seed: 1 }).ok).toBe(false);

    const longName = standardSetups();
    longName[0]!.displayName = "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    expect(createGame(longName, { seed: 1 }).ok).toBe(false);

    const emptyModel = standardSetups();
    emptyModel[0]!.modelId = " ";
    expect(createGame(emptyModel, { seed: 1 }).ok).toBe(false);
  });

  it("assigns every fixed role distribution deterministically from a seed", () => {
    for (const [countText, expectedCounts] of Object.entries(
      ROLE_DISTRIBUTIONS,
    )) {
      const playerCount = Number(countText);
      expect(
        Object.values(expectedCounts).reduce((sum, count) => sum + count, 0),
      ).toBe(playerCount);
      const first = createGame(standardSetups(playerCount), { seed: 19 });
      const second = createGame(standardSetups(playerCount), { seed: 19 });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) continue;

      expect(first.value.players.map((player) => player.role)).toEqual(
        second.value.players.map((player) => player.role),
      );
      for (const role of Object.values(Role)) {
        expect(
          first.value.players.filter((player) => player.role === role),
        ).toHaveLength(expectedCounts[role]);
      }
      expect(first.value.dayStartMarkerSeat).toBe(playerCount - 1);
    }
  });

  it("allows duplicate models while keeping IDs, names, seats, roles, and models distinct", () => {
    const setups = standardSetups().map((setup) => ({
      ...setup,
      modelId: "fake/shared",
    }));
    const result = createGame(setups, { seed: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.value.players.map((player) => player.id)).size).toBe(
      DEFAULT_PLAYER_COUNT,
    );
    expect(
      new Set(result.value.players.map((player) => player.seat)).size,
    ).toBe(DEFAULT_PLAYER_COUNT);
    expect(
      new Set(result.value.players.map((player) => player.modelId)),
    ).toEqual(new Set(["fake/shared"]));
  });

  it("starts at Night 0 with only the living Doctor requested", () => {
    const result = createGame(standardSetups(), { seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nightNumber).toBe(0);
    expect(result.value.phase).toBe(Phase.NIGHT_DOCTOR);
    const pending = getPendingAction(result.value);
    expect(pending?.kind).toBe("DOCTOR_PROTECT");
    expect(
      result.value.players.find((player) => player.id === pending?.playerId)
        ?.role,
    ).toBe(Role.DOCTOR);
  });
});
