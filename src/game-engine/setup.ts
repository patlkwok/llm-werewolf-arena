import { z } from "zod";
import { emitGameEvent, EventVisibility } from "./events";
import { createSeededRandom, normalizeSeed, shuffled } from "./random";
import {
  DEFAULT_RULES,
  type CreateGameOptions,
  type EngineResult,
  type GamePlayer,
  GameStatus,
  Phase,
  Role,
  type GameState,
  type PlayerSetup,
  type RoleCounts,
} from "./types";

export const MIN_PLAYER_COUNT = 6;
export const MAX_PLAYER_COUNT = 12;
export const DEFAULT_PLAYER_COUNT = 8;
export const MAX_DISPLAY_NAME_LENGTH = 40;

export type { RoleCounts } from "./types";

export const ROLE_DISTRIBUTIONS = {
  6: { WEREWOLF: 1, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 3 },
  7: { WEREWOLF: 2, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 3 },
  8: { WEREWOLF: 2, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 4 },
  9: { WEREWOLF: 2, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 5 },
  10: { WEREWOLF: 3, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 5 },
  11: { WEREWOLF: 3, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 6 },
  12: { WEREWOLF: 3, SEER: 1, DOCTOR: 1, WITCH: 0, VILLAGER: 7 },
} as const satisfies Record<number, RoleCounts>;

export function roleCountsForPlayerCount(
  playerCount: number,
): RoleCounts | null {
  return Object.hasOwn(ROLE_DISTRIBUTIONS, playerCount)
    ? ROLE_DISTRIBUTIONS[playerCount as keyof typeof ROLE_DISTRIBUTIONS]
    : null;
}

export function validateRoleCounts(
  playerCount: number,
  counts: RoleCounts,
): string | null {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < MIN_PLAYER_COUNT ||
    playerCount > MAX_PLAYER_COUNT
  )
    return "Player count must be between 6 and 12.";
  if (
    Object.keys(counts).sort().join(",") !==
    Object.values(Role).sort().join(",")
  )
    return "Role distribution contains an unknown or missing role.";
  if (
    Object.values(counts).some((count) => !Number.isInteger(count) || count < 0)
  )
    return "Role counts must be nonnegative whole numbers.";
  if (counts.WEREWOLF < 1 || counts.WEREWOLF > Math.floor(playerCount / 3))
    return "Werewolf count must be between 1 and one third of the players.";
  if (counts.SEER !== 1 || counts.DOCTOR > 1 || counts.WITCH > 1)
    return "Use one Seer and at most one Doctor and one Witch.";
  if (
    Object.values(counts).reduce((sum, count) => sum + count, 0) !== playerCount
  )
    return "Role counts must add up to the player count.";
  return null;
}

const playerSetupSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  modelId: z.string().trim().min(1),
});

const setupSchema = z
  .array(playerSetupSchema)
  .min(MIN_PLAYER_COUNT)
  .max(MAX_PLAYER_COUNT)
  .superRefine((players, context) => {
    const seen = new Set<string>();
    for (const [index, player] of players.entries()) {
      const normalizedName = player.displayName.toLocaleLowerCase("en-US");
      if (seen.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          message: "Player display names must be unique case-insensitively.",
          path: [index, "displayName"],
        });
      }
      seen.add(normalizedName);
    }
  });

export function createGame(
  playerSetups: readonly PlayerSetup[],
  options: CreateGameOptions = {},
): EngineResult<GameState> {
  const parsed = setupSchema.safeParse(playerSetups);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_SETUP",
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
      },
    };
  }

  const roleCounts =
    options.roleCounts ?? roleCountsForPlayerCount(parsed.data.length);
  if (!roleCounts) {
    return {
      ok: false,
      error: {
        code: "INVALID_SETUP",
        message: "No role distribution exists for this player count.",
      },
    };
  }
  const roleError = validateRoleCounts(parsed.data.length, roleCounts);
  if (roleError)
    return { ok: false, error: { code: "INVALID_SETUP", message: roleError } };

  const seed = normalizeSeed(options.seed ?? Date.now());
  const random = createSeededRandom(seed);
  const roles = shuffled(
    Object.entries(roleCounts).flatMap(([role, count]) =>
      Array<Role>(count).fill(role as Role),
    ),
    random,
  );
  const players: GamePlayer[] = parsed.data.map((setup, seat) => ({
    id: `player-${seat + 1}`,
    displayName: setup.displayName,
    modelId: setup.modelId,
    seat,
    role: roles[seat]!,
    isAlive: true,
    departure: null,
  }));
  const werewolves = players.filter((player) => player.role === Role.WEREWOLF);
  const initialProposer = werewolves[Math.floor(random() * werewolves.length)]!;
  const rules = {
    ...DEFAULT_RULES,
    ...options.rules,
    discussionRounds: 2 as const,
  };

  const state: GameState = {
    id: options.gameId ?? `game-${seed.toString(16)}`,
    seed,
    status: GameStatus.ACTIVE,
    phase: roleCounts.DOCTOR === 1 ? Phase.NIGHT_DOCTOR : Phase.NIGHT_SEER,
    winner: null,
    rules,
    options: {
      requireMoveExplanation:
        options.experience?.requireMoveExplanation ?? false,
      hideSpoilersUntilEnd: options.experience?.hideSpoilersUntilEnd ?? false,
    },
    witchPotions: {
      saveAvailable: roleCounts.WITCH === 1,
      eliminationAvailable: roleCounts.WITCH === 1,
    },
    players,
    nightNumber: 0,
    dayNumber: 0,
    previousNightDoctorTargetId: null,
    werewolfProposerSeat: initialProposer.seat,
    dayStartMarkerSeat: players.length - 1,
    currentNight: {
      nightNumber: 0,
      doctorTargetId: null,
      doctorActionSource: null,
      seerInspection: null,
      werewolfAttempts: [],
      initialWerewolfProposerId: initialProposer.id,
      selectedTargetId: null,
      eliminatedPlayerId: null,
      outcome: null,
    },
    currentDay: null,
    nightHistory: [],
    dayHistory: [],
    seerResults: [],
    events: [],
    nextEventSequence: 1,
  };
  emitGameEvent(
    state,
    "GAME_STARTED",
    { gameId: state.id, nightNumber: 0 },
    { visibility: EventVisibility.PUBLIC },
  );
  emitGameEvent(
    state,
    "ROLES_ASSIGNED",
    {
      assignments: state.players.map((player) => ({
        playerId: player.id,
        role: player.role,
      })),
    },
    { visibility: EventVisibility.SPECTATOR_ONLY },
  );
  emitGameEvent(
    state,
    "NIGHT_STARTED",
    { nightNumber: 0 },
    { visibility: EventVisibility.PUBLIC },
  );

  return {
    ok: true,
    value: state,
  };
}
