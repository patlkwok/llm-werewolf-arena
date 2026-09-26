import { describe, expect, it } from "vitest";
import { EventVisibility, type GameEvent } from "@/game-engine/events";
import { testGame } from "@/game-engine/test-helpers";
import type { ModelCallRow } from "@/persistence/schema";
import {
  correlateEvents,
  eventDescription,
  newestFirst,
  stageCounter,
  visibleReasoning,
} from "./spectator-arena";

describe("spectator timeline presentation", () => {
  it("renders a resolved vote as named outcome and tally", () => {
    const state = testGame({ gameId: "vote-description" });
    const [, briar, cinder] = state.players;
    const event: GameEvent = {
      sequence: 20,
      type: "VOTE_RESOLVED",
      visibility: EventVisibility.PUBLIC,
      audiencePlayerIds: [],
      payload: {
        dayNumber: 1,
        result: {
          tally: { [briar!.id]: 4, [cinder!.id]: 2 },
          exiledPlayerId: briar!.id,
          tiedPlayerIds: [],
        },
      },
    };

    expect(eventDescription(event, state)).toBe(
      `${briar!.displayName} received the most votes. Tally — ${briar!.displayName}: 4 votes · ${cinder!.displayName}: 2 votes.`,
    );
    expect(eventDescription(event, state)).not.toContain("[object Object]");
  });

  it("places newest timeline entries first without mutating event order", () => {
    const chronological = [1, 2, 3];
    expect(newestFirst(chronological)).toEqual([3, 2, 1]);
    expect(chronological).toEqual([1, 2, 3]);
  });

  it("associates daytime speech with its spectator-only model attempts", () => {
    const event: GameEvent = {
      sequence: 12,
      type: "PLAYER_SPOKE",
      visibility: EventVisibility.PUBLIC,
      audiencePlayerIds: [],
      payload: {
        dayNumber: 1,
        roundNumber: 1,
        playerId: "player-2",
        message: "I suspect the third seat.",
      },
    };
    const call = {
      id: "call-1",
      turnId: "turn-1",
      playerId: "player-2",
      actionKind: "DISCUSS",
      startedAt: 100,
      outcome: "SUCCESS",
    } as unknown as ModelCallRow;

    expect(correlateEvents([event], [call])).toEqual([
      { event, calls: [call] },
    ]);
  });

  it("shows only the counter for the current day or night stage", () => {
    const night = testGame({ gameId: "night-counter" });
    expect(stageCounter(night)).toBe("Night 0");
    const day = structuredClone(night);
    day.phase = "DAY_VOTING" as typeof day.phase;
    day.dayNumber = 3;
    day.nightNumber = 2;
    expect(stageCounter(day)).toBe("Day 3");
  });

  it("distinguishes encrypted reasoning from absent reasoning", () => {
    const call = {
      reasoningText: null,
      reasoningTokens: 417,
      reasoningDetailsJson: JSON.stringify([
        {
          type: "reasoning.encrypted",
          data: "opaque-provider-data",
        },
      ]),
    } as unknown as ModelCallRow;

    expect(visibleReasoning(call)).toBe(
      "417 reasoning tokens were used, but the provider returned only encrypted reasoning and no spectator-visible summary.",
    );
    expect(visibleReasoning(call)).not.toContain("opaque-provider-data");
    expect(visibleReasoning(call, true)).toBe(
      "No valid move explanation was returned.",
    );
  });

  it("uses move explanations in place of provider reasoning when required", () => {
    const call = {
      reasoningText: "provider private reasoning",
      reasoningTokens: 372,
      moveExplanation: "I chose a player whose claim I doubt.",
    } as ModelCallRow;
    expect(visibleReasoning(call, true)).toBe(
      "I chose a player whose claim I doubt.",
    );
  });

  it("explains Witch effects in both new and older night records", () => {
    const state = testGame({
      gameId: "witch-night-description",
      roleCounts: { WEREWOLF: 2, SEER: 1, DOCTOR: 1, WITCH: 1, VILLAGER: 3 },
    });
    const target = state.players[0]!;
    const poisonTarget = state.players[1]!;
    const detail = {
      sequence: 8,
      type: "NIGHT_RESOLUTION_DETAIL",
      visibility: EventVisibility.SPECTATOR_ONLY,
      audiencePlayerIds: [],
      payload: {
        nightNumber: 0,
        outcome: "PROTECTED",
        selectedTargetId: target.id,
        protectedTargetId: null,
        witchSavedTargetId: target.id,
        witchEliminationTargetId: poisonTarget.id,
        witchEliminatedPlayerId: poisonTarget.id,
      },
    } as const satisfies GameEvent;
    expect(eventDescription(detail, state)).toContain(
      `Doctor protection: none · Witch save: ${target.displayName} · Witch elimination potion: eliminated ${poisonTarget.displayName}`,
    );

    const witchAction: GameEvent = {
      sequence: 7,
      type: "WITCH_ACTED",
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [poisonTarget.id],
      payload: {
        playerId: poisonTarget.id,
        werewolfTargetId: target.id,
        usedSavePotion: true,
        eliminationTargetId: null,
        source: "MODEL",
      },
    };
    state.events.push(witchAction);
    const legacy = {
      ...detail,
      payload: {
        nightNumber: 0,
        outcome: "PROTECTED",
        selectedTargetId: target.id,
        protectedTargetId: null,
      },
    } as unknown as GameEvent;
    expect(eventDescription(legacy, state)).toContain(
      `Doctor protection: none · Witch save: ${target.displayName} · Witch elimination potion: unused`,
    );
  });

  it("omits role details for roles absent from the game", () => {
    const noWitch = testGame();
    const target = noWitch.players[0]!;
    const detail: GameEvent = {
      sequence: 8,
      type: "NIGHT_RESOLUTION_DETAIL",
      visibility: EventVisibility.SPECTATOR_ONLY,
      audiencePlayerIds: [],
      payload: {
        nightNumber: 0,
        outcome: "ELIMINATED",
        selectedTargetId: target.id,
        protectedTargetId: null,
        witchSavedTargetId: null,
        witchEliminationTargetId: null,
        witchEliminatedPlayerId: null,
      },
    };
    const doctorOnly = eventDescription(detail, noWitch);
    expect(doctorOnly).toContain("Doctor protection: none");
    expect(doctorOnly).not.toContain("Witch");

    const noDoctor = testGame({
      roleCounts: { WEREWOLF: 2, SEER: 1, DOCTOR: 0, WITCH: 1, VILLAGER: 4 },
    });
    const witchOnly = eventDescription(detail, noDoctor);
    expect(witchOnly).not.toContain("Doctor protection");
    expect(witchOnly).toContain("Witch save: none");
    expect(witchOnly).toContain("Witch elimination potion: unused");

    const neither = testGame({
      roleCounts: { WEREWOLF: 2, SEER: 1, DOCTOR: 0, WITCH: 0, VILLAGER: 5 },
    });
    expect(eventDescription(detail, neither)).toBe(
      `Werewolf attack: eliminated ${target.displayName}.`,
    );
  });
});
