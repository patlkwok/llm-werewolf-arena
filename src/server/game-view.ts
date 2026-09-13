import "server-only";
import { gameRepository } from "./database";

export function getSpectatorGameView(gameId: string) {
  const repository = gameRepository();
  const state = repository.loadGame(gameId);
  if (!state) return null;
  repository.initializeControl(gameId, "PAUSED");
  return {
    state,
    control: repository.getControl(gameId)!,
    modelCalls: repository.listModelCalls(gameId),
  };
}
