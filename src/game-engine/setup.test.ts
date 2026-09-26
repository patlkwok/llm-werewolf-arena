import { describe, expect, it } from "vitest";
import { applyAction, getPendingAction } from "./engine";
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
        Object.values(expectedCounts).reduce<number>(
          (sum, count) => sum + count,
          0,
        ),
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

  it("accepts custom distributions through four Werewolves and skips an absent Doctor", () => {
    const counts = { WEREWOLF: 4, SEER: 1, DOCTOR: 0, WITCH: 1, VILLAGER: 6 };
    const result = createGame(standardSetups(12), {
      seed: 1,
      roleCounts: counts,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe(Phase.NIGHT_SEER);
    expect(
      result.value.players.filter((player) => player.role === Role.WEREWOLF),
    ).toHaveLength(4);
    expect(
      result.value.players.filter((player) => player.role === Role.WITCH),
    ).toHaveLength(1);
    expect(getPendingAction(result.value)?.kind).toBe("SEER_INSPECT");
  });

  it("requires all three responders to agree in a four-Werewolf pack", () => {
    const created = createGame(standardSetups(12), {
      seed: 19,
      roleCounts: { WEREWOLF: 4, SEER: 1, DOCTOR: 0, WITCH: 0, VILLAGER: 7 },
    });
    if (!created.ok) throw new Error(created.error.message);
    let state = created.value;
    const seerAction = getPendingAction(state)!;
    if (seerAction.kind !== "SEER_INSPECT")
      throw new Error("Expected Seer action.");
    const inspected = applyAction(state, seerAction.playerId, {
      action: "inspect",
      targetPlayerId: seerAction.legalTargetIds[0]!,
    });
    if (!inspected.ok) throw new Error(inspected.error.message);
    state = inspected.value;
    const proposal = getPendingAction(state)!;
    if (proposal.kind !== "WEREWOLF_PROPOSE")
      throw new Error("Expected proposal.");
    const proposed = applyAction(state, proposal.playerId, {
      action: "propose_elimination",
      targetPlayerId: proposal.legalTargetIds[0]!,
    });
    if (!proposed.ok) throw new Error(proposed.error.message);
    state = proposed.value;
    for (let index = 0; index < 3; index += 1) {
      const response = getPendingAction(state)!;
      expect(response.kind).toBe("WEREWOLF_RESPOND");
      const applied = applyAction(state, response.playerId, {
        action: "agree",
      });
      if (!applied.ok) throw new Error(applied.error.message);
      state = applied.value;
      if (index < 2) expect(state.phase).toBe(Phase.NIGHT_WEREWOLF_RESPONSES);
    }
    expect(state.currentNight).toBeNull();
    expect(state.nightHistory[0]?.werewolfAttempts[0]?.responses).toHaveLength(
      3,
    );
  });

  it("rejects invalid custom role counts in the engine", () => {
    const setups = standardSetups(6);
    for (const roleCounts of [
      { WEREWOLF: 3, SEER: 1, DOCTOR: 0, WITCH: 0, VILLAGER: 2 },
      { WEREWOLF: 1, SEER: 0, DOCTOR: 1, WITCH: 0, VILLAGER: 4 },
      { WEREWOLF: 1, SEER: 1, DOCTOR: 2, WITCH: 0, VILLAGER: 2 },
      { WEREWOLF: 1, SEER: 1, DOCTOR: 0, WITCH: 2, VILLAGER: 2 },
    ]) {
      expect(createGame(setups, { roleCounts }).ok).toBe(false);
    }
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
