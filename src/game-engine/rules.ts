import {
  type GamePlayer,
  type PlayerId,
  Role,
  Team,
  type VoteRecord,
  type VoteResult,
} from "./types";

export type WinCheckBoundary = "IMMEDIATE" | "NIGHT_END" | "DAY_END";

const ROLE_CAPABILITIES: Readonly<
  Record<Role, { canDirectlyChangeUpcomingNightSurvival: boolean }>
> = {
  [Role.WEREWOLF]: { canDirectlyChangeUpcomingNightSurvival: true },
  [Role.DOCTOR]: { canDirectlyChangeUpcomingNightSurvival: true },
  [Role.SEER]: { canDirectlyChangeUpcomingNightSurvival: false },
  [Role.VILLAGER]: { canDirectlyChangeUpcomingNightSurvival: false },
};

export function livingPlayers(players: readonly GamePlayer[]): GamePlayer[] {
  return players.filter((player) => player.isAlive);
}

export function playersWithRole(
  players: readonly GamePlayer[],
  role: Role,
  livingOnly = false,
): GamePlayer[] {
  return players.filter(
    (player) => player.role === role && (!livingOnly || player.isAlive),
  );
}

export function clockwiseLivingOrder(
  players: readonly GamePlayer[],
  startSeat: number,
): PlayerId[] {
  return livingPlayers(players)
    .map((player) => ({
      player,
      distance: (player.seat - startSeat + players.length) % players.length,
    }))
    .sort((left, right) => left.distance - right.distance)
    .map(({ player }) => player.id);
}

export function nextLivingSeat(
  players: readonly GamePlayer[],
  afterSeat: number,
  predicate: (player: GamePlayer) => boolean = () => true,
): number {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const seat = (afterSeat + offset) % players.length;
    const player = players.find((candidate) => candidate.seat === seat);
    if (player?.isAlive && predicate(player)) {
      return seat;
    }
  }

  throw new Error("No living player satisfies the requested seat search.");
}

export function resolveVotes(votes: readonly VoteRecord[]): VoteResult {
  const tally: Record<PlayerId, number> = {};
  for (const vote of votes) {
    if (vote.targetPlayerId !== null) {
      tally[vote.targetPlayerId] = (tally[vote.targetPlayerId] ?? 0) + 1;
    }
  }

  const entries = Object.entries(tally);
  if (entries.length === 0) {
    return { tally, exiledPlayerId: null, tiedPlayerIds: [] };
  }

  const highestTotal = Math.max(...entries.map(([, count]) => count));
  const tiedPlayerIds = entries
    .filter(([, count]) => count === highestTotal)
    .map(([playerId]) => playerId);

  return {
    tally,
    exiledPlayerId: tiedPlayerIds.length === 1 ? tiedPlayerIds[0]! : null,
    tiedPlayerIds: tiedPlayerIds.length > 1 ? tiedPlayerIds : [],
  };
}

export function evaluateWinner(
  players: readonly GamePlayer[],
  boundary: WinCheckBoundary,
): Team | null {
  const living = livingPlayers(players);
  const werewolves = living.filter((player) => player.role === Role.WEREWOLF);
  const nonWerewolves = living.filter(
    (player) => player.role !== Role.WEREWOLF,
  );

  if (werewolves.length === 0) {
    return Team.VILLAGE;
  }

  if (werewolves.length >= nonWerewolves.length) {
    return Team.WEREWOLVES;
  }

  if (
    boundary === "DAY_END" &&
    living.length === 3 &&
    werewolves.length === 1 &&
    !nonWerewolves.some(
      (player) =>
        ROLE_CAPABILITIES[player.role].canDirectlyChangeUpcomingNightSurvival,
    )
  ) {
    return Team.WEREWOLVES;
  }

  return null;
}

export function werewolfTeammateIds(
  players: readonly GamePlayer[],
  playerId: PlayerId,
): PlayerId[] {
  const player = players.find((candidate) => candidate.id === playerId);
  if (player?.role !== Role.WEREWOLF) {
    return [];
  }

  return playersWithRole(players, Role.WEREWOLF)
    .filter((candidate) => candidate.id !== playerId)
    .map((candidate) => candidate.id);
}
