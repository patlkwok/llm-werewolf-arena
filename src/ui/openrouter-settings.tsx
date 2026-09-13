"use client";

import Link from "next/link";
import { useState } from "react";
import type { OpenRouterKeyStatus } from "@/server/openrouter-key";

export function OpenRouterSettings({
  initialStatus,
}: {
  initialStatus: OpenRouterKeyStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = (await response.json()) as OpenRouterKeyStatus & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "The key could not be saved.");
      setStatus(payload);
      setApiKey("");
      setMessage("Verified and saved for this server session.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The key could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/openrouter", {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error("The session key could not be cleared.");
      setStatus((await response.json()) as OpenRouterKeyStatus);
      setApiKey("");
      setMessage("Session key cleared.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The key could not be cleared.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell settings-page">
      <p className="eyebrow">Local operator settings</p>
      <div className="settings-title">
        <h1>Connect OpenRouter.</h1>
        <Link href="/">Return to setup</Link>
      </div>

      <section className="credential-card">
        <div className="credential-status">
          <span className={status.configured ? "configured" : "missing"} />
          <div>
            <strong>
              {status.configured ? "API key configured" : "API key required"}
            </strong>
            <p>
              {status.source === "SESSION" &&
                "Available until this server stops."}
              {status.source === "ENVIRONMENT" &&
                "Loaded from the server environment."}
              {status.source === null && "Add a key before starting live play."}
            </p>
          </div>
        </div>

        <form onSubmit={save}>
          <label htmlFor="openrouter-api-key">OpenRouter API key</label>
          <div className="credential-input">
            <input
              id="openrouter-api-key"
              type="password"
              value={apiKey}
              minLength={10}
              maxLength={512}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Paste your key"
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button
              type="submit"
              disabled={saving || apiKey.trim().length < 10}
            >
              {saving ? "Saving…" : "Save key"}
            </button>
          </div>
        </form>

        <div className="credential-footer">
          <p role="status">{message}</p>
          <button
            type="button"
            disabled={saving || !status.configured}
            onClick={() => void clear()}
          >
            Clear session key
          </button>
        </div>
      </section>

      <section className="security-note">
        <h2>How the key is handled</h2>
        <p>
          It is sent only to this localhost server, retained in server memory,
          and never returned after saving. It is not written to browser storage,
          SQLite game data, event logs, prompts, or telemetry.
        </p>
      </section>
    </main>
  );
}
