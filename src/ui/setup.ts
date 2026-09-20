import { z } from "zod";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  roleCountsForPlayerCount,
} from "@/game-engine/setup";
import { Role } from "@/game-engine/types";

const playerSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  modelId: z.string().trim().min(1),
});

export const setupSubmissionSchema = z
  .object({
    players: z.array(playerSchema).min(MIN_PLAYER_COUNT).max(MAX_PLAYER_COUNT),
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
  "Juniper",
  "Lark",
  "Moss",
  "Rowan",
] as const;

export function roleDistributionLabel(playerCount: number): string {
  const counts = roleCountsForPlayerCount(playerCount);
  if (!counts) return "No role preset available";
  return [
    roleLabel(counts[Role.WEREWOLF], "Werewolf", "Werewolves"),
    roleLabel(counts[Role.SEER], "Seer", "Seers"),
    roleLabel(counts[Role.DOCTOR], "Doctor", "Doctors"),
    roleLabel(counts[Role.VILLAGER], "Villager", "Villagers"),
  ].join(" · ");
}

function roleLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
