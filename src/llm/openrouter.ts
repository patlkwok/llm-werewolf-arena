import { z } from "zod";
import {
  AdapterFailureCategory,
  type ModelAdapter,
  type ModelAdapterResult,
  type ModelResponseMetadata,
  type ModelTurnRequest,
  type ModelUsage,
} from "./types";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_TIMEOUT_MS = 90_000;
export const OPENROUTER_KEY_VERIFICATION_TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

export type OpenRouterKeyVerification =
  { ok: true } | { ok: false; category: "INVALID" | "PROVIDER_ERROR" };

export async function verifyOpenRouterApiKey(
  apiKey: string,
  options: {
    fetchImpl?: Fetch;
    baseUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<OpenRouterKeyVerification> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? OPENROUTER_KEY_VERIFICATION_TIMEOUT_MS,
  );
  try {
    const baseUrl = (options.baseUrl ?? OPENROUTER_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/key`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) return { ok: true };
    return {
      ok: false,
      category:
        response.status === 401 || response.status === 403
          ? "INVALID"
          : "PROVIDER_ERROR",
    };
  } catch {
    return { ok: false, category: "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timeout);
  }
}

export interface OpenRouterAdapterOptions {
  apiKey: string;
  fetchImpl?: Fetch;
  baseUrl?: string;
  timeoutMs?: number;
  appUrl?: string;
  appName?: string;
}

const usageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    cost: z.number().nullish(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().nullish(),
        cache_write_tokens: z.number().nullish(),
      })
      .nullish(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().nullish() })
      .nullish(),
    cost_details: z
      .object({ upstream_inference_cost: z.number().nullish() })
      .nullish(),
  })
  .nullish();

const completionSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
          reasoning: z.string().nullish(),
          reasoning_details: z.unknown().nullish(),
        }),
      }),
    )
    .min(1),
  usage: usageSchema,
  openrouter_metadata: z
    .object({
      provider: z.string().nullish(),
      provider_name: z.string().nullish(),
    })
    .nullish(),
});

export class OpenRouterAdapter implements ModelAdapter {
  private readonly fetchImpl: Fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenRouterAdapterOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("An OpenRouter API key is required.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? OPENROUTER_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
  }

  async requestAction(request: ModelTurnRequest): Promise<ModelAdapterResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          signal: controller.signal,
          headers: this.headers(),
          body: JSON.stringify({
            model: request.modelId,
            messages: request.messages,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: request.responseJsonSchema,
              },
            },
            provider: {
              require_parameters: true,
              allow_fallbacks: true,
            },
          }),
        },
      );

      if (!response.ok) {
        return providerFailure(
          await openRouterErrorMessage(
            response,
            this.options.apiKey,
            `OpenRouter returned HTTP ${response.status}.`,
          ),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return providerFailure("OpenRouter returned a non-JSON response.");
      }
      const parsed = completionSchema.safeParse(payload);
      if (!parsed.success) {
        return providerFailure(
          "OpenRouter returned an invalid completion response.",
        );
      }

      const choice = parsed.data.choices[0]!;
      return {
        ok: true,
        output: choice.message.content,
        ...(choice.message.reasoning
          ? { reasoning: choice.message.reasoning }
          : {}),
        metadata: normalizeMetadata(parsed.data, choice.message),
      };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return {
          ok: false,
          category: AdapterFailureCategory.TIMEOUT,
          message: `OpenRouter did not respond within ${this.timeoutMs}ms.`,
        };
      }
      return providerFailure(
        error instanceof Error
          ? `OpenRouter request failed: ${error.message}`
          : "OpenRouter request failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.options.apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Metadata": "enabled",
      ...(this.options.appUrl ? { "HTTP-Referer": this.options.appUrl } : {}),
      ...(this.options.appName ? { "X-Title": this.options.appName } : {}),
    };
  }
}

function providerFailure(message: string): ModelAdapterResult {
  return {
    ok: false,
    category: AdapterFailureCategory.PROVIDER_ERROR,
    message,
  };
}

async function openRouterErrorMessage(
  response: Response,
  apiKey: string,
  fallback: string,
): Promise<string> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fallback;
  }

  const parsed = z
    .object({
      error: z
        .object({
          message: z.string().optional(),
          metadata: z
            .object({ raw: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .safeParse(payload);
  if (!parsed.success) return fallback;

  const details = [
    parsed.data.error?.message,
    parsed.data.error?.metadata?.raw,
  ].filter((detail): detail is string => Boolean(detail?.trim()));
  if (details.length === 0) return fallback;

  const sanitized = [...new Set(details)]
    .join(" — ")
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1_000);
  return sanitized ? `${fallback.slice(0, -1)}: ${sanitized}` : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeMetadata(
  response: z.infer<typeof completionSchema>,
  message: z.infer<typeof completionSchema>["choices"][number]["message"],
): ModelResponseMetadata {
  return {
    responseId: response.id ?? null,
    responseModelId: response.model ?? null,
    providerName:
      response.openrouter_metadata?.provider_name ??
      response.openrouter_metadata?.provider ??
      response.provider ??
      null,
    reasoningDetails: message.reasoning_details ?? null,
    usage: response.usage ? normalizeUsage(response.usage) : null,
  };
}

function normalizeUsage(
  usage: NonNullable<z.infer<typeof usageSchema>>,
): ModelUsage {
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    cost: usage.cost ?? null,
    upstreamInferenceCost: usage.cost_details?.upstream_inference_cost ?? null,
  };
}

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  context_length: z.number().int().nonnegative().nullish(),
  expiration_date: z.string().nullish(),
  supported_parameters: z.array(z.string()).default([]),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).default([]),
      output_modalities: z.array(z.string()).default([]),
    })
    .default({ input_modalities: [], output_modalities: [] }),
  pricing: z
    .object({
      prompt: z.string().nullish(),
      completion: z.string().nullish(),
    })
    .nullish(),
});

const modelsResponseSchema = z.object({ data: z.array(z.unknown()) });

export interface EligibleModel {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt: string | null; completion: string | null } | null;
}

export interface OpenRouterModelCatalogOptions {
  fetchImpl?: Fetch;
  baseUrl?: string;
  apiKey?: string;
  now?: () => number;
}

export class OpenRouterModelCatalog {
  private readonly fetchImpl: Fetch;
  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(private readonly options: OpenRouterModelCatalogOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? OPENROUTER_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.now = options.now ?? Date.now;
  }

  async listEligibleModels(): Promise<EligibleModel[]> {
    const query = new URLSearchParams({
      output_modalities: "text",
      supported_parameters: "structured_outputs",
    });
    const response = await this.fetchImpl(`${this.baseUrl}/models?${query}`, {
      headers: this.options.apiKey
        ? { Authorization: `Bearer ${this.options.apiKey}` }
        : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `OpenRouter model discovery returned HTTP ${response.status}.`,
      );
    }
    const parsed = modelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("OpenRouter returned an invalid model catalog response.");
    }

    return parsed.data.data
      .map((candidate) => modelSchema.safeParse(candidate))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter((model) => isEligibleModel(model, this.now()))
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextLength:
          model.context_length && model.context_length > 0
            ? model.context_length
            : null,
        pricing: model.pricing
          ? {
              prompt: model.pricing.prompt ?? null,
              completion: model.pricing.completion ?? null,
            }
          : null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

function isEligibleModel(
  model: z.infer<typeof modelSchema>,
  now: number,
): boolean {
  const expiresAt = model.expiration_date
    ? Date.parse(model.expiration_date)
    : Number.POSITIVE_INFINITY;
  return (
    model.architecture.input_modalities.includes("text") &&
    model.architecture.output_modalities.includes("text") &&
    model.supported_parameters.includes("structured_outputs") &&
    (Number.isNaN(expiresAt) || expiresAt > now)
  );
}
