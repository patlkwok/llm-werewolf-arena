import type {
  ActionSource,
  GameState,
  NightOutcome,
  PlayerId,
  Role,
  Team,
  VoteResult,
} from "./types";

export enum EventVisibility {
  PUBLIC = "PUBLIC",
  PLAYER_PRIVATE = "PLAYER_PRIVATE",
  WEREWOLF_PRIVATE = "WEREWOLF_PRIVATE",
  SPECTATOR_ONLY = "SPECTATOR_ONLY",
}

export interface GameEventPayloads {
  GAME_STARTED: { gameId: string; nightNumber: 0 };
  ROLES_ASSIGNED: { assignments: Array<{ playerId: PlayerId; role: Role }> };
  NIGHT_STARTED: { nightNumber: number };
  DOCTOR_PROTECTION_RESOLVED: {
    playerId: PlayerId;
    targetPlayerId: PlayerId | null;
    source: ActionSource;
  };
  SEER_INSPECTED: {
    playerId: PlayerId;
    targetPlayerId: PlayerId;
    result: "WEREWOLF" | "NOT_WEREWOLF";
  };
  WEREWOLF_PROPOSED_TARGET: {
    proposerId: PlayerId;
    targetPlayerId: PlayerId;
    attemptNumber: 1 | 2;
  };
  WEREWOLF_RESPONDED: {
    playerId: PlayerId;
    response: "AGREE" | "DISAGREE";
    attemptNumber: 1 | 2;
  };
  WEREWOLF_PROPOSAL_FAILED: { attemptNumber: 1 | 2 };
  NIGHT_RESOLUTION_DETAIL: {
    nightNumber: number;
    outcome: NightOutcome;
    selectedTargetId: PlayerId | null;
    protectedTargetId: PlayerId | null;
  };
  NIGHT_RESOLVED: { nightNumber: number; eliminatedPlayerId: PlayerId | null };
  PLAYER_ELIMINATED: { playerId: PlayerId; nightNumber: number };
  DAY_STARTED: { dayNumber: number; speakingOrder: PlayerId[] };
  DISCUSSION_ROUND_STARTED: { dayNumber: number; roundNumber: 1 | 2 };
  PLAYER_SPOKE: {
    dayNumber: number;
    roundNumber: 1 | 2;
    playerId: PlayerId;
    message: string;
  };
  PLAYER_PASSED: { dayNumber: number; roundNumber: 1 | 2; playerId: PlayerId };
  VOTING_STARTED: { dayNumber: number; votingOrder: PlayerId[] };
  PLAYER_VOTED: {
    dayNumber: number;
    playerId: PlayerId;
    targetPlayerId: PlayerId | null;
    kind: "VOTE" | "STRATEGIC_ABSTAIN" | "FALLBACK_ABSTAIN";
  };
  VOTE_RESOLVED: { dayNumber: number; result: VoteResult };
  PLAYER_EXILED: { playerId: PlayerId; dayNumber: number };
  ROLE_REVEALED: { playerId: PlayerId; role: Role };
  FINAL_WORDS: { playerId: PlayerId; dayNumber: number; message: string };
  FALLBACK_APPLIED: { playerId: PlayerId; actionKind: string };
  GAME_ABORTED: { reason: "OPERATOR_ENDED" };
  GAME_ENDED: { winner: Team };
}

export type GameEventType = keyof GameEventPayloads;

export type GameEvent = {
  [Type in GameEventType]: {
    sequence: number;
    type: Type;
    visibility: EventVisibility;
    audiencePlayerIds: PlayerId[];
    payload: GameEventPayloads[Type];
  };
}[GameEventType];

export interface EventOptions {
  visibility: EventVisibility;
  audiencePlayerIds?: PlayerId[];
}

export function emitGameEvent<Type extends GameEventType>(
  state: GameState,
  type: Type,
  payload: GameEventPayloads[Type],
  options: EventOptions,
): void {
  state.events.push({
    sequence: state.nextEventSequence,
    type,
    visibility: options.visibility,
    audiencePlayerIds: options.audiencePlayerIds ?? [],
    payload,
  } as GameEvent);
  state.nextEventSequence += 1;
}
