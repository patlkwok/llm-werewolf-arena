import "server-only";

interface SecretState {
  openRouterApiKey?: string;
}

const secrets = globalThis as typeof globalThis & {
  __llmWerewolfArenaSecrets?: SecretState;
};

function secretState(): SecretState {
  secrets.__llmWerewolfArenaSecrets ??= {};
  return secrets.__llmWerewolfArenaSecrets;
}

export type OpenRouterKeySource = "SESSION" | "ENVIRONMENT" | null;

export interface OpenRouterKeyStatus {
  configured: boolean;
  source: OpenRouterKeySource;
}

export function getOpenRouterApiKey(): string | null {
  return (
    secretState().openRouterApiKey ??
    process.env.OPENROUTER_API_KEY?.trim() ??
    null
  );
}

export function getOpenRouterKeyStatus(): OpenRouterKeyStatus {
  if (secretState().openRouterApiKey) {
    return { configured: true, source: "SESSION" };
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return { configured: true, source: "ENVIRONMENT" };
  }
  return { configured: false, source: null };
}

export function saveSessionOpenRouterApiKey(value: string): void {
  const apiKey = value.trim();
  if (apiKey.length < 10 || apiKey.length > 512) {
    throw new Error("The OpenRouter API key has an invalid length.");
  }
  secretState().openRouterApiKey = apiKey;
}

export function clearSessionOpenRouterApiKey(): void {
  delete secretState().openRouterApiKey;
}
