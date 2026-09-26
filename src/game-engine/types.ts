import type { GameEvent } from "./events";

export type PlayerId = string;

export enum Role {
  WEREWOLF = "WEREWOLF",
  SEER = "SEER",
  DOCTOR = "DOCTOR",
  WITCH = "WITCH",
  VILLAGER = "VILLAGER",
}

export enum Team {
  WEREWOLVES = "WEREWOLVES",
  VILLAGE = "VILLAGE",
}

export enum GameStatus {
  ACTIVE = "ACTIVE",
  COMPLETE = "COMPLETE",
  ABANDONED = "ABANDONED",
}

export enum Phase {
  NIGHT_DOCTOR = "NIGHT_DOCTOR",
  NIGHT_SEER = "NIGHT_SEER",
  NIGHT_WEREWOLF_PROPOSAL = "NIGHT_WEREWOLF_PROPOSAL",
  NIGHT_WEREWOLF_RESPONSES = "NIGHT_WEREWOLF_RESPONSES",
  NIGHT_WITCH = "NIGHT_WITCH",
  DAY_DISCUSSION = "DAY_DISCUSSION",
  DAY_VOTING = "DAY_VOTING",
  DAY_FINAL_WORDS = "DAY_FINAL_WORDS",
  GAME_OVER = "GAME_OVER",
}

export enum DepartureKind {
  NIGHT_ELIMINATION = "NIGHT_ELIMINATION",
  DAY_EXILE = "DAY_EXILE",
}

export interface PlayerSetup {
  displayName: string;
  modelId: string;
}

export interface Departure {
  kind: DepartureKind;
  dayNumber: number;
  nightNumber: number;
}

export interface GamePlayer {
  id: PlayerId;
  displayName: string;
  modelId: string;
  seat: number;
  role: Role;
  isAlive: boolean;
  departure: Departure | null;
}

export interface RuleConfig {
  roleRevealOnDeparture: boolean;
  finalWordsForExiledPlayer: boolean;
  werewolfReproposal: boolean;
  strategicVoteAbstention: boolean;
  discussionRounds: 2;
}

export interface GameOptions {
  requireMoveExplanation: boolean;
  hideSpoilersUntilEnd: boolean;
}

export type RoleCounts = Readonly<Record<Role, number>>;

export const DEFAULT_RULES: Readonly<RuleConfig> = {
  roleRevealOnDeparture: false,
  finalWordsForExiledPlayer: true,
  werewolfReproposal: false,
  strategicVoteAbstention: false,
  discussionRounds: 2,
};

export type DiscussionAction =
  { action: "speak"; message: string } | { action: "pass" };

export type DoctorAction = { action: "protect"; targetPlayerId: PlayerId };
export type SeerAction = { action: "inspect"; targetPlayerId: PlayerId };
export type WitchAction = {
  action: "use_potions";
  useSavePotion: boolean;
  eliminatePlayerId: PlayerId | null;
};
export type WerewolfProposalAction = {
  action: "propose_elimination";
  targetPlayerId: PlayerId;
};
export type WerewolfResponseAction =
  { action: "agree" } | { action: "disagree" };
export type VoteAction =
  { action: "vote"; targetPlayerId: PlayerId } | { action: "abstain" };
export type FinalWordsAction = { action: "final_words"; message: string };

export type GameAction =
  | DiscussionAction
  | DoctorAction
  | SeerAction
  | WitchAction
  | WerewolfProposalAction
  | WerewolfResponseAction
  | VoteAction
  | FinalWordsAction;

export type PendingAction =
  | {
      kind: "DOCTOR_PROTECT";
      playerId: PlayerId;
      legalTargetIds: PlayerId[];
    }
  | {
      kind: "SEER_INSPECT";
      playerId: PlayerId;
      legalTargetIds: PlayerId[];
    }
  | {
      kind: "WEREWOLF_PROPOSE";
      playerId: PlayerId;
      attemptNumber: 1 | 2;
      legalTargetIds: PlayerId[];
    }
  | {
      kind: "WEREWOLF_RESPOND";
      playerId: PlayerId;
      attemptNumber: 1 | 2;
      proposalTargetId: PlayerId;
    }
  | {
      kind: "WITCH_ACT";
      playerId: PlayerId;
      werewolfTargetId: PlayerId | null;
      canSave: boolean;
      canEliminate: boolean;
      legalEliminationTargetIds: PlayerId[];
    }
  | {
      kind: "DISCUSS";
      playerId: PlayerId;
      dayNumber: number;
      roundNumber: 1 | 2;
    }
  | {
      kind: "VOTE";
      playerId: PlayerId;
      dayNumber: number;
      legalTargetIds: PlayerId[];
      strategicAbstentionAllowed: boolean;
    }
  | {
      kind: "FINAL_WORDS";
      playerId: PlayerId;
      dayNumber: number;
    };

