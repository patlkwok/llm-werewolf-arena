import { applyAction, applyFallback, getPendingAction } from "./engine";
import { createGame } from "./setup";
import {
  type CreateGameOptions,
  type GameAction,
  type GameState,
  Phase,
  type PlayerSetup,
  Role,
} from "./types";

export function standardSetups(): PlayerSetup[] {
  return Array.from({ length: 8 }, (_, index) => ({
    displayName: `Player ${index + 1}`,
    modelId: index % 2 === 0 ? "fake/shared" : `fake/model-${index}`,
  }));
}

export function testGame(options: CreateGameOptions = {}): GameState {
  const result = createGame(standardSetups(), { seed: 20260910, ...options });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function playerWithRole(state: GameState, role: Role, occurrence = 0) {
  const player = state.players.filter((candidate) => candidate.role === role)[
    occurrence
  ];
  if (!player) throw new Error(`Missing test player with role ${role}.`);
  return player;
}

export function act(state: GameState, action: GameAction): GameState {
  const pending = getPendingAction(state);
  if (!pending) throw new Error("Expected a pending action.");
  const result = applyAction(state, pending.playerId, action);
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function fallback(state: GameState): GameState {
  const result = applyFallback(state);
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function reachDayWithNoDeparture(state: GameState): GameState {
  let next = state;
  while (
    next.phase === Phase.NIGHT_DOCTOR ||
    next.phase === Phase.NIGHT_SEER ||
    next.phase === Phase.NIGHT_WEREWOLF_PROPOSAL ||
    next.phase === Phase.NIGHT_WEREWOLF_RESPONSES
  ) {
    next = fallback(next);
  }
  return next;
}

export function finishDiscussion(state: GameState): GameState {
  let next = state;
  while (next.phase === Phase.DAY_DISCUSSION) {
    next = act(next, { action: "pass" });
  }
  return next;
}

export function finishVotingWithFallbacks(state: GameState): GameState {
  let next = state;
  while (next.phase === Phase.DAY_VOTING) {
    next = fallback(next);
  }
  return next;
}
