import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_COUNT,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  roleCountsForPlayerCount,
} from "@/game-engine/setup";
import {
  DEFAULT_PLAYER_NAMES,
  roleDistributionLabel,
  setupSubmissionSchema,
} from "./setup";

function submission(playerCount = DEFAULT_PLAYER_COUNT): {
  players: { displayName: string; modelId: string }[];
  roleCounts: NonNullable<ReturnType<typeof roleCountsForPlayerCount>>;
  experience: {
    requireMoveExplanation: boolean;
    hideSpoilersUntilEnd: boolean;
  };
  rules: {
    roleRevealOnDeparture: boolean;
    finalWordsForExiledPlayer: boolean;
    werewolfReproposal: boolean;
    strategicVoteAbstention: boolean;
  };
} {
  return {
    players: DEFAULT_PLAYER_NAMES.slice(0, playerCount).map((displayName) => ({
      displayName,
      modelId: "same/model",
    })),
    roleCounts: roleCountsForPlayerCount(playerCount)!,
    experience: { requireMoveExplanation: false, hideSpoilersUntilEnd: false },
    rules: {
      roleRevealOnDeparture: false,
      finalWordsForExiledPlayer: true,
      werewolfReproposal: false,
      strategicVoteAbstention: false,
    },
  };
}

describe("setup submission", () => {
  it("accepts six through twelve unique names and duplicate model choices", () => {
    for (
      let playerCount = MIN_PLAYER_COUNT;
      playerCount <= MAX_PLAYER_COUNT;
      playerCount += 1
    ) {
      const parsed = setupSubmissionSchema.parse(submission(playerCount));
      expect(parsed.players).toHaveLength(playerCount);
      expect(new Set(parsed.players.map((player) => player.modelId))).toEqual(
        new Set(["same/model"]),
      );
    }
  });

  it("trims names and rejects case-insensitive duplicates", () => {
    const trimmed = submission();
    trimmed.players[0]!.displayName = "  Ash  ";
    expect(setupSubmissionSchema.parse(trimmed).players[0]?.displayName).toBe(
      "Ash",
    );

    const duplicate = submission();
    duplicate.players[1]!.displayName = "aSH";
    expect(setupSubmissionSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects player counts outside the supported range and blank model selections", () => {
    expect(
      setupSubmissionSchema.safeParse(submission(MIN_PLAYER_COUNT - 1)).success,
    ).toBe(false);

    const tooMany = submission(MAX_PLAYER_COUNT);
    tooMany.players.push({ displayName: "Extra", modelId: "same/model" });
    expect(setupSubmissionSchema.safeParse(tooMany).success).toBe(false);

    const blankModel = submission();
    blankModel.players[3]!.modelId = " ";
    expect(setupSubmissionSchema.safeParse(blankModel).success).toBe(false);
  });

  it("rejects role distributions that exceed the Werewolf cap or omit the Seer", () => {
    const tooManyWolves = submission(6);
    tooManyWolves.roleCounts = {
      WEREWOLF: 3,
      SEER: 1,
      DOCTOR: 1,
      WITCH: 0,
      VILLAGER: 1,
    };
    expect(setupSubmissionSchema.safeParse(tooManyWolves).success).toBe(false);
    const noSeer = submission(8);
    noSeer.roleCounts = {
      WEREWOLF: 2,
      SEER: 0,
      DOCTOR: 1,
      WITCH: 1,
      VILLAGER: 4,
    };
    expect(setupSubmissionSchema.safeParse(noSeer).success).toBe(false);
  });

  it("describes the fixed role preset for each supported player count", () => {
    expect(roleDistributionLabel(6)).toBe(
      "1 Werewolf · 1 Seer · 1 Doctor · 3 Villagers",
    );
    expect(roleDistributionLabel(8)).toBe(
      "2 Werewolves · 1 Seer · 1 Doctor · 4 Villagers",
    );
    expect(roleDistributionLabel(12)).toBe(
      "3 Werewolves · 1 Seer · 1 Doctor · 7 Villagers",
    );
  });
});
