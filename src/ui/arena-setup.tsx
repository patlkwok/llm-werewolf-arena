"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_PLAYER_COUNT,
  MAX_PLAYER_COUNT,
  MIN_PLAYER_COUNT,
  roleCountsForPlayerCount,
} from "@/game-engine/setup";
import type { RoleCounts } from "@/game-engine/types";
import {
  DEFAULT_PLAYER_NAMES,
  roleDistributionLabel,
  setupSubmissionSchema,
} from "./setup";

interface ModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt: string | null; completion: string | null } | null;
}

interface PlayerDraft {
  displayName: string;
  modelId: string;
}

const RULES = [
  {
    key: "roleRevealOnDeparture" as const,
    label: "Reveal roles on departure",
    detail: "Announce a player's hidden role when they leave the game.",
  },
  {
    key: "finalWordsForExiledPlayer" as const,
    label: "Exiled player final words",
    detail: "Give an exiled player one last public statement.",
  },
  {
    key: "werewolfReproposal" as const,
    label: "One Werewolf re-proposal",
    detail: "Allow one new target proposal after disagreement.",
  },
  {
    key: "strategicVoteAbstention" as const,
    label: "Allow vote abstention",
    detail: "Let a model deliberately abstain during daytime voting.",
  },
];

const DEFAULT_RULE_STATE = {
  roleRevealOnDeparture: false,
  finalWordsForExiledPlayer: true,
  werewolfReproposal: false,
  strategicVoteAbstention: false,
};

async function fetchEligibleModels(): Promise<ModelOption[]> {
  const response = await fetch("/api/models", { cache: "no-store" });
  const payload = (await response.json()) as {
    models?: ModelOption[];
    error?: string;
  };
  if (!response.ok || !payload.models?.length) {
    throw new Error(payload.error ?? "No eligible models were returned.");
  }
  return payload.models;
}

