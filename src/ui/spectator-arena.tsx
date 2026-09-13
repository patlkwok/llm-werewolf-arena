"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EventVisibility, type GameEvent } from "@/game-engine/events";
import { GameStatus, type GameState } from "@/game-engine/types";
import type { GameControl } from "@/persistence/repository";
import type { ModelCallRow } from "@/persistence/schema";

export interface SpectatorView {
  state: GameState;
  control: GameControl;
  modelCalls: ModelCallRow[];
}

export function SpectatorArena({
  initialView,
}: {
  initialView: SpectatorView;
}) {
  const [view, setView] = useState(initialView);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const advancing = useRef(false);
  const gameId = view.state.id;

  const fetchView = useCallback(async (): Promise<SpectatorView> => {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("The arena state could not be refreshed.");
    return (await response.json()) as SpectatorView;
  }, [gameId]);

  const advance = useCallback(
    async (step: boolean) => {
      if (advancing.current) return;
      advancing.current = true;
      setActionPending(true);
      try {
        const response = await fetch(
          `/api/games/${encodeURIComponent(gameId)}/advance`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step }),
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok && response.status !== 409) {
          setNotice(payload.error ?? "The model action failed.");
        }
        setView(await fetchView());
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "The model action failed.",
        );
      } finally {
        advancing.current = false;
        setActionPending(false);
      }
    },
    [fetchView, gameId],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchView()
        .then((fresh) => {
          setView(fresh);
          if (
            fresh.control.mode === "RUNNING" &&
            !fresh.control.inFlight &&
            fresh.state.status === GameStatus.ACTIVE
          ) {
            void advance(false);
          }
        })
        .catch(() => setNotice("The arena state could not be refreshed."));
    }, 900);
    return () => window.clearInterval(timer);
  }, [advance, fetchView]);

  async function setMode(command: "PAUSE" | "RESUME") {
    setNotice(null);
    const response = await fetch(
      `/api/games/${encodeURIComponent(gameId)}/control`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      },
    );
    if (!response.ok) {
      setNotice("The run control could not be updated.");
      return;
    }
    setView((await response.json()) as SpectatorView);
  }

  async function endGame() {
    if (!window.confirm("End this game now? It will remain in saved games.")) {
      return;
    }
    setActionPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/games/${encodeURIComponent(gameId)}/end`,
        { method: "POST" },
      );
      const payload = (await response.json()) as SpectatorView & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Game could not end.");
      setView(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Game could not end.");
    } finally {
      setActionPending(false);
    }
  }

  const publicEvents = view.state.events.filter(
    (event) => event.visibility === EventVisibility.PUBLIC,
  );
  const privateEvents = view.state.events.filter(
    (event) => event.visibility !== EventVisibility.PUBLIC,
  );
  const publicEventsWithCalls = correlateEvents(publicEvents, view.modelCalls);
  const privateEventsWithCalls = correlateEvents(
    privateEvents,
    view.modelCalls,
  );
  const totalCost = view.modelCalls.reduce(
    (sum, call) => sum + (call.cost ?? 0),
    0,
  );
  const totalTokens = view.modelCalls.reduce(
    (sum, call) => sum + (call.totalTokens ?? 0),
    0,
  );
  const failures = view.modelCalls.filter((call) => call.outcome !== "SUCCESS");

  return (
    <main className="arena-shell">
      <header className="arena-header">
        <div>
          <Link href="/" className="wordmark">
            LLM Werewolf Arena
          </Link>
          <p>
            {view.state.status === GameStatus.COMPLETE
              ? "Game complete"
              : phaseLabel(view.state)}
          </p>
        </div>
        <Link href="/" className="arena-settings-link">
          Main page
        </Link>
        <div className="arena-controls">
          <span className={`run-state ${view.control.mode.toLowerCase()}`}>
            {view.control.inFlight
              ? "Model thinking"
              : view.control.mode === "RUNNING"
                ? "Running"
                : "Paused"}
          </span>
          {view.control.mode === "RUNNING" ? (
            <button type="button" onClick={() => void setMode("PAUSE")}>
              Pause after action
            </button>
          ) : (
            <button
              type="button"
              disabled={view.state.status !== GameStatus.ACTIVE}
              onClick={() => void setMode("RESUME")}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            disabled={
              view.control.mode !== "PAUSED" ||
              view.control.inFlight ||
              actionPending ||
              view.state.status !== GameStatus.ACTIVE
            }
            onClick={() => void advance(true)}
          >
            Step next action
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={
              view.control.inFlight ||
              actionPending ||
              view.state.status !== GameStatus.ACTIVE
            }
            onClick={() => void endGame()}
          >
            End game
          </button>
        </div>
      </header>

      {notice && (
        <div className="arena-notice" role="alert">
          {notice}
        </div>
      )}

      <section className="table-panel" aria-labelledby="table-heading">
        <div className="panel-heading">
          <div>
            <p className="section-number">The table</p>
            <h1 id="table-heading">{phaseLabel(view.state)}</h1>
          </div>
          <p>{stageCounter(view.state)}</p>
        </div>
        <div className="seat-grid">
          {view.state.players.map((player) => (
            <article
              className={player.isAlive ? "alive" : "departed"}
              key={player.id}
            >
              <div>
                <span>Seat {player.seat + 1}</span>
                <i aria-hidden="true" />
              </div>
              <strong>{player.displayName}</strong>
              <small>{player.role}</small>
              <code>{player.modelId}</code>
            </article>
          ))}
        </div>
        <details className="house-rules">
          <summary>House rules for this game</summary>
          <dl>
            <div>
              <dt>Reveal roles on departure</dt>
              <dd>{view.state.rules.roleRevealOnDeparture ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Exiled player final words</dt>
              <dd>
                {view.state.rules.finalWordsForExiledPlayer ? "On" : "Off"}
              </dd>
            </div>
            <div>
              <dt>One Werewolf re-proposal</dt>
              <dd>{view.state.rules.werewolfReproposal ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Strategic vote abstention</dt>
              <dd>{view.state.rules.strategicVoteAbstention ? "On" : "Off"}</dd>
            </div>
          </dl>
        </details>
      </section>

      <div className="spectator-grid">
        <section className="timeline-panel" aria-labelledby="timeline-heading">
          <div className="panel-heading compact">
            <div>
              <p className="section-number">Public record</p>
              <h2 id="timeline-heading">Village timeline</h2>
            </div>
            <span>{publicEvents.length} events</span>
          </div>
          <div className="timeline">
            {newestFirst(publicEventsWithCalls).map(({ event, calls }) => (
              <article key={event.sequence}>
                <span>{String(event.sequence).padStart(2, "0")}</span>
                <div>
                  <strong>{eventTitle(event.type)}</strong>
                  <p>{eventDescription(event, view.state)}</p>
                  {calls.length > 0 && <ActionAttempts calls={calls} />}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="operator-column">
          <section className="operator-panel">
            <div className="panel-heading compact">
              <div>
                <p className="section-number">Spectator only</p>
                <h2>Hidden actions</h2>
              </div>
              <span>{privateEvents.length}</span>
            </div>
            <div className="private-log">
              {privateEventsWithCalls
                .slice(-10)
                .reverse()
                .map(({ event, calls }) => (
                  <article key={event.sequence}>
                    <strong>{eventTitle(event.type)}</strong>
                    <p>{eventDescription(event, view.state)}</p>
                    <small>{event.visibility.replaceAll("_", " ")}</small>
                    {calls.length > 0 && <ActionAttempts calls={calls} />}
                  </article>
                ))}
            </div>
          </section>

          <section className="operator-panel">
            <div className="panel-heading compact">
              <div>
                <p className="section-number">Operator</p>
                <h2>Diagnostics</h2>
              </div>
            </div>
            <div className="metric-grid">
              <Metric label="Calls" value={String(view.modelCalls.length)} />
              <Metric
                label="Retries / failures"
                value={String(failures.length)}
              />
              <Metric label="Tokens" value={totalTokens.toLocaleString()} />
              <Metric label="Cost" value={`$${totalCost.toFixed(5)}`} />
            </div>
            <div className="reasoning-log">
              {view.modelCalls
                .slice(-8)
                .reverse()
                .map((call) => (
                  <details key={call.id}>
                    <summary>
                      <span>{playerName(view.state, call.playerId)}</span>
                      <small>
                        {call.latencyMs}ms · {call.outcome}
                      </small>
                    </summary>
                    {call.errorMessage && (
                      <p className="call-error">{call.errorMessage}</p>
                    )}
                    <p>{visibleReasoning(call)}</p>
                    <code>
                      {call.providerName ?? "Provider unavailable"} ·{" "}
                      {call.modelId}
                    </code>
                  </details>
                ))}
            </div>
            <div className="player-telemetry">
              <p>Per-player totals</p>
              {view.state.players.map((player) => {
                const calls = view.modelCalls.filter(
                  (call) => call.playerId === player.id,
                );
                const cost = calls.reduce(
                  (sum, call) => sum + (call.cost ?? 0),
                  0,
                );
                return (
                  <div key={player.id}>
                    <span>{player.displayName}</span>
                    <small>
                      {calls.length} calls · ${cost.toFixed(5)}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActionAttempts({ calls }: { calls: ModelCallRow[] }) {
  return (
    <details className="action-reasoning">
      <summary>Reasoning & request details</summary>
      {calls.map((call) => (
        <div key={call.id}>
          <b>
            Attempt {call.responseAttempt} · {call.outcome} · {call.latencyMs}ms
          </b>
          {call.errorMessage && (
            <p className="call-error">{call.errorMessage}</p>
          )}
          <p>{visibleReasoning(call)}</p>
          <code>
            {call.providerName ?? "Provider unavailable"} · {call.modelId}
          </code>
        </div>
      ))}
    </details>
  );
}

function phaseLabel(state: GameState): string {
  if (state.status === GameStatus.ABANDONED) {
    return "Game ended by operator";
  }
  if (state.status === GameStatus.COMPLETE) {
    return `${state.winner === "VILLAGE" ? "Village" : "Werewolves"} win`;
  }
  const labels: Record<string, string> = {
    NIGHT_DOCTOR: "Doctor chooses protection",
    NIGHT_SEER: "Seer investigates",
    NIGHT_WEREWOLF_PROPOSAL: "Werewolves choose a target",
    NIGHT_WEREWOLF_RESPONSES: "Werewolves seek agreement",
    DAY_DISCUSSION: `Day ${state.dayNumber} discussion`,
    DAY_VOTING: `Day ${state.dayNumber} voting`,
    DAY_FINAL_WORDS: "Final words",
  };
  return labels[state.phase] ?? state.phase.replaceAll("_", " ");
}

export function stageCounter(state: GameState): string {
  if (state.phase.startsWith("NIGHT_")) return `Night ${state.nightNumber}`;
  if (state.phase.startsWith("DAY_")) return `Day ${state.dayNumber}`;
  return "Game over";
}

function playerName(state: GameState, id: unknown): string {
  return (
    state.players.find((player) => player.id === id)?.displayName ??
    String(id ?? "Nobody")
  );
}

function eventTitle(type: GameEvent["type"]): string {
  return type
    .replaceAll("_", " ")
    .toLocaleLowerCase("en-US")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function eventDescription(event: GameEvent, state: GameState): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "ROLES_ASSIGNED") {
    const assignments = payload.assignments as Array<{
      playerId: string;
      role: string;
    }>;
    return assignments
      .map(
        (assignment) =>
          `${playerName(state, assignment.playerId)}: ${assignment.role}`,
      )
      .join(" · ");
  }
  if (event.type === "DOCTOR_PROTECTION_RESOLVED") {
    return payload.targetPlayerId
      ? `${playerName(state, payload.playerId)} protected ${playerName(state, payload.targetPlayerId)} (${String(payload.source).toLocaleLowerCase("en-US")}).`
      : `${playerName(state, payload.playerId)} did not protect anyone; a fallback was applied.`;
  }
  if (event.type === "SEER_INSPECTED") {
    return `${playerName(state, payload.playerId)} inspected ${playerName(state, payload.targetPlayerId)} and learned ${payload.result === "WEREWOLF" ? "Werewolf" : "Not Werewolf"}.`;
  }
  if (event.type === "WEREWOLF_PROPOSED_TARGET") {
    return `${playerName(state, payload.proposerId)} proposed ${playerName(state, payload.targetPlayerId)} on attempt ${String(payload.attemptNumber)}.`;
  }
  if (event.type === "WEREWOLF_RESPONDED") {
    return `${playerName(state, payload.playerId)} ${payload.response === "AGREE" ? "agreed" : "disagreed"} on attempt ${String(payload.attemptNumber)}.`;
  }
  if (event.type === "NIGHT_RESOLUTION_DETAIL") {
    const target = payload.selectedTargetId
      ? playerName(state, payload.selectedTargetId)
      : "none";
    const protectedPlayer = payload.protectedTargetId
      ? playerName(state, payload.protectedTargetId)
      : "none";
    return `Outcome: ${String(payload.outcome).replaceAll("_", " ").toLocaleLowerCase("en-US")} · selected target: ${target} · protected player: ${protectedPlayer}.`;
  }
  if (event.type === "FALLBACK_APPLIED") {
    return `${playerName(state, payload.playerId)} could not provide a usable ${String(payload.actionKind).replaceAll("_", " ").toLocaleLowerCase("en-US")} action, so the game fallback was applied.`;
  }
  if (event.type === "GAME_ABORTED") {
    return "The operator ended the game early.";
  }
  if (event.type === "PLAYER_SPOKE" || event.type === "FINAL_WORDS") {
    return `${playerName(state, payload.playerId)}: “${String(payload.message)}”`;
  }
  if (event.type === "PLAYER_PASSED") {
    return `${playerName(state, payload.playerId)} passed.`;
  }
  if (event.type === "PLAYER_VOTED") {
    return payload.targetPlayerId
      ? `${playerName(state, payload.playerId)} voted for ${playerName(state, payload.targetPlayerId)}.`
      : `${playerName(state, payload.playerId)} abstained.`;
  }
  if (event.type === "VOTE_RESOLVED") {
    const result = payload.result as {
      tally: Record<string, number>;
      exiledPlayerId: string | null;
      tiedPlayerIds: string[];
    };
    const tally = Object.entries(result.tally)
      .sort(
        ([leftId, leftCount], [rightId, rightCount]) =>
          rightCount - leftCount ||
          playerName(state, leftId).localeCompare(playerName(state, rightId)),
      )
      .map(
        ([playerId, count]) =>
          `${playerName(state, playerId)}: ${count} ${count === 1 ? "vote" : "votes"}`,
      )
      .join(" · ");
    let outcome: string;
    if (result.exiledPlayerId) {
      outcome = `${playerName(state, result.exiledPlayerId)} received the most votes.`;
    } else if (result.tiedPlayerIds.length > 1) {
      outcome = `The vote tied between ${result.tiedPlayerIds.map((id) => playerName(state, id)).join(", ")}; nobody was exiled.`;
    } else {
      outcome = "No votes were cast; nobody was exiled.";
    }
    return tally ? `${outcome} Tally — ${tally}.` : outcome;
  }
  if (event.type === "PLAYER_ELIMINATED" || event.type === "PLAYER_EXILED") {
    return `${playerName(state, payload.playerId)} left the game.`;
  }
  if (event.type === "NIGHT_RESOLVED") {
    return payload.eliminatedPlayerId
      ? `${playerName(state, payload.eliminatedPlayerId)} was eliminated overnight.`
      : "Nobody was eliminated overnight.";
  }
  if (event.type === "GAME_ENDED") return `${String(payload.winner)} victory.`;
  if (payload.playerId) return `${playerName(state, payload.playerId)} acted.`;
  return Object.entries(payload)
    .map(
      ([key, value]) =>
        `${key.replaceAll("Id", "")}: ${Array.isArray(value) ? value.map((item) => playerName(state, item)).join(", ") : String(value)}`,
    )
    .join(" · ");
}

export function correlateEvents(
  events: GameEvent[],
  calls: ModelCallRow[],
): Array<{ event: GameEvent; calls: ModelCallRow[] }> {
  const batches = new Map<string, ModelCallRow[][]>();
  const byTurn = new Map<string, ModelCallRow[]>();
  for (const call of calls) {
    const turnCalls = byTurn.get(call.turnId) ?? [];
    turnCalls.push(call);
    byTurn.set(call.turnId, turnCalls);
  }
  for (const turnCalls of byTurn.values()) {
    turnCalls.sort((left, right) => left.startedAt - right.startedAt);
    const first = turnCalls[0]!;
    const key = `${first.playerId}:${first.actionKind}`;
    const existing = batches.get(key) ?? [];
    existing.push(turnCalls);
    batches.set(key, existing);
  }
  for (const queue of batches.values()) {
    queue.sort((left, right) => left[0]!.startedAt - right[0]!.startedAt);
  }

  return events.map((event) => {
    const match = eventCallMatch(event);
    if (!match) return { event, calls: [] };
    const queue = batches.get(`${match.playerId}:${match.actionKind}`) ?? [];
    const index = queue.findIndex(
      (turnCalls) =>
        turnCalls.some((call) => call.outcome === "SUCCESS") ===
        match.requiresSuccess,
    );
    return {
      event,
      calls: index < 0 ? [] : queue.splice(index, 1)[0]!,
    };
  });
}

export function newestFirst<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

function eventCallMatch(event: GameEvent): {
  playerId: string;
  actionKind: string;
  requiresSuccess: boolean;
} | null {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "FALLBACK_APPLIED") {
    return {
      playerId: String(payload.playerId),
      actionKind: String(payload.actionKind),
      requiresSuccess: false,
    };
  }
  const actionKinds: Partial<Record<GameEvent["type"], string>> = {
    DOCTOR_PROTECTION_RESOLVED: "DOCTOR_PROTECT",
    SEER_INSPECTED: "SEER_INSPECT",
    WEREWOLF_PROPOSED_TARGET: "WEREWOLF_PROPOSE",
    WEREWOLF_RESPONDED: "WEREWOLF_RESPOND",
    PLAYER_SPOKE: "DISCUSS",
    PLAYER_PASSED: "DISCUSS",
    PLAYER_VOTED: "VOTE",
    FINAL_WORDS: "FINAL_WORDS",
  };
  const actionKind = actionKinds[event.type];
  if (!actionKind) return null;
  const playerId =
    event.type === "WEREWOLF_PROPOSED_TARGET"
      ? payload.proposerId
      : payload.playerId;
  return { playerId: String(playerId), actionKind, requiresSuccess: true };
}

export function visibleReasoning(call: ModelCallRow): string {
  if (call.reasoningText?.trim()) return call.reasoningText;
  if (call.reasoningDetailsJson) {
    try {
      const details = JSON.parse(call.reasoningDetailsJson) as unknown;
      const pieces: string[] = [];
      collectReasoningText(details, pieces);
      const unique = [...new Set(pieces.map((piece) => piece.trim()))].filter(
        Boolean,
      );
      if (unique.length > 0) return unique.join("\n\n");
      if (containsEncryptedReasoning(details)) {
        const tokenCount = call.reasoningTokens
          ? `${call.reasoningTokens.toLocaleString()} reasoning tokens were used, but `
          : "";
        return `${tokenCount}the provider returned only encrypted reasoning and no spectator-visible summary.`;
      }
    } catch {
      // Stored provider metadata can be malformed without affecting the game.
    }
  }
  if (call.reasoningTokens) {
    return `${call.reasoningTokens.toLocaleString()} reasoning tokens were used, but the provider returned no spectator-visible summary.`;
  }
  return "This provider returned no spectator-visible reasoning.";
}

function collectReasoningText(value: unknown, pieces: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReasoningText(item, pieces);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "text" || key === "summary") && typeof child === "string") {
      pieces.push(child);
    } else if (typeof child === "object") {
      collectReasoningText(child, pieces);
    }
  }
}

function containsEncryptedReasoning(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEncryptedReasoning);
  if (!value || typeof value !== "object") return false;
  if (
    "type" in value &&
    (value as { type?: unknown }).type === "reasoning.encrypted"
  ) {
    return true;
  }
  return Object.values(value).some(containsEncryptedReasoning);
}
