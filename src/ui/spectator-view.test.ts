import { describe, expect, it } from "vitest";
import {
  act,
  fallback,
  playerWithRole,
  testGame,
} from "@/game-engine/test-helpers";
import { GameStatus, Role } from "@/game-engine/types";
import { projectSpectatorState } from "./spectator-view";
import {
  finishDiscussion,
  reachDayWithNoDeparture,
} from "@/game-engine/test-helpers";

describe("spoiler-filtered spectator view", () => {
  it("keeps active hidden roles, night actions, seed and model IDs out of the browser payload", () => {
    const state = testGame({ experience: { hideSpoilersUntilEnd: true } });
    const view = projectSpectatorState(state);
    const serialized = JSON.stringify(view);
    expect(view.phase).toBe("NIGHT");
    expect(
      view.players.every(
        (player) => player.role === null && player.modelId === null,
      ),
    ).toBe(true);
    expect(view.events.every((event) => event.visibility === "PUBLIC")).toBe(
      true,
    );
    expect(serialized).not.toContain("fake/shared");
    expect(serialized).not.toContain("ROLES_ASSIGNED");
    expect(serialized).not.toContain("seed");
    expect(serialized).not.toContain("witchPotions");
  });

  it("shows public departure role reveals during play, then all roles after game end", () => {
    let state = testGame({
      rules: { roleRevealOnDeparture: true },
      experience: { hideSpoilersUntilEnd: true },
    });
    const target = playerWithRole(state, Role.VILLAGER);
    state = fallback(state);
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = act(state, { action: "agree" });
    const active = projectSpectatorState(state);
    expect(active.players.find((player) => player.id === target.id)?.role).toBe(
      Role.VILLAGER,
    );
    expect(
      active.players
        .filter((player) => player.isAlive)
        .every((player) => player.role === null),
    ).toBe(true);
    expect(active.events).toContainEqual(
      expect.objectContaining({
        type: "ROLE_REVEALED",
        payload: { playerId: target.id, role: Role.VILLAGER },
      }),
    );
    state.status = GameStatus.COMPLETE;
    const finished = projectSpectatorState(state);
    expect(finished.players.every((player) => player.role !== null)).toBe(true);
    expect(
      finished.events.some((event) => event.type === "ROLES_ASSIGNED"),
    ).toBe(true);
  });

  it("keeps the reason for a public abstention out of a live spoiler view", () => {
    let state = finishDiscussion(
      reachDayWithNoDeparture(
        testGame({
          experience: { hideSpoilersUntilEnd: true },
          rules: { strategicVoteAbstention: true },
        }),
      ),
    );
    state = fallback(state);
    expect(state.events.at(-1)).toMatchObject({
      type: "PLAYER_VOTED",
      payload: { kind: "FALLBACK_ABSTAIN" },
    });
    expect(projectSpectatorState(state).events.at(-1)).toMatchObject({
      type: "PLAYER_VOTED",
      payload: { kind: "ABSTAIN" },
    });
  });
});