export function ArenaSetup() {
  const router = useRouter();
  const createRequestId = useRef(crypto.randomUUID());
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [players, setPlayers] = useState<PlayerDraft[]>(
    DEFAULT_PLAYER_NAMES.slice(0, DEFAULT_PLAYER_COUNT).map((displayName) => ({
      displayName,
      modelId: "",
    })),
  );
  const [rules, setRules] = useState(DEFAULT_RULE_STATE);
  const [roleCounts, setRoleCounts] = useState<RoleCounts>(
    roleCountsForPlayerCount(DEFAULT_PLAYER_COUNT)!,
  );
  const [experience, setExperience] = useState({
    requireMoveExplanation: false,
    hideSpoilersUntilEnd: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadModels = useCallback(async () => {
    try {
      const loadedModels = await fetchEligibleModels();
      setModels(loadedModels);
      setPlayers((current) =>
        current.map((player) => ({
          ...player,
          modelId: player.modelId || loadedModels[0]!.id,
        })),
      );
      setModelState("ready");
    } catch {
      setModels([]);
      setModelState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchEligibleModels()
      .then((loadedModels) => {
        if (!active) return;
        setModels(loadedModels);
        setPlayers((current) =>
          current.map((player) => ({
            ...player,
            modelId: player.modelId || loadedModels[0]!.id,
          })),
        );
        setModelState("ready");
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setModelState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    players.forEach((player) => {
      const name = player.displayName.trim().toLocaleLowerCase("en-US");
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );
  }, [players]);

  function updatePlayer(index: number, update: Partial<PlayerDraft>) {
    setPlayers((current) =>
      current.map((player, playerIndex) =>
        playerIndex === index ? { ...player, ...update } : player,
      ),
    );
    setFormError(null);
  }

  function addPlayer() {
    setPlayers((current) => {
      if (current.length >= MAX_PLAYER_COUNT) return current;
      return [
        ...current,
        {
          displayName:
            DEFAULT_PLAYER_NAMES[current.length] ??
            `Player ${current.length + 1}`,
          modelId: models[0]?.id ?? "",
        },
      ];
    });
    if (players.length < MAX_PLAYER_COUNT)
      setRoleCounts(roleCountsForPlayerCount(players.length + 1)!);
    setFormError(null);
  }

  function removePlayer() {
    setPlayers((current) =>
      current.length > MIN_PLAYER_COUNT ? current.slice(0, -1) : current,
    );
    if (players.length > MIN_PLAYER_COUNT)
      setRoleCounts(roleCountsForPlayerCount(players.length - 1)!);
    setFormError(null);
  }

  function updateRoleCount(
    role: "WEREWOLF" | "DOCTOR" | "WITCH",
    count: number,
  ) {
    setRoleCounts((current) => ({
      ...current,
      [role]: count,
      VILLAGER:
        players.length -
        1 -
        (role === "WEREWOLF" ? count : current.WEREWOLF) -
        (role === "DOCTOR" ? count : current.DOCTOR) -
        (role === "WITCH" ? count : current.WITCH),
    }));
    setFormError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = setupSubmissionSchema.safeParse({
      players,
      roleCounts,
      rules,
      experience,
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Check the setup fields.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: createRequestId.current,
          setup: parsed.data,
        }),
      });
      const payload = (await response.json()) as {
        gameId?: string;
        error?: string;
      };
      if (!response.ok || !payload.gameId) {
        throw new Error(payload.error ?? "The game could not be created.");
      }
      router.push(`/games/${encodeURIComponent(payload.gameId)}`);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The game could not be created.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="setup" onSubmit={submit} noValidate>
      <section className="setup-section" aria-labelledby="players-heading">
        <div className="section-heading">
          <div>
            <p className="section-number">01</p>
            <h2 id="players-heading">Seat the players</h2>
          </div>
          <div className={`connection-state ${modelState}`} aria-live="polite">
            <span />
            {modelState === "loading" && "Loading eligible models"}
            {modelState === "ready" && `${models.length} models available`}
            {modelState === "error" && "Model catalog unavailable"}
          </div>
        </div>

        {modelState === "error" && (
          <div className="inline-alert">
            OpenRouter&apos;s eligible model catalog could not be loaded.
            <button
              type="button"
              onClick={() => {
                setModelState("loading");
                void loadModels();
              }}
            >
              Try again
            </button>
          </div>
        )}

        <div className="player-grid">
          {players.map((player, index) => {
            const duplicate = duplicateNames.has(
              player.displayName.trim().toLocaleLowerCase("en-US"),
            );
            return (
              <article className="player-row" key={index}>
                <div className="seat-badge" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <label>
                  <span>Player name</span>
                  <input
                    value={player.displayName}
                    maxLength={40}
                    aria-invalid={duplicate}
                    onChange={(event) =>
                      updatePlayer(index, { displayName: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>OpenRouter model</span>
                  <select
                    value={player.modelId}
                    disabled={modelState !== "ready"}
                    onChange={(event) =>
                      updatePlayer(index, { modelId: event.target.value })
                    }
                  >
                    {modelState === "loading" && (
                      <option>Loading models…</option>
                    )}
                    {modelState === "error" && <option>Unavailable</option>}
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                        {model.contextLength
                          ? ` · ${Math.round(model.contextLength / 1000)}k context`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {duplicate && (
                  <p className="field-error">Name already in use</p>
                )}
              </article>
            );
          })}
        </div>
        <div className="player-count-bar">
          <p aria-live="polite">
            {players.length} players · Minimum {MIN_PLAYER_COUNT}, maximum{" "}
            {MAX_PLAYER_COUNT}
          </p>
          <div>
            <button
              type="button"
              disabled={players.length <= MIN_PLAYER_COUNT}
              onClick={removePlayer}
            >
              Remove player
            </button>
            <button
              type="button"
              disabled={players.length >= MAX_PLAYER_COUNT}
              onClick={addPlayer}
            >
              Add player
            </button>
          </div>
        </div>
        <p className="quiet-note">
          Models are routing choices only. Players never learn which models sit
          at the table, and the same model may occupy multiple seats.
        </p>
      </section>

      <section className="setup-section" aria-labelledby="roles-heading">
        <div className="section-heading">
          <div>
            <p className="section-number">02</p>
            <h2 id="roles-heading">Choose the roles</h2>
          </div>
          <p className="fixed-rules">
            {players.length} seats · 1 Seer · Villagers fill the rest
          </p>
        </div>
        <div className="rule-grid">
          <label className="rule-card">
            <span>
              <strong>Werewolves</strong>
              <small>1 to {Math.floor(players.length / 3)}</small>
            </span>
            <select
              aria-label="Werewolf count"
              value={roleCounts.WEREWOLF}
              onChange={(event) =>
                updateRoleCount("WEREWOLF", Number(event.target.value))
              }
            >
              {Array.from(
                { length: Math.floor(players.length / 3) },
                (_, index) => index + 1,
              ).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label className="rule-card">
            <span>
              <strong>Doctor</strong>
              <small>Protects from Werewolf attacks</small>
            </span>
            <select
              aria-label="Doctor count"
              value={roleCounts.DOCTOR}
              onChange={(event) =>
                updateRoleCount("DOCTOR", Number(event.target.value))
              }
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </label>
          <label className="rule-card">
            <span>
              <strong>Witch</strong>
              <small>One save and one elimination potion</small>
            </span>
            <select
              aria-label="Witch count"
              value={roleCounts.WITCH}
              onChange={(event) =>
                updateRoleCount("WITCH", Number(event.target.value))
              }
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </label>
        </div>
      </section>

      <section className="setup-section" aria-labelledby="rules-heading">
        <div className="section-heading">
          <div>
            <p className="section-number">03</p>
            <h2 id="rules-heading">Choose the house rules</h2>
          </div>
          <p className="fixed-rules">
            Fixed: {players.length} seats · 2 discussion rounds · Night 0
          </p>
        </div>
        <div className="rule-grid">
          <label className="rule-card">
            <span>
              <strong>Require move explanations</strong>
              <small>
                Each model gives a short private explanation for the operator.
                This replaces provider reasoning in the game view.
              </small>
            </span>
            <input
              type="checkbox"
              checked={experience.requireMoveExplanation}
              onChange={(event) =>
                setExperience((current) => ({
                  ...current,
                  requireMoveExplanation: event.target.checked,
                }))
              }
            />
            <i aria-hidden="true" />
          </label>
          <label className="rule-card">
            <span>
              <strong>Hide spoilers until game ends</strong>
              <small>
                Show only information a Villager could know while the game is
                active.
              </small>
            </span>
            <input
              type="checkbox"
              checked={experience.hideSpoilersUntilEnd}
              onChange={(event) =>
                setExperience((current) => ({
                  ...current,
                  hideSpoilersUntilEnd: event.target.checked,
                }))
              }
            />
            <i aria-hidden="true" />
          </label>
        </div>
        <div className="rule-grid">
          {RULES.map((rule) => (
            <label className="rule-card" key={rule.key}>
              <span>
                <strong>{rule.label}</strong>
                <small>{rule.detail}</small>
              </span>
              <input
                type="checkbox"
                checked={rules[rule.key]}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    [rule.key]: event.target.checked,
                  }))
                }
              />
              <i aria-hidden="true" />
            </label>
          ))}
        </div>
      </section>

      <footer className="launch-bar">
        <div>
          <p>Roles are assigned only after launch.</p>
          <span>{roleDistributionLabel(players.length, roleCounts)}</span>
        </div>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button
          className="launch-button"
          type="submit"
          disabled={
            submitting || modelState !== "ready" || duplicateNames.size > 0
          }
        >
          {submitting ? "Preparing the village…" : "Begin at Night 0"}
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </form>
  );
}
