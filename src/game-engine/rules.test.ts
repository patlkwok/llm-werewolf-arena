import { describe, expect, it } from "vitest";
import { evaluateWinner, resolveVotes, werewolfTeammateIds } from "./rules";
import { playerWithRole, testGame } from "./test-helpers";
import { type GamePlayer, Role, Team, type VoteRecord } from "./types";

function livingComposition(roles: Role[]): GamePlayer[] {
  const base = testGame().players;
  return base.map((player, index) => ({
    ...player,
    role: roles[index] ?? Role.VILLAGER,
    isAlive: index < roles.length,
  }));
}

describe("deterministic resolutions", () => {
  it("resolves unique plurality, ties, and all-abstain votes", () => {
    const votes: VoteRecord[] = [
      { dayNumber: 1, voterId: "a", targetPlayerId: "c", kind: "VOTE" },
      { dayNumber: 1, voterId: "b", targetPlayerId: "c", kind: "VOTE" },
      { dayNumber: 1, voterId: "c", targetPlayerId: "b", kind: "VOTE" },
    ];
    expect(resolveVotes(votes).exiledPlayerId).toBe("c");
    expect(resolveVotes(votes.slice(1)).exiledPlayerId).toBeNull();
    expect(
      resolveVotes([
        {
          dayNumber: 1,
          voterId: "a",
          targetPlayerId: null,
          kind: "FALLBACK_ABSTAIN",
        },
      ]),
    ).toEqual({ tally: {}, exiledPlayerId: null, tiedPlayerIds: [] });
  });

  it("awards Village victory when no living Werewolves remain", () => {
    expect(
      evaluateWinner(
        livingComposition([Role.DOCTOR, Role.VILLAGER]),
        "IMMEDIATE",
      ),
    ).toBe(Team.VILLAGE);
  });

  it("awards Werewolf victory at true parity or majority", () => {
    expect(
      evaluateWinner(
        livingComposition([Role.WEREWOLF, Role.DOCTOR]),
        "NIGHT_END",
      ),
    ).toBe(Team.WEREWOLVES);
    expect(
      evaluateWinner(
        livingComposition([Role.WEREWOLF, Role.WEREWOLF, Role.SEER]),
        "IMMEDIATE",
      ),
    ).toBe(Team.WEREWOLVES);
  });

  it("applies the special three-player rule only at day end", () => {
    const villagers = livingComposition([
      Role.WEREWOLF,
      Role.VILLAGER,
      Role.VILLAGER,
    ]);
    const withSeer = livingComposition([
      Role.WEREWOLF,
      Role.SEER,
      Role.VILLAGER,
    ]);
    expect(evaluateWinner(villagers, "DAY_END")).toBe(Team.WEREWOLVES);
    expect(evaluateWinner(withSeer, "DAY_END")).toBe(Team.WEREWOLVES);
    expect(evaluateWinner(villagers, "NIGHT_END")).toBeNull();
  });

  it("continues from three players when a living survival-changing role is available", () => {
    const withDoctor = livingComposition([
      Role.WEREWOLF,
      Role.DOCTOR,
      Role.VILLAGER,
    ]);
    expect(evaluateWinner(withDoctor, "DAY_END")).toBeNull();
  });

  it("exposes Werewolf teammate IDs only to Werewolves", () => {
    const state = testGame();
    const firstWolf = playerWithRole(state, Role.WEREWOLF, 0);
    const secondWolf = playerWithRole(state, Role.WEREWOLF, 1);
    const villager = playerWithRole(state, Role.VILLAGER);
    expect(werewolfTeammateIds(state.players, firstWolf.id)).toEqual([
      secondWolf.id,
    ]);
    expect(werewolfTeammateIds(state.players, villager.id)).toEqual([]);
  });
});