export type ActionSource = "MODEL" | "FALLBACK";

export interface SeerInspection {
  nightNumber: number;
  seerId: PlayerId;
  targetPlayerId: PlayerId;
  result: "WEREWOLF" | "NOT_WEREWOLF";
}

export interface WerewolfResponse {
  playerId: PlayerId;
  response: "AGREE" | "DISAGREE";
  source: ActionSource;
}

export interface WerewolfAttempt {
  attemptNumber: 1 | 2;
  proposerId: PlayerId;
  targetPlayerId: PlayerId | null;
  proposalSource: ActionSource | null;
  responses: WerewolfResponse[];
  succeeded: boolean | null;
}

export type NightOutcome =
  "ELIMINATED" | "PROTECTED" | "NO_AGREEMENT" | "NO_PROPOSAL";

export interface NightRecord {
  nightNumber: number;
  doctorTargetId: PlayerId | null;
  doctorActionSource: ActionSource | null;
  seerInspection: SeerInspection | null;
  werewolfAttempts: WerewolfAttempt[];
  initialWerewolfProposerId: PlayerId;
  selectedTargetId: PlayerId | null;
  eliminatedPlayerId: PlayerId | null;
  witchSaved?: boolean;
  witchEliminationTargetId?: PlayerId | null;
  witchEliminatedPlayerId?: PlayerId | null;
  outcome: NightOutcome | null;
}

export interface DiscussionEntry {
  dayNumber: number;
  roundNumber: 1 | 2;
  playerId: PlayerId;
  action: "SPEAK" | "PASS";
  message: string | null;
  source: ActionSource;
}

export interface VoteRecord {
  dayNumber: number;
  voterId: PlayerId;
  targetPlayerId: PlayerId | null;
  kind: "VOTE" | "STRATEGIC_ABSTAIN" | "FALLBACK_ABSTAIN";
}

export interface VoteResult {
  tally: Record<PlayerId, number>;
  exiledPlayerId: PlayerId | null;
  tiedPlayerIds: PlayerId[];
}

export interface FinalWordsRecord {
  dayNumber: number;
  playerId: PlayerId;
  message: string | null;
  source: ActionSource;
}

export interface DayRecord {
  dayNumber: number;
  speakingOrder: PlayerId[];
  discussionRound: 1 | 2;
  discussionTurnIndex: number;
  discussion: DiscussionEntry[];
  voteTurnIndex: number;
  votes: VoteRecord[];
  voteResult: VoteResult | null;
  exiledPlayerId: PlayerId | null;
  finalWords: FinalWordsRecord | null;
}

export interface GameState {
  id: string;
  seed: number;
  status: GameStatus;
  phase: Phase;
  winner: Team | null;
  rules: RuleConfig;
  options?: GameOptions;
  witchPotions?: { saveAvailable: boolean; eliminationAvailable: boolean };
  players: GamePlayer[];
  nightNumber: number;
  dayNumber: number;
  previousNightDoctorTargetId: PlayerId | null;
  werewolfProposerSeat: number;
  dayStartMarkerSeat: number;
  currentNight: NightRecord | null;
  currentDay: DayRecord | null;
  nightHistory: NightRecord[];
  dayHistory: DayRecord[];
  seerResults: SeerInspection[];
  events: GameEvent[];
  nextEventSequence: number;
}

export type EngineErrorCode =
  | "INVALID_SETUP"
  | "GAME_OVER"
  | "WRONG_ACTOR"
  | "WRONG_ACTION"
  | "EMPTY_MESSAGE"
  | "TARGET_NOT_LIVING"
  | "SELF_TARGET_NOT_ALLOWED"
  | "CONSECUTIVE_DOCTOR_TARGET"
  | "WITCH_POTION_UNAVAILABLE"
  | "WITCH_TARGET_NOT_ALLOWED"
  | "WEREWOLF_TARGET_NOT_ALLOWED"
  | "STRATEGIC_ABSTENTION_DISABLED"
  | "NO_PENDING_ACTION";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type EngineResult<T> =
  { ok: true; value: T } | { ok: false; error: EngineError };

export interface CreateGameOptions {
  seed?: number;
  gameId?: string;
  rules?: Partial<Omit<RuleConfig, "discussionRounds">>;
  roleCounts?: RoleCounts;
  experience?: Partial<GameOptions>;
}
