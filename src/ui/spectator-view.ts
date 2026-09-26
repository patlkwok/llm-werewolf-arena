import {
  EventVisibility,
  publicGameEvent,
  type GameEvent,
} from "@/game-engine/events";
import {
  GameStatus,
  type GamePlayer,
  type GameState,
  type Phase,
  type Role,
} from "@/game-engine/types";
import type { GameControl } from "@/persistence/repository";
import type { ModelCallRow } from "@/persistence/schema";

export type SpectatorGameState = Pick<
  GameState,
  "id" | "status" | "winner" | "rules" | "nightNumber" | "dayNumber" | "options"
> & {
  phase: Phase | "NIGHT";
  players: Array<
    Pick<
      GamePlayer,
      "id" | "displayName" | "seat" | "isAlive" | "departure"
    > & {
      role: Role | null;
      modelId: string | null;
    }
  >;
  events: GameEvent[];
};

export interface SpectatorView {
  state: SpectatorGameState;
  control: GameControl;
  modelCalls: ModelCallRow[];
}

export function projectSpectatorState(state: GameState): SpectatorGameState {
  const locked =
    state.options?.hideSpoilersUntilEnd && state.status === GameStatus.ACTIVE;
  return {
    id: state.id,
    status: state.status,
    phase: locked && state.phase.startsWith("NIGHT_") ? "NIGHT" : state.phase,
    winner: state.winner,
    rules: state.rules,
    options: state.options,
    nightNumber: state.nightNumber,
    dayNumber: state.dayNumber,
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      seat: player.seat,
      isAlive: player.isAlive,
      departure: player.departure,
      role:
        locked && !(state.rules.roleRevealOnDeparture && !player.isAlive)
          ? null
          : player.role,
      modelId: locked ? null : player.modelId,
    })),
    events: locked
      ? state.events
          .filter((event) => event.visibility === EventVisibility.PUBLIC)
          .map(publicGameEvent)
      : state.events,
  };
}
