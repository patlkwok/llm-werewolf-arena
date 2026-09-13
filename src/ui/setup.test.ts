import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_NAMES, setupSubmissionSchema } from "./setup";

function submission(): {
  players: { displayName: string; modelId: string }[];
  rules: {
    roleRevealOnDeparture: boolean;
    finalWordsForExiledPlayer: boolean;
    werewolfReproposal: boolean;
    strategicVoteAbstention: boolean;
  };
} {
  return {
    players: DEFAULT_PLAYER_NAMES.map((displayName) => ({
      displayName,
      modelId: "same/model",
    })),
    rules: {
      roleRevealOnDeparture: false,
      finalWordsForExiledPlayer: true,
      werewolfReproposal: false,
      strategicVoteAbstention: false,
    },
  };
}

describe("setup submission", () => {
  it("accepts exactly eight unique names and duplicate model choices", () => {
    const parsed = setupSubmissionSchema.parse(submission());
    expect(parsed.players).toHaveLength(8);
    expect(new Set(parsed.players.map((player) => player.modelId))).toEqual(
      new Set(["same/model"]),
    );
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

  it("rejects missing seats and blank model selections", () => {
    const missing = submission();
    missing.players.pop();
    expect(setupSubmissionSchema.safeParse(missing).success).toBe(false);

    const blankModel = submission();
    blankModel.players[3]!.modelId = " ";
    expect(setupSubmissionSchema.safeParse(blankModel).success).toBe(false);
  });
});
