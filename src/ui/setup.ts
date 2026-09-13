import { z } from "zod";
import { MAX_DISPLAY_NAME_LENGTH, PLAYER_COUNT } from "@/game-engine/setup";

const playerSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  modelId: z.string().trim().min(1),
});

export const setupSubmissionSchema = z
  .object({
    players: z.array(playerSchema).length(PLAYER_COUNT),
    rules: z.object({
      roleRevealOnDeparture: z.boolean(),
      finalWordsForExiledPlayer: z.boolean(),
      werewolfReproposal: z.boolean(),
      strategicVoteAbstention: z.boolean(),
    }),
  })
  .strict()
  .superRefine((submission, context) => {
    const names = new Set<string>();
    submission.players.forEach((player, index) => {
      const normalized = player.displayName.toLocaleLowerCase("en-US");
      if (names.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["players", index, "displayName"],
          message: "Names must be unique, ignoring capitalization.",
        });
      }
      names.add(normalized);
    });
  });

export type SetupSubmission = z.infer<typeof setupSubmissionSchema>;

export const DEFAULT_PLAYER_NAMES = [
  "Ash",
  "Briar",
  "Cinder",
  "Dove",
  "Ember",
  "Flint",
  "Gale",
  "Hollis",
] as const;
