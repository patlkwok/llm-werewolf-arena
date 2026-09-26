import "server-only";
import { GameStatus } from "@/game-engine/types";
import { projectSpectatorState, type SpectatorView } from "@/ui/spectator-view";
import { gameRepository } from "./database";

export function getSpectatorGameView(gameId: string): SpectatorView | null {
  const repository = gameRepository();
  const state = repository.loadGame(gameId);
  if (!state) return null;
  repository.initializeControl(gameId, "PAUSED");
  return {
    state: projectSpectatorState(state),
    control: repository.getControl(gameId)!,
    modelCalls:
      state.options?.hideSpoilersUntilEnd && state.status === GameStatus.ACTIVE
        ? []
        : repository.listModelCalls(gameId),
  };
}
