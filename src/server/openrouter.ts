import "server-only";
import { OpenRouterAdapter, OpenRouterModelCatalog } from "@/llm/openrouter";
import { getOpenRouterApiKey } from "./openrouter-key";

function apiKey(): string {
  const value = getOpenRouterApiKey();
  if (!value) throw new Error("OPENROUTER_API_KEY is not configured.");
  return value;
}

export function createOpenRouterAdapter(): OpenRouterAdapter {
  return new OpenRouterAdapter({
    apiKey: apiKey(),
    appUrl: process.env.OPENROUTER_APP_URL,
    appName: process.env.OPENROUTER_APP_NAME,
  });
}

export function createOpenRouterModelCatalog(): OpenRouterModelCatalog {
  return new OpenRouterModelCatalog({
    apiKey: getOpenRouterApiKey() ?? undefined,
  });
}
