import { describe, expect, it } from "vitest";
import { applyAction, applyFallback, getPendingAction } from "./engine";
import {
  act,
  fallback,
  finishDiscussion,
  finishVotingWithFallbacks,
  reachDayWithNoDeparture,
  testGame,
} from "./test-helpers";
import { Phase, Role } from "./types";

describe("day discussion and voting", () => {
  it("runs exactly two discussion rounds in the same clockwise order", () => {
    let state = reachDayWithNoDeparture(testGame());
    const order = state.currentDay!.speakingOrder;
    expect(order[0]).toBe(
      state.players.find((player) => player.seat === 0)!.id,
    );
    const actors: string[] = [];
    while (state.phase === Phase.DAY_DISCUSSION) {
      actors.push(getPendingAction(state)!.playerId);
      state = act(
        state,
        actors.length === 1
          ? { action: "speak", message: "Opening read." }
          : { action: "pass" },
      );
    }
    expect(actors).toEqual([...order, ...order]);
    expect(state.currentDay?.discussion).toHaveLength(16);
    expect(state.currentDay?.discussion[0]).toMatchObject({
      action: "SPEAK",
      message: "Opening read.",
    });
    expect(state.currentDay?.discussion[1]?.action).toBe("PASS");
  });

  it("starts after an overnight departure's seat", () => {
    let state = testGame();
    const victim = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    const expectedFirst =
      [...state.players]
        .sort((left, right) => left.seat - right.seat)
        .find((player) => player.seat > victim.seat && player.id !== victim.id)
        ?.id ?? state.players.find((player) => player.seat === 0)!.id;
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: victim.id,
    });
    state = act(state, { action: "agree" });
    expect(state.currentDay?.speakingOrder[0]).toBe(expectedFirst);
  });

  it("rotates the no-departure day marker across days", () => {
    let state = reachDayWithNoDeparture(testGame());
    expect(state.currentDay?.speakingOrder[0]).toBe("player-1");
    state = finishVotingWithFallbacks(finishDiscussion(state));
    state = reachDayWithNoDeparture(state);
    expect(state.currentDay?.speakingOrder[0]).toBe("player-2");
  });

  it("reveals each sequential vote immediately and retains prior votes", () => {
    let state = finishDiscussion(reachDayWithNoDeparture(testGame()));
    const first = getPendingAction(state)!;
    expect(first.kind).toBe("VOTE");
    const target = first.kind === "VOTE" ? first.legalTargetIds[0]! : "";
    state = act(state, { action: "vote", targetPlayerId: target });
    expect(state.currentDay?.votes).toEqual([
      {
        dayNumber: 1,
        voterId: first.playerId,
        targetPlayerId: target,
        kind: "VOTE",
      },
    ]);
    expect(getPendingAction(state)?.playerId).toBe(
      state.currentDay?.speakingOrder[1],
    );
  });

  it("rejects self-votes and strategic abstention when disabled", () => {
    const state = finishDiscussion(reachDayWithNoDeparture(testGame()));
    const voter = getPendingAction(state)!;
    expect(
      applyAction(state, voter.playerId, {
        action: "vote",
        targetPlayerId: voter.playerId,
      }),
    ).toMatchObject({ ok: false, error: { code: "SELF_TARGET_NOT_ALLOWED" } });
    expect(
      applyAction(state, voter.playerId, { action: "abstain" }),
    ).toMatchObject({
      ok: false,
      error: { code: "STRATEGIC_ABSTENTION_DISABLED" },
    });
  });

  it("distinguishes enabled strategic abstention from fallback abstention", () => {
    let strategic = finishDiscussion(
      reachDayWithNoDeparture(
        testGame({ rules: { strategicVoteAbstention: true } }),
      ),
    );
    strategic = act(strategic, { action: "abstain" });
    expect(strategic.currentDay?.votes[0]?.kind).toBe("STRATEGIC_ABSTAIN");

    let fallbackVote = finishDiscussion(reachDayWithNoDeparture(testGame()));
    const result = applyFallback(fallbackVote);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    fallbackVote = result.value;
    expect(fallbackVote.currentDay?.votes[0]?.kind).toBe("FALLBACK_ABSTAIN");
  });

  it("resolves a highest-count tie with no exile and no runoff", () => {
    let state = finishDiscussion(reachDayWithNoDeparture(testGame()));
    while (state.phase === Phase.DAY_VOTING) {
      const pending = getPendingAction(state)!;
      if (pending.kind !== "VOTE") throw new Error("Expected vote.");
      const voter = state.players.find(
        (player) => player.id === pending.playerId,
      )!;
      const nextSeat = (voter.seat + 1) % 8;
      const target = state.players.find((player) => player.seat === nextSeat)!;
      state = act(state, { action: "vote", targetPlayerId: target.id });
    }
    expect(state.dayHistory[0]?.voteResult?.exiledPlayerId).toBeNull();
    expect(state.dayHistory[0]?.voteResult?.tiedPlayerIds).toHaveLength(8);
    expect(state.phase).toBe(Phase.NIGHT_DOCTOR);
  });

  it("gives an exiled player final words after departure", () => {
    let state = finishDiscussion(reachDayWithNoDeparture(testGame()));
    const target = state.players[3]!;
    while (state.phase === Phase.DAY_VOTING) {
      const pending = getPendingAction(state)!;
      if (pending.kind !== "VOTE") throw new Error("Expected vote.");
      const voteTarget =
        pending.playerId === target.id ? state.players[0]!.id : target.id;
      state = act(state, { action: "vote", targetPlayerId: voteTarget });
    }
    expect(state.phase).toBe(Phase.DAY_FINAL_WORDS);
    expect(
      state.players.find((player) => player.id === target.id)?.isAlive,
    ).toBe(false);
    expect(getPendingAction(state)?.playerId).toBe(target.id);
    state = act(state, { action: "final_words", message: "Remember my vote." });
    expect(state.dayHistory[0]?.finalWords).toMatchObject({
      playerId: target.id,
      message: "Remember my vote.",
      source: "MODEL",
    });
  });

  it("does not request final words for a night-eliminated player", () => {
    let state = testGame();
    const victim = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: victim.id,
    });
    state = act(state, { action: "agree" });
    expect(state.phase).toBe(Phase.DAY_DISCUSSION);
    expect(getPendingAction(state)?.playerId).not.toBe(victim.id);
  });
});
