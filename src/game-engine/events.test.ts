import { describe, expect, it } from "vitest";
import { EventVisibility } from "./events";
import { act, fallback, playerWithRole, testGame } from "./test-helpers";
import { Role } from "./types";

describe("typed game events", () => {
  it("starts with a continuous public/private event sequence", () => {
    const state = testGame();
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(state.events.map((event) => event.type)).toEqual([
      "GAME_STARTED",
      "ROLES_ASSIGNED",
      "NIGHT_STARTED",
    ]);
    expect(state.events[0]?.visibility).toBe(EventVisibility.PUBLIC);
    expect(state.events[1]?.visibility).toBe(EventVisibility.SPECTATOR_ONLY);
    expect(state.nextEventSequence).toBe(4);
  });

  it("audiences Doctor and Seer facts only to the acting player", () => {
    let state = testGame();
    const doctor = playerWithRole(state, Role.DOCTOR);
    const seer = playerWithRole(state, Role.SEER);
    const target = playerWithRole(state, Role.VILLAGER);
    state = act(state, { action: "protect", targetPlayerId: doctor.id });
    const doctorEvent = state.events.at(-1)!;
    expect(doctorEvent).toMatchObject({
      type: "DOCTOR_PROTECTION_RESOLVED",
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [doctor.id],
    });

    state = act(state, { action: "inspect", targetPlayerId: target.id });
    const seerEvent = state.events.at(-1)!;
    expect(seerEvent).toMatchObject({
      type: "SEER_INSPECTED",
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [seer.id],
    });
  });

  it("keeps the cause of a no-elimination night out of the public event", () => {
    let state = testGame();
    const target = playerWithRole(state, Role.VILLAGER);
    state = act(state, { action: "protect", targetPlayerId: target.id });
    state = fallback(state);
    state = act(state, {
      action: "propose_elimination",
      targetPlayerId: target.id,
    });
    state = act(state, { action: "agree" });

    const publicResolution = state.events.find(
      (event) => event.type === "NIGHT_RESOLVED",
    )!;
    const privateResolution = state.events.find(
      (event) => event.type === "NIGHT_RESOLUTION_DETAIL",
    )!;
    expect(publicResolution).toMatchObject({
      visibility: EventVisibility.PUBLIC,
      payload: { eliminatedPlayerIds: [] },
    });
    expect(publicResolution.payload).not.toHaveProperty("outcome");
    expect(privateResolution).toMatchObject({
      visibility: EventVisibility.SPECTATOR_ONLY,
      payload: { outcome: "PROTECTED" },
    });
  });

  it("emits a public role only when departure reveal is enabled", () => {
    const playNight = (roleRevealOnDeparture: boolean) => {
      let state = testGame({ rules: { roleRevealOnDeparture } });
      const target = playerWithRole(state, Role.VILLAGER);
      state = fallback(state);
      state = fallback(state);
      state = act(state, {
        action: "propose_elimination",
        targetPlayerId: target.id,
      });
      return act(state, { action: "agree" });
    };

    expect(
      playNight(false).events.some((event) => event.type === "ROLE_REVEALED"),
    ).toBe(false);
    expect(
      playNight(true).events.find((event) => event.type === "ROLE_REVEALED"),
    ).toMatchObject({
      visibility: EventVisibility.PUBLIC,
      payload: { role: Role.VILLAGER },
    });
  });

  it("marks fallback metadata spectator-only while publishing the resolved Pass", () => {
    let state = testGame();
    state = fallback(state);
    expect(state.events.slice(-2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "FALLBACK_APPLIED",
          visibility: EventVisibility.SPECTATOR_ONLY,
        }),
        expect.objectContaining({
          type: "DOCTOR_PROTECTION_RESOLVED",
          visibility: EventVisibility.PLAYER_PRIVATE,
        }),
      ]),
    );
  });
});
