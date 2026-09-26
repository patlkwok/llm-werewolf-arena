import { z } from "zod";
import type { GameAction, PendingAction, PlayerId } from "@/game-engine/types";

export type SeatAction =
  | {
      action: "protect" | "inspect" | "propose_elimination" | "vote";
      targetSeat: number;
    }
  | {
      action: "use_potions";
      useSavePotion: boolean;
      eliminateSeat: number | null;
    }
  | { action: "speak"; message: string }
  | { action: "pass" }
  | { action: "agree" }
  | { action: "disagree" }
  | { action: "abstain" }
  | { action: "final_words"; message: string };

const discussionSchema: z.ZodType<SeatAction> = z.union([
  z.object({ action: z.literal("speak"), message: z.string().min(1) }).strict(),
  z
    .object({ action: z.literal("pass"), message: z.string().optional() })
    .strict()
    .transform(() => ({ action: "pass" as const })),
]);
const seatSchema = z.number().int().positive();
const doctorSchema: z.ZodType<SeatAction> = z
  .object({ action: z.literal("protect"), targetSeat: seatSchema })
  .strict();
const seerSchema: z.ZodType<SeatAction> = z
  .object({ action: z.literal("inspect"), targetSeat: seatSchema })
  .strict();
const witchSchema: z.ZodType<SeatAction> = z
  .object({
    action: z.literal("use_potions"),
    useSavePotion: z.boolean(),
    eliminateSeat: seatSchema.nullable(),
  })
  .strict();
const werewolfProposalSchema: z.ZodType<SeatAction> = z
  .object({
    action: z.literal("propose_elimination"),
    targetSeat: seatSchema,
  })
  .strict();
const werewolfResponseSchema: z.ZodType<SeatAction> = z.union([
  z.object({ action: z.literal("agree") }).strict(),
  z.object({ action: z.literal("disagree") }).strict(),
]);
const voteSchema: z.ZodType<SeatAction> = z.union([
  z.object({ action: z.literal("vote"), targetSeat: seatSchema }).strict(),
  z
    .object({
      action: z.literal("abstain"),
      targetSeat: z.null().optional(),
    })
    .strict()
    .transform(() => ({ action: "abstain" as const })),
]);
const finalWordsSchema: z.ZodType<SeatAction> = z
  .object({ action: z.literal("final_words"), message: z.string().min(1) })
  .strict();

interface ResponseContract {
  schemaName: string;
  schema: z.ZodType<SeatAction>;
  jsonSchema: Record<string, unknown>;
}

function contract(
  schemaName: string,
  schema: z.ZodType<SeatAction>,
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
const seatProperty = { type: "integer", minimum: 1 };
const messageProperty = { type: "string" };

export function responseContractFor(
  action: PendingAction,
  requireExplanation = false,
): ResponseContract {
  const base = baseResponseContractFor(action);
  if (!requireExplanation) return base;
  return {
    ...base,
    schemaName: `${base.schemaName}_explained`,
    jsonSchema: {
      ...base.jsonSchema,
      properties: {
        ...(base.jsonSchema.properties as Record<string, unknown>),
        explanation: { type: "string", minLength: 1 },
      },
      required: [...(base.jsonSchema.required as string[]), "explanation"],
    },
  };
}

function baseResponseContractFor(action: PendingAction): ResponseContract {
  switch (action.kind) {
    case "DOCTOR_PROTECT":
      return contract(
        "doctor_protection",
        doctorSchema,
        strictObjectSchema({
          action: actionProperty("protect"),
          targetSeat: seatProperty,
        }),
      );
    case "SEER_INSPECT":
      return contract(
        "seer_inspection",
        seerSchema,
        strictObjectSchema({
          action: actionProperty("inspect"),
          targetSeat: seatProperty,
        }),
      );
    case "WITCH_ACT":
      return contract(
        "witch_potions",
        witchSchema,
        strictObjectSchema({
          action: actionProperty("use_potions"),
          useSavePotion: { type: "boolean" },
          eliminateSeat: { type: ["integer", "null"], minimum: 1 },
        }),
      );
    case "WEREWOLF_PROPOSE":
      return contract(
        "werewolf_proposal",
        werewolfProposalSchema,
        strictObjectSchema({
          action: actionProperty("propose_elimination"),
          targetSeat: seatProperty,
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
          targetSeat: { type: ["integer", "null"], minimum: 1 },
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
  | { ok: true; action: SeatAction; explanation: string | null }
  | {
      ok: false;
      category: "MALFORMED_JSON" | "SCHEMA_INVALID";
      message: string;
    };

export function parseStructuredResponse(
  pending: PendingAction,
  output: unknown,
  requireExplanation = false,
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

  let explanation: string | null = null;
  if (requireExplanation) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      typeof (candidate as Record<string, unknown>).explanation !== "string" ||
      !(candidate as { explanation: string }).explanation.trim()
    ) {
      return {
        ok: false,
        category: "SCHEMA_INVALID",
        message: "A non-empty private move explanation is required.",
      };
    }
    explanation = (candidate as { explanation: string }).explanation.trim();
    const actionOnly = { ...(candidate as Record<string, unknown>) };
    delete actionOnly.explanation;
    candidate = actionOnly;
  }
  const parsed = responseContractFor(pending).schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      category: "SCHEMA_INVALID",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }
  return { ok: true, action: parsed.data, explanation };
}

export function resolveSeatAction(
  action: SeatAction,
  playerIdForSeat: (seat: number) => PlayerId,
): GameAction {
  switch (action.action) {
    case "protect":
    case "inspect":
    case "propose_elimination":
    case "vote":
      return {
        action: action.action,
        targetPlayerId: playerIdForSeat(action.targetSeat),
      };
    case "use_potions":
      return {
        action: action.action,
        useSavePotion: action.useSavePotion,
        eliminatePlayerId:
          action.eliminateSeat === null
            ? null
            : playerIdForSeat(action.eliminateSeat),
      };
    default:
      return action;
  }
}
