import { describe, expect, it, vi } from "vitest";
import { getPendingAction } from "@/game-engine/engine";
import { testGame } from "@/game-engine/test-helpers";
import { buildPlayerObservation } from "@/observations/builder";
import { responseContractFor } from "./contracts";
import {
  OPENROUTER_TIMEOUT_MS,
  OpenRouterAdapter,
  OpenRouterModelCatalog,
  verifyOpenRouterApiKey,
} from "./openrouter";
import { AdapterFailureCategory, type ModelTurnRequest } from "./types";

function modelRequest(): ModelTurnRequest {
  const state = testGame({ gameId: "openrouter-test" });
  const action = getPendingAction(state)!;
  const contract = responseContractFor(action);
  return {
    callId: "call-1",
    turnId: "turn-1",
    gameId: state.id,
    playerId: action.playerId,
    modelId: "vendor/model",
    action,
    observation: buildPlayerObservation(state, action.playerId),
    semanticAttempt: "INITIAL",
    responseAttempt: 1,
    correctionError: null,
    schemaName: contract.schemaName,
    responseJsonSchema: contract.jsonSchema,
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenRouter adapter", () => {
  it("uses strict structured output without overriding model defaults", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "generation-1",
        model: "resolved/model",
        provider: "Provider A",
        choices: [
          {
            message: {
              content: '{"action":"protect","targetPlayerId":"p1"}',
              reasoning: "private chain",
              reasoning_details: [{ type: "summary", text: "private" }],
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          cost: 0.0012,
          prompt_tokens_details: {
            cached_tokens: 10,
            cache_write_tokens: 2,
          },
          completion_tokens_details: { reasoning_tokens: 7 },
          cost_details: { upstream_inference_cost: 0.001 },
        },
      }),
    );
    const adapter = new OpenRouterAdapter({
      apiKey: "test-secret",
      fetchImpl,
      appUrl: "http://localhost:3000",
      appName: "Arena",
    });

    const result = await adapter.requestAction(modelRequest());

    expect(result).toMatchObject({
      ok: true,
      reasoning: "private chain",
      metadata: {
        responseId: "generation-1",
        responseModelId: "resolved/model",
        providerName: "Provider A",
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          reasoningTokens: 7,
          cachedTokens: 10,
          cacheWriteTokens: 2,
          totalTokens: 120,
          cost: 0.0012,
          upstreamInferenceCost: 0.001,
        },
      },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-secret",
    );
    expect(new Headers(init?.headers).get("X-OpenRouter-Metadata")).toBe(
      "enabled",
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "vendor/model",
      provider: { require_parameters: true, allow_fallbacks: true },
      response_format: {
        type: "json_schema",
        json_schema: { strict: true },
      },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("classifies timeout and provider failures", async () => {
    expect(OPENROUTER_TIMEOUT_MS).toBe(90_000);
    const timeoutFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const timedOut = await new OpenRouterAdapter({
      apiKey: "key",
      fetchImpl: timeoutFetch,
      timeoutMs: 1,
    }).requestAction(modelRequest());
    expect(timedOut).toMatchObject({
      ok: false,
      category: AdapterFailureCategory.TIMEOUT,
    });

    const rejected = await new OpenRouterAdapter({
      apiKey: "key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 429)),
    }).requestAction(modelRequest());
    expect(rejected).toMatchObject({
      ok: false,
      category: AdapterFailureCategory.PROVIDER_ERROR,
      message: "OpenRouter returned HTTP 429.",
    });
  });

  it("retains useful provider errors while redacting the API key", async () => {
    const result = await new OpenRouterAdapter({
      apiKey: "sensitive-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              message: "Provider unavailable",
              metadata: { raw: "No endpoint accepted sensitive-key" },
            },
          },
          400,
        ),
      ),
    }).requestAction(modelRequest());

    expect(result).toMatchObject({
      ok: false,
      category: AdapterFailureCategory.PROVIDER_ERROR,
      message:
        "OpenRouter returned HTTP 400: Provider unavailable — No endpoint accepted [REDACTED]",
    });
  });

  it("rejects malformed successful provider responses", async () => {
    const result = await new OpenRouterAdapter({
      apiKey: "key",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ ok: true })),
    }).requestAction(modelRequest());
    expect(result).toMatchObject({
      ok: false,
      category: AdapterFailureCategory.PROVIDER_ERROR,
    });
  });
});

describe("OpenRouter key verification", () => {
  it("checks the current-key endpoint without exposing the key in the URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { label: "Arena" } }));
    await expect(
      verifyOpenRouterApiKey("session-secret", { fetchImpl }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    expect(String(url)).not.toContain("session-secret");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer session-secret",
    );
  });

  it("distinguishes rejected credentials from provider failures", async () => {
    await expect(
      verifyOpenRouterApiKey("bad-key-value", {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({}, 401)),
      }),
    ).resolves.toEqual({ ok: false, category: "INVALID" });
    await expect(
      verifyOpenRouterApiKey("key-value", {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({}, 503)),
      }),
    ).resolves.toEqual({ ok: false, category: "PROVIDER_ERROR" });
  });
});

describe("OpenRouter model catalog", () => {
  it("returns only non-expired text models with structured-output support", async () => {
    const base = {
      context_length: 128_000,
      expiration_date: null,
      supported_parameters: ["structured_outputs"],
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      pricing: { prompt: "0.000001", completion: "0.000002" },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { ...base, id: "z/model", name: "Zulu" },
          { ...base, id: "a/model", name: "Alpha" },
          {
            ...base,
            id: "unknown-context",
            name: "Unknown Context",
            context_length: 0,
          },
          { id: "malformed-record" },
          {
            ...base,
            id: "image-only",
            name: "Image",
            architecture: {
              input_modalities: ["image"],
              output_modalities: ["text"],
            },
          },
          {
            ...base,
            id: "no-schema",
            name: "No schema",
            supported_parameters: ["tools"],
          },
          {
            ...base,
            id: "expired",
            name: "Expired",
            expiration_date: "2025-01-01T00:00:00Z",
          },
        ],
      }),
    );
    const models = await new OpenRouterModelCatalog({
      fetchImpl,
      now: () => Date.parse("2026-01-01T00:00:00Z"),
    }).listEligibleModels();

    expect(models.map((model) => model.id)).toEqual([
      "a/model",
      "unknown-context",
      "z/model",
    ]);
    expect(models[1]?.contextLength).toBeNull();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "output_modalities=text&supported_parameters=structured_outputs",
    );
  });
});
