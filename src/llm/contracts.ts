import { z } from "zod";
import type { GameAction, PendingAction } from "@/game-engine/types";

const discussionSchema: z.ZodType<GameAction> = z.union([
  z.object({ action: z.literal("speak"), message: z.string().min(1) }).strict(),
  z
    .object({ action: z.literal("pass"), message: z.string().optional() })
    .strict()
    .transform(() => ({ action: "pass" as const })),
]);
const doctorSchema: z.ZodType<GameAction> = z
  .object({ action: z.literal("protect"), targetPlayerId: z.string().min(1) })
  .strict();
const seerSchema: z.ZodType<GameAction> = z
  .object({ action: z.literal("inspect"), targetPlayerId: z.string().min(1) })
  .strict();
const werewolfProposalSchema: z.ZodType<GameAction> = z
  .object({
    action: z.literal("propose_elimination"),
    targetPlayerId: z.string().min(1),
  })
  .strict();
const werewolfResponseSchema: z.ZodType<GameAction> = z.union([
  z.object({ action: z.literal("agree") }).strict(),
  z.object({ action: z.literal("disagree") }).strict(),
]);
const voteSchema: z.ZodType<GameAction> = z.union([
  z
    .object({ action: z.literal("vote"), targetPlayerId: z.string().min(1) })
    .strict(),
  z
    .object({
      action: z.literal("abstain"),
      targetPlayerId: z.null().optional(),
    })
    .strict()
    .transform(() => ({ action: "abstain" as const })),
]);
const finalWordsSchema: z.ZodType<GameAction> = z
  .object({ action: z.literal("final_words"), message: z.string().min(1) })
  .strict();

interface ResponseContract {
  schemaName: string;
  schema: z.ZodType<GameAction>;
  jsonSchema: Record<string, unknown>;
}

function contract(
  schemaName: string,
  schema: z.ZodType<GameAction>,
  jsonSchema: Record<string, unknown>,
): ResponseContract {
  return { schemaName, schema, jsonSchema };
}

function strictObjectSchema(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const actionProperty = (...values: string[]) => ({
  type: "string",
  enum: values,
});
const playerIdProperty = { type: "string", minLength: 1 };
const messageProperty = { type: "string" };

export function responseContractFor(action: PendingAction): ResponseContract {
  switch (action.kind) {
    case "DOCTOR_PROTECT":
      return contract(
        "doctor_protection",
        doctorSchema,
        strictObjectSchema({
          action: actionProperty("protect"),
          targetPlayerId: playerIdProperty,
        }),
      );
    case "SEER_INSPECT":
      return contract(
        "seer_inspection",
        seerSchema,
        strictObjectSchema({
          action: actionProperty("inspect"),
          targetPlayerId: playerIdProperty,
        }),
      );
    case "WEREWOLF_PROPOSE":
      return contract(
        "werewolf_proposal",
        werewolfProposalSchema,
        strictObjectSchema({
          action: actionProperty("propose_elimination"),
          targetPlayerId: playerIdProperty,
        }),
      );
    case "WEREWOLF_RESPOND":
      return contract(
        "werewolf_response",
        werewolfResponseSchema,
        strictObjectSchema({ action: actionProperty("agree", "disagree") }),
      );
    case "DISCUSS":
      return contract(
        "day_discussion",
        discussionSchema,
        strictObjectSchema({
          action: actionProperty("speak", "pass"),
          message: messageProperty,
        }),
      );
    case "VOTE":
      return contract(
        "exile_vote",
        voteSchema,
        strictObjectSchema({
          action: actionProperty("vote", "abstain"),
          targetPlayerId: { type: ["string", "null"] },
        }),
      );
    case "FINAL_WORDS":
      return contract(
        "final_words",
        finalWordsSchema,
        strictObjectSchema({
          action: actionProperty("final_words"),
          message: messageProperty,
        }),
      );
  }
}

export type ParseResponseResult =
  | { ok: true; action: GameAction }
  | {
      ok: false;
      category: "MALFORMED_JSON" | "SCHEMA_INVALID";
      message: string;
    };

export function parseStructuredResponse(
  pending: PendingAction,
  output: unknown,
): ParseResponseResult {
  let candidate = output;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return {
        ok: false,
        category: "MALFORMED_JSON",
        message: "The response was not valid JSON.",
      };
    }
  }

  const parsed = responseContractFor(pending).schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      category: "SCHEMA_INVALID",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }
  return { ok: true, action: parsed.data };
}
