import "server-only";
import { RuleBasedFakeAdapter, type ModelAdapter } from "@/llm";
import {
  createOpenRouterAdapter,
  createOpenRouterModelCatalog,
} from "./openrouter";
import { getOpenRouterKeyStatus } from "./openrouter-key";

interface ModelCatalog {
  listEligibleModels(): Promise<
    Array<{
      id: string;
      name: string;
      contextLength: number | null;
      pricing: { prompt: string | null; completion: string | null } | null;
    }>
  >;
}

export function fakeMode(): boolean {
  return process.env.ARENA_MODEL_ADAPTER === "FAKE";
}

export function arenaModelCredentialsConfigured(): boolean {
  return fakeMode() || getOpenRouterKeyStatus().configured;
}

export function createArenaModelAdapter(): ModelAdapter {
  return fakeMode() ? new RuleBasedFakeAdapter() : createOpenRouterAdapter();
}

export function createArenaModelCatalog(): ModelCatalog {
  if (!fakeMode()) return createOpenRouterModelCatalog();
  return {
    async listEligibleModels() {
      return [
        {
          id: "vendor/model-a",
          name: "Deterministic Test Model A",
          contextLength: 128_000,
          pricing: null,
        },
        {
          id: "vendor/model-b",
          name: "Deterministic Test Model B",
          contextLength: 128_000,
          pricing: null,
        },
      ];
    },
  };
}
