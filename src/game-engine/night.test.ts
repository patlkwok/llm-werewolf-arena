import { describe, expect, it } from "vitest";
import { applyAction, getPendingAction } from "./engine";
import {
  act,
  fallback,
  finishDiscussion,
  finishVotingWithFallbacks,
  playerWithRole,
  testGame,
} from "./test-helpers";
import { Phase, Role } from "./types";

function passDay(state: ReturnType<typeof testGame>) {
  return finishVotingWithFallbacks(finishDiscussion(state));
}

describe("night actions", () => {
  it("runs Night 0 in Doctor, Seer, Werewolf order without Villager turns", () => {
    let state = testGame();
    const seenRoles: Role[] = [];
    while (state.phase !== Phase.DAY_DISCUSSION) {
      const pending = getPendingAction(state)!;
      seenRoles.push(
        state.players.find((player) => player.id === pending.playerId)!.role,
      );
      state = fallback(state);
    }
    expect(seenRoles).toEqual([Role.DOCTOR, Role.SEER, Role.WEREWOLF]);
    expect(seenRoles).not.toContain(Role.VILLAGER);
  });

  it("allows Doctor self-protection and blocks the same target on consecutive nights", () => {
    let state = testGame();
    const doctor = playerWithRole(state, Role.DOCTOR);
    state = act(state, { action: "protect", targetPlayerId: doctor.id });
    state = fallback(state); // Seer
    state = fallback(state); // failed Wolf proposal, Day 1
    state = passDay(state); // Night 1

    const original = state;
    expect(getPendingAction(state)).toMatchObject({
      kind: "DOCTOR_PROTECT",
      legalTargetIds: expect.not.arrayContaining([doctor.id]),
    });
    const illegal = applyAction(state, doctor.id, {
      action: "protect",
      targetPlayerId: doctor.id,
    });
    expect(illegal).toMatchObject({
      ok: false,
      error: { code: "CONSECUTIVE_DOCTOR_TARGET" },
    });
    expect(state).toEqual(original);

    const other = state.players.find(
      (player) => player.isAlive && player.id !== doctor.id,
    )!;
    expect(
      applyAction(state, doctor.id, {
        action: "protect",
        targetPlayerId: other.id,
      }).ok,
    ).toBe(true);
  });

  it("clears the consecutive Doctor restriction after a no-protection fallback night", () => {
    let state = testGame();
    const doctor = playerWithRole(state, Role.DOCTOR);
    state = act(state, { action: "protect", targetPlayerId: doctor.id });
    state = fallback(state);
    state = fallback(state);
    state = passDay(state);
    state = fallback(state); // Night 1 Doctor does not protect.
    state = fallback(state);
    state = fallback(state);
    state = passDay(state);

    expect(getPendingAction(state)?.kind).toBe("DOCTOR_PROTECT");
    expect(
      applyAction(state, doctor.id, {
        action: "protect",
        targetPlayerId: doctor.id,
      }).ok,
    ).toBe(true);
  });

  it("allows the Doctor to protect the same living player on Nights 1 and 3", () => {
    let state = testGame();
    const firstTarget = playerWithRole(state, Role.DOCTOR);
    const secondTarget = playerWithRole(state, Role.VILLAGER);

    state = fallback(state); // Night 0 Doctor.
    state = fallback(state); // Night 0 Seer.
    state = fallback(state); // Night 0 Werewolf proposal.
    state = passDay(state); // Night 1.
    expect(state.nightNumber).toBe(1);

    state = act(state, {
      action: "protect",
      targetPlayerId: firstTarget.id,
    });
    state = fallback(state); // Night 1 Seer.
    state = fallback(state); // Night 1 Werewolf proposal.
    state = passDay(state); // Night 2.
    expect(state.nightNumber).toBe(2);
    expect(getPendingAction(state)).toMatchObject({
      kind: "DOCTOR_PROTECT",
      legalTargetIds: expect.not.arrayContaining([firstTarget.id]),
    });

    state = act(state, {
      action: "protect",
      targetPlayerId: secondTarget.id,
    });
    state = fallback(state); // Night 2 Seer.
    state = fallback(state); // Night 2 Werewolf proposal.
    state = passDay(state); // Night 3.
    expect(state.nightNumber).toBe(3);
    expect(getPendingAction(state)).toMatchObject({
      kind: "DOCTOR_PROTECT",
      legalTargetIds: expect.arrayContaining([firstTarget.id]),
    });
    state = act(state, {
      action: "protect",
      targetPlayerId: firstTarget.id,
    });
    expect(state.currentNight?.doctorTargetId).toBe(firstTarget.id);
  });

  it("lets the Seer inspect another living player and repeat that inspection", () => {
    let state = testGame();
    const seer = playerWithRole(state, Role.SEER);
    const target = state.players.find((player) => player.id !== seer.id)!;
    state = fallback(state);
    state = act(state, { action: "inspect", targetPlayerId: target.id });
    const firstResult = state.seerResults[0]!.result;
    state = fallback(state);
    state = passDay(state);
    state = fallback(state);
    state = act(state, { action: "inspect", targetPlayerId: target.id });

    expect(state.seerResults).toHaveLength(2);
    expect(state.seerResults[1]).toMatchObject({
      targetPlayerId: target.id,
      result: firstResult,
    });
  });

  it("rejects Seer self-inspection and inspection of a departed player", () => {
    let state = testGame();
    const seer = playerWithRole(state, Role.SEER);
    state = fallback(state);
    expect(
      applyAction(state, seer.id, {
        action: "inspect",
        targetPlayerId: seer.id,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SELF_TARGET_NOT_ALLOWED" },
    });

    const victim = state.players.find(
      (player) =>
        player.role === Role.VILLAGER &&
        player.id !== state.previousNightDoctorTargetId,
    )!;
    state = act(state, { action: "inspect", targetPlayerId: victim.id });
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: victim.id,
    });
    state = act(state, { action: "agree" });
    expect(
      state.players.find((player) => player.id === victim.id)?.isAlive,
    ).toBe(false);
    state = passDay(state);
    state = fallback(state);
    const illegal = applyAction(state, seer.id, {
      action: "inspect",
      targetPlayerId: victim.id,
    });
    expect(illegal).toMatchObject({
      ok: false,
      error: { code: "TARGET_NOT_LIVING" },
    });
  });

  it("rejects Werewolf targets and requires unanimous agreement", () => {
    let state = testGame();
    const wolves = state.players.filter(
      (player) => player.role === Role.WEREWOLF,
    );
    state = fallback(state);
    state = fallback(state);
    const proposer = getPendingAction(state)!;
    expect(proposer.kind).toBe("WEREWOLF_PROPOSE");
    expect(
      applyAction(state, proposer.playerId, {
        action: "propose_elimination",
        targetPlayerId: wolves.find((wolf) => wolf.id !== proposer.playerId)!
          .id,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "WEREWOLF_TARGET_NOT_ALLOWED" },
    });

    const target = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    const responsePending = getPendingAction(state)!;
    expect(responsePending).toEqual({
      kind: "WEREWOLF_RESPOND",
      playerId: wolves.find((wolf) => wolf.id !== proposer.playerId)!.id,
      attemptNumber: 1,
      proposalTargetId: target.id,
    });
    state = act(state, { action: "disagree" });
    expect(state.nightHistory[0]!.outcome).toBe("NO_AGREEMENT");
    expect(
      state.players.find((player) => player.id === target.id)?.isAlive,
    ).toBe(true);
  });

  it("allows exactly one re-proposal with the next Werewolf as proposer", () => {
    let state = testGame({ rules: { werewolfReproposal: true } });
    state = fallback(state);
    state = fallback(state);
    const firstProposer = getPendingAction(state)!;
    const target = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = act(state, { action: "disagree" });
    const secondProposer = getPendingAction(state)!;
    expect(secondProposer.kind).toBe("WEREWOLF_PROPOSE");
    expect(secondProposer.playerId).not.toBe(firstProposer.playerId);
    expect(
      secondProposer.kind === "WEREWOLF_PROPOSE" &&
        secondProposer.attemptNumber,
    ).toBe(2);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = act(state, { action: "disagree" });
    expect(state.nightHistory[0]!.werewolfAttempts).toHaveLength(2);
    expect(state.phase).toBe(Phase.DAY_DISCUSSION);
  });

  it("cancels a unanimous Werewolf elimination when the Doctor protected the target", () => {
    let state = testGame();
    const target = state.players.find(
      (player) => player.role === Role.VILLAGER,
    )!;
    state = act(state, { action: "protect", targetPlayerId: target.id });
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = act(state, { action: "agree" });
    expect(state.nightHistory[0]).toMatchObject({
      selectedTargetId: target.id,
      eliminatedPlayerId: null,
      outcome: "PROTECTED",
    });
    expect(
      state.players.find((player) => player.id === target.id)?.isAlive,
    ).toBe(true);
  });

  it("uses phase-specific night fallbacks", () => {
    let state = testGame();
    state = fallback(state);
    expect(state.currentNight?.doctorActionSource).toBe("FALLBACK");
    expect(state.currentNight?.doctorTargetId).toBeNull();
    state = fallback(state);
    expect(state.currentNight?.seerInspection).toBeNull();
    state = fallback(state);
    expect(state.nightHistory[0]).toMatchObject({ outcome: "NO_PROPOSAL" });
  });
});
