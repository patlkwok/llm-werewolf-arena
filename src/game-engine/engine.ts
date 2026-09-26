import {
  clockwiseLivingOrder,
  evaluateWinner,
  livingPlayers,
  nextLivingSeat,
  playersWithRole,
  resolveVotes,
} from "./rules";
import { emitGameEvent, EventVisibility } from "./events";
import {
  type ActionSource,
  DepartureKind,
  type DiscussionAction,
  type DoctorAction,
  type EngineErrorCode,
  type EngineResult,
  type FinalWordsAction,
  type GameAction,
  type GamePlayer,
  type GameState,
  GameStatus,
  type PendingAction,
  Phase,
  type PlayerId,
  Role,
  type SeerAction,
  type VoteAction,
  type WerewolfProposalAction,
  type WerewolfResponseAction,
  type WitchAction,
} from "./types";

function success(state: GameState): EngineResult<GameState> {
  return { ok: true, value: state };
}

function failure(
  code: EngineErrorCode,
  message: string,
): EngineResult<GameState> {
  return { ok: false, error: { code, message } };
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function requiredPlayer(state: GameState, playerId: PlayerId): GamePlayer {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Invariant violation: missing player ${playerId}.`);
  }
  return player;
}

function currentAttempt(state: GameState) {
  const attempt = state.currentNight?.werewolfAttempts.at(-1);
  if (!attempt) {
    throw new Error("Invariant violation: no current Werewolf attempt.");
  }
  return attempt;
}

export function getPendingAction(state: GameState): PendingAction | null {
  if (state.status !== GameStatus.ACTIVE) {
    return null;
  }

  switch (state.phase) {
    case Phase.NIGHT_DOCTOR: {
      const doctor = playersWithRole(state.players, Role.DOCTOR, true)[0];
      if (!doctor) return null;
      return {
        kind: "DOCTOR_PROTECT",
        playerId: doctor.id,
        legalTargetIds: livingPlayers(state.players)
          .filter((player) => player.id !== state.previousNightDoctorTargetId)
          .map((player) => player.id),
      };
    }
    case Phase.NIGHT_SEER: {
      const seer = playersWithRole(state.players, Role.SEER, true)[0];
      if (!seer) return null;
      return {
        kind: "SEER_INSPECT",
        playerId: seer.id,
        legalTargetIds: livingPlayers(state.players)
          .filter((player) => player.id !== seer.id)
          .map((player) => player.id),
      };
    }
    case Phase.NIGHT_WEREWOLF_PROPOSAL: {
      const attempt = currentAttempt(state);
      return {
        kind: "WEREWOLF_PROPOSE",
        playerId: attempt.proposerId,
        attemptNumber: attempt.attemptNumber,
        legalTargetIds: livingPlayers(state.players)
          .filter((player) => player.role !== Role.WEREWOLF)
          .map((player) => player.id),
      };
    }
    case Phase.NIGHT_WEREWOLF_RESPONSES: {
      const attempt = currentAttempt(state);
      if (attempt.targetPlayerId === null) return null;
      const responder = playersWithRole(state.players, Role.WEREWOLF, true)
        .filter(
          (player) =>
            player.id !== attempt.proposerId &&
            !attempt.responses.some(
              (response) => response.playerId === player.id,
            ),
        )
        .sort((left, right) => left.seat - right.seat)[0];
      if (!responder) return null;
      return {
        kind: "WEREWOLF_RESPOND",
        playerId: responder.id,
        attemptNumber: attempt.attemptNumber,
        proposalTargetId: attempt.targetPlayerId,
      };
    }
    case Phase.NIGHT_WITCH: {
      const witch = playersWithRole(state.players, Role.WITCH, true)[0];
      if (!witch) return null;
      const potions = state.witchPotions;
      return {
        kind: "WITCH_ACT",
        playerId: witch.id,
        werewolfTargetId: state.currentNight?.selectedTargetId ?? null,
        canSave: Boolean(
          potions?.saveAvailable && state.currentNight?.selectedTargetId,
        ),
        canEliminate: Boolean(potions?.eliminationAvailable),
        legalEliminationTargetIds: livingPlayers(state.players)
          .filter((player) => player.id !== witch.id)
          .map((player) => player.id),
      };
    }
    case Phase.DAY_DISCUSSION: {
      const day = state.currentDay;
      if (!day) return null;
      return {
        kind: "DISCUSS",
        playerId: day.speakingOrder[day.discussionTurnIndex]!,
        dayNumber: day.dayNumber,
        roundNumber: day.discussionRound,
      };
    }
    case Phase.DAY_VOTING: {
      const day = state.currentDay;
      if (!day) return null;
      const voterId = day.speakingOrder[day.voteTurnIndex]!;
      return {
        kind: "VOTE",
        playerId: voterId,
        dayNumber: day.dayNumber,
        legalTargetIds: livingPlayers(state.players)
          .filter((player) => player.id !== voterId)
          .map((player) => player.id),
        strategicAbstentionAllowed: state.rules.strategicVoteAbstention,
      };
    }
    case Phase.DAY_FINAL_WORDS: {
      const day = state.currentDay;
      if (!day?.exiledPlayerId) return null;
      return {
        kind: "FINAL_WORDS",
        playerId: day.exiledPlayerId,
        dayNumber: day.dayNumber,
      };
    }
    case Phase.GAME_OVER:
      return null;
  }
}

export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: GameAction,
): EngineResult<GameState> {
  if (state.status !== GameStatus.ACTIVE) {
    return failure("GAME_OVER", "The game has already ended.");
  }

  const pending = getPendingAction(state);
  if (!pending) {
    return failure(
      "NO_PENDING_ACTION",
      "The current state has no pending player action.",
    );
  }
  if (pending.playerId !== playerId) {
    return failure(
      "WRONG_ACTOR",
      `It is ${pending.playerId}'s turn, not ${playerId}'s.`,
    );
  }

  switch (pending.kind) {
    case "DOCTOR_PROTECT":
      if (action.action !== "protect") return wrongAction("protect");
      return applyDoctorAction(state, pending, action, "MODEL");
    case "SEER_INSPECT":
      if (action.action !== "inspect") return wrongAction("inspect");
      return applySeerAction(state, pending, action);
    case "WEREWOLF_PROPOSE":
      if (action.action !== "propose_elimination") {
        return wrongAction("propose_elimination");
      }
      return applyWerewolfProposal(state, pending, action, "MODEL");
    case "WEREWOLF_RESPOND":
      if (action.action !== "agree" && action.action !== "disagree") {
        return wrongAction("agree or disagree");
      }
      return applyWerewolfResponse(state, action, "MODEL");
    case "WITCH_ACT":
      if (action.action !== "use_potions") return wrongAction("use_potions");
      return applyWitchAction(state, pending, action, "MODEL");
    case "DISCUSS":
      if (action.action !== "speak" && action.action !== "pass") {
        return wrongAction("speak or pass");
      }
      return applyDiscussionAction(state, action, "MODEL");
    case "VOTE":
      if (action.action !== "vote" && action.action !== "abstain") {
        return wrongAction("vote or abstain");
      }
      return applyVoteAction(state, pending, action);
    case "FINAL_WORDS":
      if (action.action !== "final_words") return wrongAction("final_words");
      return applyFinalWordsAction(state, action, "MODEL");
  }
}

export function applyFallback(state: GameState): EngineResult<GameState> {
  if (state.status !== GameStatus.ACTIVE) {
    return failure("GAME_OVER", "The game has already ended.");
  }
  const pending = getPendingAction(state);
  if (!pending) {
    return failure(
      "NO_PENDING_ACTION",
      "The current state has no pending player action.",
    );
  }

  const next = cloneState(state);
  emitGameEvent(
    next,
    "FALLBACK_APPLIED",
    { playerId: pending.playerId, actionKind: pending.kind },
    { visibility: EventVisibility.SPECTATOR_ONLY },
  );
  switch (pending.kind) {
    case "DOCTOR_PROTECT":
      next.currentNight!.doctorTargetId = null;
      next.currentNight!.doctorActionSource = "FALLBACK";
      next.previousNightDoctorTargetId = null;
      emitGameEvent(
        next,
        "DOCTOR_PROTECTION_RESOLVED",
        {
          playerId: pending.playerId,
          targetPlayerId: null,
          source: "FALLBACK",
        },
        {
          visibility: EventVisibility.PLAYER_PRIVATE,
          audiencePlayerIds: [pending.playerId],
        },
      );
      advanceAfterDoctor(next);
      break;
    case "SEER_INSPECT":
      advanceAfterSeer(next);
      break;
    case "WEREWOLF_PROPOSE": {
      const attempt = currentAttempt(next);
      attempt.targetPlayerId = null;
      attempt.proposalSource = "FALLBACK";
      attempt.succeeded = false;
      finishFailedWerewolfAttempt(next);
      break;
    }
    case "WEREWOLF_RESPOND":
      recordWerewolfResponse(next, pending.playerId, "DISAGREE", "FALLBACK");
      break;
    case "WITCH_ACT":
      recordWitchAction(next, pending.playerId, false, null, "FALLBACK");
      break;
    case "DISCUSS":
      recordDiscussion(next, { action: "pass" }, "FALLBACK");
      break;
    case "VOTE":
      recordVote(next, pending.playerId, null, "FALLBACK_ABSTAIN");
      break;
    case "FINAL_WORDS":
      recordFinalWords(next, null, "FALLBACK");
      break;
  }
  return success(next);
}

export function abortGame(state: GameState): EngineResult<GameState> {
  if (state.status !== GameStatus.ACTIVE) {
    return failure("GAME_OVER", "The game has already ended.");
  }
  const next = cloneState(state);
  next.status = GameStatus.ABANDONED;
  next.phase = Phase.GAME_OVER;
  next.winner = null;
  emitGameEvent(
    next,
    "GAME_ABORTED",
    { reason: "OPERATOR_ENDED" },
    { visibility: EventVisibility.PUBLIC },
  );
  return success(next);
}

function wrongAction(expected: string): EngineResult<GameState> {
  return failure("WRONG_ACTION", `This phase requires a ${expected} action.`);
}

function applyDoctorAction(
  state: GameState,
  pending: Extract<PendingAction, { kind: "DOCTOR_PROTECT" }>,
  action: DoctorAction,
  source: ActionSource,
): EngineResult<GameState> {
  const target = state.players.find(
    (player) => player.id === action.targetPlayerId,
  );
  if (!target?.isAlive) {
    return failure(
      "TARGET_NOT_LIVING",
      "The Doctor must protect a living player.",
    );
  }
  if (state.previousNightDoctorTargetId === action.targetPlayerId) {
    return failure(
      "CONSECUTIVE_DOCTOR_TARGET",
      "The Doctor cannot protect the same player on consecutive nights.",
    );
  }
  if (!pending.legalTargetIds.includes(action.targetPlayerId)) {
    return failure(
      "TARGET_NOT_LIVING",
      "That player is not a legal Doctor target.",
    );
  }

  const next = cloneState(state);
  next.currentNight!.doctorTargetId = action.targetPlayerId;
  next.currentNight!.doctorActionSource = source;
  next.previousNightDoctorTargetId = action.targetPlayerId;
  emitGameEvent(
    next,
    "DOCTOR_PROTECTION_RESOLVED",
    {
      playerId: pending.playerId,
      targetPlayerId: action.targetPlayerId,
      source,
    },
    {
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [pending.playerId],
    },
  );
  advanceAfterDoctor(next);
  return success(next);
}

function applySeerAction(
  state: GameState,
  pending: Extract<PendingAction, { kind: "SEER_INSPECT" }>,
  action: SeerAction,
): EngineResult<GameState> {
  const target = state.players.find(
    (player) => player.id === action.targetPlayerId,
  );
  if (!target?.isAlive) {
    return failure(
      "TARGET_NOT_LIVING",
      "The Seer must inspect a living player.",
    );
  }
  if (action.targetPlayerId === pending.playerId) {
    return failure(
      "SELF_TARGET_NOT_ALLOWED",
      "The Seer cannot inspect themselves.",
    );
  }

  const next = cloneState(state);
  const inspection = {
    nightNumber: next.nightNumber,
    seerId: pending.playerId,
    targetPlayerId: action.targetPlayerId,
    result:
      target.role === Role.WEREWOLF
        ? ("WEREWOLF" as const)
        : ("NOT_WEREWOLF" as const),
  };
  next.currentNight!.seerInspection = inspection;
  next.seerResults.push(inspection);
  emitGameEvent(
    next,
    "SEER_INSPECTED",
    {
      playerId: pending.playerId,
      targetPlayerId: inspection.targetPlayerId,
      result: inspection.result,
    },
    {
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [pending.playerId],
    },
  );
  advanceAfterSeer(next);
  return success(next);
}

function applyWerewolfProposal(
  state: GameState,
  pending: Extract<PendingAction, { kind: "WEREWOLF_PROPOSE" }>,
  action: WerewolfProposalAction,
  source: ActionSource,
): EngineResult<GameState> {
  const target = state.players.find(
    (player) => player.id === action.targetPlayerId,
  );
  if (!target?.isAlive) {
    return failure(
      "TARGET_NOT_LIVING",
      "Werewolves must target a living player.",
    );
  }
  if (
    target.role === Role.WEREWOLF ||
    !pending.legalTargetIds.includes(target.id)
  ) {
    return failure(
      "WEREWOLF_TARGET_NOT_ALLOWED",
      "A Werewolf cannot target a Werewolf.",
    );
  }

  const next = cloneState(state);
  const attempt = currentAttempt(next);
  attempt.targetPlayerId = action.targetPlayerId;
  attempt.proposalSource = source;
  emitGameEvent(
    next,
    "WEREWOLF_PROPOSED_TARGET",
    {
      proposerId: attempt.proposerId,
      targetPlayerId: action.targetPlayerId,
      attemptNumber: attempt.attemptNumber,
    },
    {
      visibility: EventVisibility.WEREWOLF_PRIVATE,
      audiencePlayerIds: playersWithRole(next.players, Role.WEREWOLF, true).map(
        (player) => player.id,
      ),
    },
  );
  const responders = playersWithRole(next.players, Role.WEREWOLF, true).filter(
    (player) => player.id !== attempt.proposerId,
  );
  if (responders.length === 0) {
    attempt.succeeded = true;
    beginWitchOrResolve(next, action.targetPlayerId);
  } else {
    next.phase = Phase.NIGHT_WEREWOLF_RESPONSES;
  }
  return success(next);
}

function applyWerewolfResponse(
  state: GameState,
  action: WerewolfResponseAction,
  source: ActionSource,
): EngineResult<GameState> {
  const next = cloneState(state);
  const pending = getPendingAction(next);
  if (pending?.kind !== "WEREWOLF_RESPOND") {
    return failure(
      "NO_PENDING_ACTION",
      "There is no pending Werewolf response.",
    );
  }
  recordWerewolfResponse(
    next,
    pending.playerId,
    action.action === "agree" ? "AGREE" : "DISAGREE",
    source,
  );
  return success(next);
}

function applyWitchAction(
  state: GameState,
  pending: Extract<PendingAction, { kind: "WITCH_ACT" }>,
  action: WitchAction,
  source: ActionSource,
): EngineResult<GameState> {
  if (action.useSavePotion && !pending.canSave) {
    return failure(
      "WITCH_POTION_UNAVAILABLE",
      "The save potion is unavailable or there is no Werewolf target.",
    );
  }
  if (action.eliminatePlayerId !== null && !pending.canEliminate) {
    return failure(
      "WITCH_POTION_UNAVAILABLE",
      "The elimination potion is unavailable.",
    );
  }
  if (
    action.eliminatePlayerId !== null &&
    !pending.legalEliminationTargetIds.includes(action.eliminatePlayerId)
  ) {
    return failure(
      "WITCH_TARGET_NOT_ALLOWED",
      "The Witch must eliminate another living player.",
    );
  }
  const next = cloneState(state);
  recordWitchAction(
    next,
    pending.playerId,
    action.useSavePotion,
    action.eliminatePlayerId,
    source,
  );
  return success(next);
}

function recordWitchAction(
  state: GameState,
  playerId: PlayerId,
  usedSavePotion: boolean,
  eliminationTargetId: PlayerId | null,
  source: ActionSource,
): void {
  const night = state.currentNight!;
  night.witchSaved = usedSavePotion;
  night.witchEliminationTargetId = eliminationTargetId;
  if (usedSavePotion) state.witchPotions!.saveAvailable = false;
  if (eliminationTargetId) state.witchPotions!.eliminationAvailable = false;
  emitGameEvent(
    state,
    "WITCH_ACTED",
    {
      playerId,
      werewolfTargetId: night.selectedTargetId,
      usedSavePotion,
      eliminationTargetId,
      source,
    },
    {
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [playerId],
    },
  );
  resolveNight(state, night.selectedTargetId);
}

function applyDiscussionAction(
  state: GameState,
  action: DiscussionAction,
  source: ActionSource,
): EngineResult<GameState> {
  if (action.action === "speak" && action.message.trim().length === 0) {
    return failure("EMPTY_MESSAGE", "A public statement cannot be empty.");
  }
  const next = cloneState(state);
  recordDiscussion(next, action, source);
  return success(next);
}

function applyVoteAction(
  state: GameState,
  pending: Extract<PendingAction, { kind: "VOTE" }>,
  action: VoteAction,
): EngineResult<GameState> {
  if (action.action === "abstain") {
    if (!state.rules.strategicVoteAbstention) {
      return failure(
        "STRATEGIC_ABSTENTION_DISABLED",
        "Strategic abstention is disabled for this game.",
      );
    }
    const next = cloneState(state);
    recordVote(next, pending.playerId, null, "STRATEGIC_ABSTAIN");
    return success(next);
  }

  const target = state.players.find(
    (player) => player.id === action.targetPlayerId,
  );
  if (!target?.isAlive) {
    return failure("TARGET_NOT_LIVING", "A vote must target a living player.");
  }
  if (action.targetPlayerId === pending.playerId) {
    return failure(
      "SELF_TARGET_NOT_ALLOWED",
      "A player cannot vote for themselves.",
    );
  }
  if (!pending.legalTargetIds.includes(action.targetPlayerId)) {
    return failure(
      "TARGET_NOT_LIVING",
      "That player is not a legal vote target.",
    );
  }

  const next = cloneState(state);
  recordVote(next, pending.playerId, action.targetPlayerId, "VOTE");
  return success(next);
}

function applyFinalWordsAction(
  state: GameState,
  action: FinalWordsAction,
  source: ActionSource,
): EngineResult<GameState> {
  if (action.message.trim().length === 0) {
    return failure("EMPTY_MESSAGE", "Final words cannot be empty.");
  }
  const next = cloneState(state);
  recordFinalWords(next, action.message, source);
  return success(next);
}

function advanceAfterDoctor(state: GameState): void {
  if (playersWithRole(state.players, Role.SEER, true).length > 0) {
    state.phase = Phase.NIGHT_SEER;
  } else {
    beginWerewolfAttempt(state, 1);
  }
}

function advanceAfterSeer(state: GameState): void {
  beginWerewolfAttempt(state, 1);
}

function beginWerewolfAttempt(state: GameState, attemptNumber: 1 | 2): void {
  const currentNight = state.currentNight;
  if (!currentNight) throw new Error("Invariant violation: no current night.");

  let proposer = state.players.find(
    (player) =>
      player.seat === state.werewolfProposerSeat &&
      player.isAlive &&
      player.role === Role.WEREWOLF,
  );
  if (!proposer) {
    const proposerSeat = nextLivingSeat(
      state.players,
      state.werewolfProposerSeat,
      (player) => player.role === Role.WEREWOLF,
    );
    proposer = state.players.find((player) => player.seat === proposerSeat)!;
    state.werewolfProposerSeat = proposerSeat;
  }

  if (attemptNumber === 2) {
    const previousProposer = currentAttempt(state).proposerId;
    const previousSeat = requiredPlayer(state, previousProposer).seat;
    const nextSeat = nextLivingSeat(
      state.players,
      previousSeat,
      (player) => player.role === Role.WEREWOLF,
    );
    proposer = state.players.find((player) => player.seat === nextSeat)!;
  } else {
    currentNight.initialWerewolfProposerId = proposer.id;
  }

  currentNight.werewolfAttempts.push({
    attemptNumber,
    proposerId: proposer.id,
    targetPlayerId: null,
    proposalSource: null,
    responses: [],
    succeeded: null,
  });
  state.phase = Phase.NIGHT_WEREWOLF_PROPOSAL;
}

function recordWerewolfResponse(
  state: GameState,
  playerId: PlayerId,
  response: "AGREE" | "DISAGREE",
  source: ActionSource,
): void {
  const attempt = currentAttempt(state);
  attempt.responses.push({ playerId, response, source });
  emitGameEvent(
    state,
    "WEREWOLF_RESPONDED",
    { playerId, response, attemptNumber: attempt.attemptNumber },
    {
      visibility: EventVisibility.PLAYER_PRIVATE,
      audiencePlayerIds: [playerId],
    },
  );
  const requiredResponderCount =
    playersWithRole(state.players, Role.WEREWOLF, true).length - 1;
  if (attempt.responses.length < requiredResponderCount) {
    return;
  }

  attempt.succeeded = attempt.responses.every(
    (item) => item.response === "AGREE",
  );
  if (attempt.succeeded) {
    beginWitchOrResolve(state, attempt.targetPlayerId);
  } else {
    finishFailedWerewolfAttempt(state);
  }
}

function finishFailedWerewolfAttempt(state: GameState): void {
  const attempt = currentAttempt(state);
  attempt.succeeded = false;
  emitGameEvent(
    state,
    "WEREWOLF_PROPOSAL_FAILED",
    { attemptNumber: attempt.attemptNumber },
    {
      visibility: EventVisibility.WEREWOLF_PRIVATE,
      audiencePlayerIds: playersWithRole(
        state.players,
        Role.WEREWOLF,
        true,
      ).map((player) => player.id),
    },
  );
  if (attempt.attemptNumber === 1 && state.rules.werewolfReproposal) {
    beginWerewolfAttempt(state, 2);
  } else {
    beginWitchOrResolve(state, null);
  }
}

function beginWitchOrResolve(
  state: GameState,
  selectedTargetId: PlayerId | null,
): void {
  state.currentNight!.selectedTargetId = selectedTargetId;
  const witch = playersWithRole(state.players, Role.WITCH, true)[0];
  if (
    witch &&
    ((state.witchPotions?.saveAvailable && selectedTargetId) ||
      state.witchPotions?.eliminationAvailable)
  ) {
    state.phase = Phase.NIGHT_WITCH;
  } else {
    resolveNight(state, selectedTargetId);
  }
}

function resolveNight(
  state: GameState,
  selectedTargetId: PlayerId | null,
): void {
  const night = state.currentNight;
  if (!night) throw new Error("Invariant violation: no night to resolve.");
  night.selectedTargetId = selectedTargetId;

  if (selectedTargetId === null) {
    night.outcome = night.werewolfAttempts.every(
      (attempt) => attempt.targetPlayerId === null,
    )
      ? "NO_PROPOSAL"
      : "NO_AGREEMENT";
  } else if (night.doctorTargetId === selectedTargetId || night.witchSaved) {
    night.outcome = "PROTECTED";
  } else {
    const target = requiredPlayer(state, selectedTargetId);
    target.isAlive = false;
    target.departure = {
      kind: DepartureKind.NIGHT_ELIMINATION,
      dayNumber: state.dayNumber,
      nightNumber: state.nightNumber,
    };
    night.eliminatedPlayerId = selectedTargetId;
    night.outcome = "ELIMINATED";
  }

  const poisonTargetId = night.witchEliminationTargetId ?? null;
  if (poisonTargetId) {
    const target = requiredPlayer(state, poisonTargetId);
    if (target.isAlive) {
      target.isAlive = false;
      target.departure = {
        kind: DepartureKind.NIGHT_ELIMINATION,
        dayNumber: state.dayNumber,
        nightNumber: state.nightNumber,
      };
      night.witchEliminatedPlayerId = poisonTargetId;
    }
  }
  const departures = [
    ...new Set(
      [night.eliminatedPlayerId, night.witchEliminatedPlayerId ?? null].filter(
        (id): id is PlayerId => id !== null,
      ),
    ),
  ].sort(
    (left, right) =>
      requiredPlayer(state, left).seat - requiredPlayer(state, right).seat,
  );

  emitGameEvent(
    state,
    "NIGHT_RESOLUTION_DETAIL",
    {
      nightNumber: night.nightNumber,
      outcome: night.outcome,
      selectedTargetId,
      protectedTargetId: night.doctorTargetId,
      witchSavedTargetId: night.witchSaved ? selectedTargetId : null,
      witchEliminationTargetId: night.witchEliminationTargetId ?? null,
      witchEliminatedPlayerId: night.witchEliminatedPlayerId ?? null,
    },
    { visibility: EventVisibility.SPECTATOR_ONLY },
  );
  emitGameEvent(
    state,
    "NIGHT_RESOLVED",
    {
      nightNumber: night.nightNumber,
      eliminatedPlayerIds: departures,
    },
    { visibility: EventVisibility.PUBLIC },
  );
  for (const departedId of departures) {
    const eliminated = requiredPlayer(state, departedId);
    emitGameEvent(
      state,
      "PLAYER_ELIMINATED",
      { playerId: eliminated.id, nightNumber: night.nightNumber },
      { visibility: EventVisibility.PUBLIC },
    );
    if (state.rules.roleRevealOnDeparture) {
      emitGameEvent(
        state,
        "ROLE_REVEALED",
        { playerId: eliminated.id, role: eliminated.role },
        { visibility: EventVisibility.PUBLIC },
      );
    }
  }

  const initialProposer = requiredPlayer(
    state,
    night.initialWerewolfProposerId,
  );
  if (playersWithRole(state.players, Role.WEREWOLF, true).length > 0) {
    state.werewolfProposerSeat = nextLivingSeat(
      state.players,
      initialProposer.seat,
      (player) => player.role === Role.WEREWOLF,
    );
  }
  state.nightHistory.push(structuredClone(night));
  state.currentNight = null;

  const winner = evaluateWinner(state.players, "NIGHT_END", state.witchPotions);
  if (winner) {
    endGame(state, winner);
  } else {
    beginDay(
      state,
      night.eliminatedPlayerId ?? night.witchEliminatedPlayerId ?? null,
    );
  }
}

function beginDay(
  state: GameState,
  overnightDepartureId: PlayerId | null,
): void {
  state.dayNumber = state.nightNumber + 1;
  let startSeat: number;
  if (overnightDepartureId) {
    startSeat = nextLivingSeat(
      state.players,
      requiredPlayer(state, overnightDepartureId).seat,
    );
  } else {
    startSeat = nextLivingSeat(state.players, state.dayStartMarkerSeat);
  }
  state.dayStartMarkerSeat = startSeat;
  const speakingOrder = clockwiseLivingOrder(state.players, startSeat);
  state.currentDay = {
    dayNumber: state.dayNumber,
    speakingOrder,
    discussionRound: 1,
    discussionTurnIndex: 0,
    discussion: [],
    voteTurnIndex: 0,
    votes: [],
    voteResult: null,
    exiledPlayerId: null,
    finalWords: null,
  };
  state.phase = Phase.DAY_DISCUSSION;
  emitGameEvent(
    state,
    "DAY_STARTED",
    { dayNumber: state.dayNumber, speakingOrder },
    { visibility: EventVisibility.PUBLIC },
  );
  emitGameEvent(
    state,
    "DISCUSSION_ROUND_STARTED",
    { dayNumber: state.dayNumber, roundNumber: 1 },
    { visibility: EventVisibility.PUBLIC },
  );
}

function recordDiscussion(
  state: GameState,
  action: DiscussionAction,
  source: ActionSource,
): void {
  const day = state.currentDay!;
  const playerId = day.speakingOrder[day.discussionTurnIndex]!;
  day.discussion.push({
    dayNumber: day.dayNumber,
    roundNumber: day.discussionRound,
    playerId,
    action: action.action === "speak" ? "SPEAK" : "PASS",
    message: action.action === "speak" ? action.message.trim() : null,
    source,
  });
  if (action.action === "speak") {
    emitGameEvent(
      state,
      "PLAYER_SPOKE",
      {
        dayNumber: day.dayNumber,
        roundNumber: day.discussionRound,
        playerId,
        message: action.message.trim(),
      },
      { visibility: EventVisibility.PUBLIC },
    );
  } else {
    emitGameEvent(
      state,
      "PLAYER_PASSED",
      { dayNumber: day.dayNumber, roundNumber: day.discussionRound, playerId },
      { visibility: EventVisibility.PUBLIC },
    );
  }
  day.discussionTurnIndex += 1;

  if (day.discussionTurnIndex < day.speakingOrder.length) return;
  if (day.discussionRound < state.rules.discussionRounds) {
    day.discussionRound = 2;
    day.discussionTurnIndex = 0;
    emitGameEvent(
      state,
      "DISCUSSION_ROUND_STARTED",
      { dayNumber: day.dayNumber, roundNumber: 2 },
      { visibility: EventVisibility.PUBLIC },
    );
  } else {
    state.phase = Phase.DAY_VOTING;
    day.voteTurnIndex = 0;
    emitGameEvent(
      state,
      "VOTING_STARTED",
      { dayNumber: day.dayNumber, votingOrder: [...day.speakingOrder] },
      { visibility: EventVisibility.PUBLIC },
    );
  }
}

function recordVote(
  state: GameState,
  voterId: PlayerId,
  targetPlayerId: PlayerId | null,
  kind: "VOTE" | "STRATEGIC_ABSTAIN" | "FALLBACK_ABSTAIN",
): void {
  const day = state.currentDay!;
  day.votes.push({ dayNumber: day.dayNumber, voterId, targetPlayerId, kind });
  emitGameEvent(
    state,
    "PLAYER_VOTED",
    { dayNumber: day.dayNumber, playerId: voterId, targetPlayerId, kind },
    { visibility: EventVisibility.PUBLIC },
  );
  day.voteTurnIndex += 1;
  if (day.voteTurnIndex === day.speakingOrder.length) {
    finishVoting(state);
  }
}

function finishVoting(state: GameState): void {
  const day = state.currentDay!;
  day.voteResult = resolveVotes(day.votes);
  emitGameEvent(
    state,
    "VOTE_RESOLVED",
    { dayNumber: day.dayNumber, result: structuredClone(day.voteResult) },
    { visibility: EventVisibility.PUBLIC },
  );
  day.exiledPlayerId = day.voteResult.exiledPlayerId;

  if (day.exiledPlayerId) {
    const exiled = requiredPlayer(state, day.exiledPlayerId);
    exiled.isAlive = false;
    exiled.departure = {
      kind: DepartureKind.DAY_EXILE,
      dayNumber: state.dayNumber,
      nightNumber: state.nightNumber,
    };
    emitGameEvent(
      state,
      "PLAYER_EXILED",
      { playerId: exiled.id, dayNumber: day.dayNumber },
      { visibility: EventVisibility.PUBLIC },
    );
    if (state.rules.roleRevealOnDeparture) {
      emitGameEvent(
        state,
        "ROLE_REVEALED",
        { playerId: exiled.id, role: exiled.role },
        { visibility: EventVisibility.PUBLIC },
      );
    }
    if (state.rules.finalWordsForExiledPlayer) {
      state.phase = Phase.DAY_FINAL_WORDS;
      return;
    }
  }
  finishDay(state);
}

function recordFinalWords(
  state: GameState,
  message: string | null,
  source: ActionSource,
): void {
  const day = state.currentDay!;
  day.finalWords = {
    dayNumber: day.dayNumber,
    playerId: day.exiledPlayerId!,
    message: message?.trim() ?? null,
    source,
  };
  if (message !== null) {
    emitGameEvent(
      state,
      "FINAL_WORDS",
      {
        playerId: day.exiledPlayerId!,
        dayNumber: day.dayNumber,
        message: message.trim(),
      },
      { visibility: EventVisibility.PUBLIC },
    );
  }
  finishDay(state);
}

function finishDay(state: GameState): void {
  const day = state.currentDay;
  if (!day) throw new Error("Invariant violation: no day to finish.");
  state.dayHistory.push(structuredClone(day));
  state.currentDay = null;
  const winner = evaluateWinner(state.players, "DAY_END", state.witchPotions);
  if (winner) {
    endGame(state, winner);
  } else {
    beginNextNight(state);
  }
}

function beginNextNight(state: GameState): void {
  state.nightNumber += 1;
  let proposer = state.players.find(
    (player) =>
      player.seat === state.werewolfProposerSeat &&
      player.isAlive &&
      player.role === Role.WEREWOLF,
  );
  if (!proposer) {
    const seat = nextLivingSeat(
      state.players,
      state.werewolfProposerSeat,
      (player) => player.role === Role.WEREWOLF,
    );
    proposer = state.players.find((player) => player.seat === seat)!;
    state.werewolfProposerSeat = seat;
  }
  state.currentNight = {
    nightNumber: state.nightNumber,
    doctorTargetId: null,
    doctorActionSource: null,
    seerInspection: null,
    werewolfAttempts: [],
    initialWerewolfProposerId: proposer.id,
    selectedTargetId: null,
    eliminatedPlayerId: null,
    outcome: null,
  };
  emitGameEvent(
    state,
    "NIGHT_STARTED",
    { nightNumber: state.nightNumber },
    { visibility: EventVisibility.PUBLIC },
  );

  if (playersWithRole(state.players, Role.DOCTOR, true).length > 0) {
    state.phase = Phase.NIGHT_DOCTOR;
  } else if (playersWithRole(state.players, Role.SEER, true).length > 0) {
    state.phase = Phase.NIGHT_SEER;
  } else {
    beginWerewolfAttempt(state, 1);
  }
}

function endGame(
  state: GameState,
  winner: NonNullable<GameState["winner"]>,
): void {
  state.winner = winner;
  state.status = GameStatus.COMPLETE;
  state.phase = Phase.GAME_OVER;
  emitGameEvent(
    state,
    "GAME_ENDED",
    { winner },
    { visibility: EventVisibility.PUBLIC },
  );
}
