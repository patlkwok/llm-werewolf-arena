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
} from "./types";

export const PLAYER_COUNT = 8;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const V1_ROLE_COUNTS: Readonly<Record<Role, number>> = {
  [Role.WEREWOLF]: 2,
  [Role.SEER]: 1,
  [Role.DOCTOR]: 1,
  [Role.VILLAGER]: 4,
};

const playerSetupSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  modelId: z.string().trim().min(1),
});

const setupSchema = z
  .array(playerSetupSchema)
  .length(PLAYER_COUNT)
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

const V1_ROLES: readonly Role[] = Object.entries(V1_ROLE_COUNTS).flatMap(
  ([role, count]) => Array<Role>(count).fill(role as Role),
);

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

  const seed = normalizeSeed(options.seed ?? Date.now());
  const random = createSeededRandom(seed);
  const roles = shuffled(V1_ROLES, random);
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
    phase: Phase.NIGHT_DOCTOR,
    winner: null,
    rules,
    players,
    nightNumber: 0,
    dayNumber: 0,
    previousNightDoctorTargetId: null,
    werewolfProposerSeat: initialProposer.seat,
    dayStartMarkerSeat: PLAYER_COUNT - 1,
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
