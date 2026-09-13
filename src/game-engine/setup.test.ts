import { describe, expect, it } from "vitest";
import { getPendingAction } from "./engine";
import {
  createGame,
  MAX_DISPLAY_NAME_LENGTH,
  PLAYER_COUNT,
  V1_ROLE_COUNTS,
} from "./setup";
import { standardSetups } from "./test-helpers";
import { Phase, Role } from "./types";

describe("game setup", () => {
  it("requires exactly eight players", () => {
    const result = createGame(standardSetups().slice(0, 7), { seed: 1 });
    expect(result).toMatchObject({
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

  it("assigns the fixed role distribution deterministically from a seed", () => {
    expect(
      Object.values(V1_ROLE_COUNTS).reduce((sum, count) => sum + count, 0),
    ).toBe(PLAYER_COUNT);
    const first = createGame(standardSetups(), { seed: 19 });
    const second = createGame(standardSetups(), { seed: 19 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.players.map((player) => player.role)).toEqual(
      second.value.players.map((player) => player.role),
    );
    expect(
      first.value.players.filter((player) => player.role === Role.WEREWOLF),
    ).toHaveLength(2);
    expect(
      first.value.players.filter((player) => player.role === Role.SEER),
    ).toHaveLength(1);
    expect(
      first.value.players.filter((player) => player.role === Role.DOCTOR),
    ).toHaveLength(1);
    expect(
      first.value.players.filter((player) => player.role === Role.VILLAGER),
    ).toHaveLength(4);
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
      8,
    );
    expect(
      new Set(result.value.players.map((player) => player.seat)).size,
    ).toBe(8);
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
