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
  });
});
