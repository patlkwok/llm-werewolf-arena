import { describe, expect, it } from "vitest";
import {
  abortGame,
  applyAction,
  applyFallback,
  getPendingAction,
} from "./engine";
import {
  act,
  fallback,
  finishDiscussion,
  finishVotingWithFallbacks,
  playerWithRole,
  reachDayWithNoDeparture,
  testGame,
} from "./test-helpers";
import { GameStatus, Phase, Role, Team } from "./types";

function exile(state: ReturnType<typeof testGame>, targetId: string) {
  let next = finishDiscussion(state);
  while (next.phase === Phase.DAY_VOTING) {
    const pending = getPendingAction(next)!;
    if (pending.kind !== "VOTE") throw new Error("Expected a vote.");
    const alternate = pending.legalTargetIds.find((id) => id !== targetId)!;
    next = act(next, {
      action: "vote",
      targetPlayerId: pending.playerId === targetId ? alternate : targetId,
    });
  }
  if (next.phase === Phase.DAY_FINAL_WORDS) next = fallback(next);
  return next;
}

describe("game lifecycle", () => {
  it("can be ended early by the operator without declaring a winner", () => {
    const original = testGame({ gameId: "operator-end" });
    const result = abortGame(original);
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: GameStatus.ABANDONED,
        phase: Phase.GAME_OVER,
        winner: null,
      },
    });
    expect(original.status).toBe(GameStatus.ACTIVE);
    if (!result.ok) throw new Error("Expected game to end.");
    expect(result.value.events.at(-1)).toMatchObject({
      type: "GAME_ABORTED",
      payload: { reason: "OPERATOR_ENDED" },
    });
    expect(getPendingAction(result.value)).toBeNull();
    expect(abortGame(result.value)).toMatchObject({
      ok: false,
      error: { code: "GAME_OVER" },
    });
  });

  it("rotates Werewolf proposer responsibility on later nights", () => {
    let state = testGame();
    state = fallback(state);
    state = fallback(state);
    const first = getPendingAction(state)!;
    expect(first.kind).toBe("WEREWOLF_PROPOSE");
    state = fallback(state);
    state = finishVotingWithFallbacks(finishDiscussion(state));
    state = fallback(state);
    state = fallback(state);
    const second = getPendingAction(state)!;
    expect(second.kind).toBe("WEREWOLF_PROPOSE");
    expect(second.playerId).not.toBe(first.playerId);
  });

  it("skips departed Doctor and Seer night actions", () => {
    let state = testGame();
    const doctor = playerWithRole(state, Role.DOCTOR);
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: doctor.id,
    });
    state = act(state, { action: "agree" });
    state = finishVotingWithFallbacks(finishDiscussion(state));
    expect(state.phase).toBe(Phase.NIGHT_SEER);

    const seer = playerWithRole(state, Role.SEER);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: seer.id,
    });
    state = act(state, { action: "agree" });
    state = finishVotingWithFallbacks(finishDiscussion(state));
    expect(state.phase).toBe(Phase.NIGHT_WEREWOLF_PROPOSAL);
  });

  it("records fallback Werewolf disagreement and final-words no-statement", () => {
    let state = testGame();
    const target = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = fallback(state);
    expect(
      state.nightHistory[0]!.werewolfAttempts[0]!.responses[0],
    ).toMatchObject({
      response: "DISAGREE",
      source: "FALLBACK",
    });

    state = exile(state, target.id);
    expect(state.dayHistory[0]!.finalWords).toMatchObject({
      playerId: target.id,
      message: null,
      source: "FALLBACK",
    });
  });

  it("can disable exiled final words", () => {
    let state = reachDayWithNoDeparture(
      testGame({ rules: { finalWordsForExiledPlayer: false } }),
    );
    const target = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = exile(state, target.id);
    expect(state.phase).not.toBe(Phase.DAY_FINAL_WORDS);
    expect(state.dayHistory[0]!.exiledPlayerId).toBe(target.id);
    expect(state.dayHistory[0]!.finalWords).toBeNull();
  });

  it("ends with a Village victory after both Werewolves are exiled", () => {
    let state = reachDayWithNoDeparture(testGame());
    const wolves = state.players
      .filter((player) => player.role === Role.WEREWOLF)
      .sort((left, right) => left.seat - right.seat);
    state = exile(state, wolves[0]!.id);
    expect(state.status).toBe(GameStatus.ACTIVE);
    state = reachDayWithNoDeparture(state);
    state = exile(state, wolves[1]!.id);
    expect(state).toMatchObject({
      status: GameStatus.COMPLETE,
      phase: Phase.GAME_OVER,
      winner: Team.VILLAGE,
    });
    expect(getPendingAction(state)).toBeNull();
    expect(applyFallback(state)).toMatchObject({
      ok: false,
      error: { code: "GAME_OVER" },
    });
  });

  it("rejects out-of-turn actors and phase-incompatible actions without mutating state", () => {
    const state = testGame();
    const pending = getPendingAction(state)!;
    const other = state.players.find(
      (player) => player.id !== pending.playerId,
    )!;
    expect(applyAction(state, other.id, { action: "pass" })).toMatchObject({
      ok: false,
      error: { code: "WRONG_ACTOR" },
    });
    expect(
      applyAction(state, pending.playerId, { action: "pass" }),
    ).toMatchObject({
      ok: false,
      error: { code: "WRONG_ACTION" },
    });
    expect(state.phase).toBe(Phase.NIGHT_DOCTOR);
    expect(state.currentNight?.doctorActionSource).toBeNull();
  });
});
