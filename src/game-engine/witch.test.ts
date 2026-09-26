import { describe, expect, it } from "vitest";
import { applyAction, getPendingAction } from "./engine";
import { evaluateWinner } from "./rules";
import { createGame } from "./setup";
import { act, fallback, playerWithRole, standardSetups } from "./test-helpers";
import { Phase, Role, Team, type GameState } from "./types";

function witchGame(revealRolesOnDeparture = false): GameState {
  const created = createGame(standardSetups(6), {
    seed: 74,
    roleCounts: { WEREWOLF: 1, SEER: 1, DOCTOR: 1, WITCH: 1, VILLAGER: 2 },
    rules: { roleRevealOnDeparture: revealRolesOnDeparture },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function selectWolfTarget(state: GameState, targetId: string): GameState {
  let next = state;
  if (next.phase === Phase.NIGHT_DOCTOR) next = fallback(next);
  if (next.phase === Phase.NIGHT_SEER) next = fallback(next);
  return act(next, { action: "propose_elimination", targetPlayerId: targetId });
}

describe("Witch night resolution", () => {
  it("supports two departures and starts the next day after the Werewolf victim", () => {
    let state = witchGame(true);
    const wolfVictim = playerWithRole(state, Role.VILLAGER, 0);
    const witchVictim = playerWithRole(state, Role.VILLAGER, 1);
    state = selectWolfTarget(state, wolfVictim.id);
    expect(state.phase).toBe(Phase.NIGHT_WITCH);
    state = act(state, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: witchVictim.id,
    });
    expect(
      state.players.find((player) => player.id === wolfVictim.id)?.isAlive,
    ).toBe(false);
    expect(
      state.players.find((player) => player.id === witchVictim.id)?.isAlive,
    ).toBe(false);
    expect(state.currentDay?.speakingOrder[0]).toBe(
      state.players
        .filter((player) => player.isAlive)
        .sort(
          (a, b) =>
            ((a.seat - wolfVictim.seat + 6) % 6) -
            ((b.seat - wolfVictim.seat + 6) % 6),
        )[0]?.id,
    );
    expect(
      state.events.filter((event) => event.type === "PLAYER_ELIMINATED"),
    ).toHaveLength(2);
    expect(
      state.events.filter((event) => event.type === "ROLE_REVEALED"),
    ).toHaveLength(2);
    expect(state.witchPotions).toEqual({
      saveAvailable: true,
      eliminationAvailable: false,
    });
  });

  it("keeps Doctor protection limited to the Werewolf attack", () => {
    let state = witchGame();
    const wolfVictim = playerWithRole(state, Role.VILLAGER, 0);
    const witchVictim = playerWithRole(state, Role.VILLAGER, 1);
    state = act(state, { action: "protect", targetPlayerId: witchVictim.id });
    state = selectWolfTarget(state, wolfVictim.id);
    state = act(state, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: witchVictim.id,
    });
    expect(
      state.players.find((player) => player.id === wolfVictim.id)?.isAlive,
    ).toBe(false);
    expect(
      state.players.find((player) => player.id === witchVictim.id)?.isAlive,
    ).toBe(false);
    expect(
      state.events.find((event) => event.type === "NIGHT_RESOLUTION_DETAIL")
        ?.payload,
    ).toMatchObject({
      protectedTargetId: witchVictim.id,
      witchEliminationTargetId: witchVictim.id,
      witchEliminatedPlayerId: witchVictim.id,
    });
    expect(state.events.some((event) => event.type === "ROLE_REVEALED")).toBe(
      false,
    );
  });

  it("lets a targeted Witch act before death and eliminate the last Werewolf", () => {
    let state = witchGame();
    const witch = playerWithRole(state, Role.WITCH);
    const wolf = playerWithRole(state, Role.WEREWOLF);
    state = selectWolfTarget(state, witch.id);
    state = act(state, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: wolf.id,
    });
    expect(state.winner).toBe(Team.VILLAGE);
    expect(
      state.players.find((player) => player.id === witch.id)?.isAlive,
    ).toBe(false);
    expect(state.players.find((player) => player.id === wolf.id)?.isAlive).toBe(
      false,
    );
  });

  it("consumes a Witch save even when the Doctor also protected the target", () => {
    let state = witchGame();
    const target = playerWithRole(state, Role.VILLAGER);
    state = act(state, { action: "protect", targetPlayerId: target.id });
    state = selectWolfTarget(state, target.id);
    state = act(state, {
      action: "use_potions",
      useSavePotion: true,
      eliminatePlayerId: null,
    });
    expect(
      state.players.find((player) => player.id === target.id)?.isAlive,
    ).toBe(true);
    expect(state.witchPotions?.saveAvailable).toBe(false);
  });

  it("allows both potions in one night and records their distinct effects", () => {
    let state = witchGame();
    const wolfVictim = playerWithRole(state, Role.VILLAGER, 0);
    const witchVictim = playerWithRole(state, Role.VILLAGER, 1);
    state = selectWolfTarget(state, wolfVictim.id);
    state = act(state, {
      action: "use_potions",
      useSavePotion: true,
      eliminatePlayerId: witchVictim.id,
    });
    expect(state.witchPotions).toEqual({
      saveAvailable: false,
      eliminationAvailable: false,
    });
    expect(
      state.players.find((player) => player.id === wolfVictim.id)?.isAlive,
    ).toBe(true);
    expect(
      state.players.find((player) => player.id === witchVictim.id)?.isAlive,
    ).toBe(false);
    expect(
      state.events.find((event) => event.type === "NIGHT_RESOLUTION_DETAIL")
        ?.payload,
    ).toMatchObject({
      witchSavedTargetId: wolfVictim.id,
      witchEliminationTargetId: witchVictim.id,
      witchEliminatedPlayerId: witchVictim.id,
    });
  });

  it("conserves both potions when neither is selected", () => {
    let state = witchGame();
    const target = playerWithRole(state, Role.VILLAGER);
    state = selectWolfTarget(state, target.id);
    state = act(state, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: null,
    });
    expect(state.witchPotions).toEqual({
      saveAvailable: true,
      eliminationAvailable: true,
    });
  });

  it("allows elimination after Werewolves fail to choose a target", () => {
    let state = witchGame();
    const victim = playerWithRole(state, Role.VILLAGER);
    state = fallback(state);
    state = fallback(state);
    state = fallback(state);
    expect(getPendingAction(state)).toMatchObject({
      kind: "WITCH_ACT",
      werewolfTargetId: null,
      canSave: false,
    });
    state = act(state, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: victim.id,
    });
    expect(
      state.players.find((player) => player.id === victim.id)?.isAlive,
    ).toBe(false);
    expect(state.currentDay?.speakingOrder[0]).toBe(
      state.players
        .filter((player) => player.isAlive)
        .sort(
          (a, b) =>
            ((a.seat - victim.seat + 6) % 6) - ((b.seat - victim.seat + 6) % 6),
        )[0]?.id,
    );
  });

  it("rejects unavailable or self-directed potions without changing state", () => {
    let state = witchGame();
    state = selectWolfTarget(state, playerWithRole(state, Role.VILLAGER).id);
    const witch = playerWithRole(state, Role.WITCH);
    const attempted = applyAction(state, witch.id, {
      action: "use_potions",
      useSavePotion: false,
      eliminatePlayerId: witch.id,
    });
    expect(attempted).toMatchObject({
      ok: false,
      error: { code: "WITCH_TARGET_NOT_ALLOWED" },
    });
    expect(state.witchPotions?.eliminationAvailable).toBe(true);
    expect(getPendingAction(state)?.kind).toBe("WITCH_ACT");
  });

  it("uses neither potion when the Witch model falls back", () => {
    let state = witchGame();
    const target = playerWithRole(state, Role.VILLAGER);
    state = selectWolfTarget(state, target.id);
    state = fallback(state);
    expect(
      state.players.find((player) => player.id === target.id)?.isAlive,
    ).toBe(false);
    expect(state.witchPotions).toEqual({
      saveAvailable: true,
      eliminationAvailable: true,
    });
    expect(
      state.events.some(
        (event) =>
          event.type === "WITCH_ACTED" && event.payload.source === "FALLBACK",
      ),
    ).toBe(true);
  });

  it("uses available Witch potions in the three-player day-end rule", () => {
    const state = witchGame();
    const wolf = playerWithRole(state, Role.WEREWOLF);
    const witch = playerWithRole(state, Role.WITCH);
    const villager = playerWithRole(state, Role.VILLAGER);
    state.players.forEach((player) => {
      player.isAlive = [wolf.id, witch.id, villager.id].includes(player.id);
    });
    expect(
      evaluateWinner(state.players, "DAY_END", state.witchPotions),
    ).toBeNull();
    expect(
      evaluateWinner(state.players, "DAY_END", {
        saveAvailable: false,
        eliminationAvailable: false,
      }),
    ).toBe(Team.WEREWOLVES);
    villager.isAlive = false;
    expect(evaluateWinner(state.players, "IMMEDIATE", state.witchPotions)).toBe(
      Team.WEREWOLVES,
    );
  });
});
