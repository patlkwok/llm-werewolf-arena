import {
  AdapterFailureCategory,
  type ModelAdapter,
  type ModelAdapterResult,
  type ModelResponseMetadata,
  type ModelTurnRequest,
} from "./types";

export type ScriptedOutcome =
  | {
      type: "response";
      output: unknown;
      reasoning?: string;
      metadata?: ModelResponseMetadata;
    }
  | { type: "failure"; category: AdapterFailureCategory; message?: string };

export class ScriptedModelAdapter implements ModelAdapter {
  readonly requests: ModelTurnRequest[] = [];
  private readonly outcomes: ScriptedOutcome[];

  constructor(outcomes: readonly ScriptedOutcome[]) {
    this.outcomes = [...outcomes];
  }

  async requestAction(request: ModelTurnRequest): Promise<ModelAdapterResult> {
    this.requests.push(structuredClone(request));
    const outcome = this.outcomes.shift();
    if (!outcome) {
      return {
        ok: false,
        category: AdapterFailureCategory.PROVIDER_ERROR,
        message: "The scripted adapter has no response remaining.",
      };
    }
    if (outcome.type === "failure") {
      return {
        ok: false,
        category: outcome.category,
        message: outcome.message ?? "Scripted adapter failure.",
      };
    }
    return {
      ok: true,
      output: structuredClone(outcome.output),
      ...(outcome.reasoning === undefined
        ? {}
        : { reasoning: outcome.reasoning }),
      ...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
    };
  }
}

export class RuleBasedFakeAdapter implements ModelAdapter {
  readonly requests: ModelTurnRequest[] = [];

  async requestAction(request: ModelTurnRequest): Promise<ModelAdapterResult> {
    this.requests.push(structuredClone(request));
    const action = request.action;
    switch (action.kind) {
      case "DOCTOR_PROTECT":
        return {
          ok: true,
          output: {
            action: "protect",
            targetPlayerId: action.legalTargetIds[0],
          },
        };
      case "SEER_INSPECT":
        return {
          ok: true,
          output: {
            action: "inspect",
            targetPlayerId: action.legalTargetIds[0],
          },
        };
      case "WEREWOLF_PROPOSE":
        return {
          ok: true,
          output: {
            action: "propose_elimination",
            targetPlayerId: action.legalTargetIds[0],
          },
        };
      case "WEREWOLF_RESPOND":
        return { ok: true, output: { action: "agree" } };
      case "DISCUSS":
        return { ok: true, output: { action: "pass" } };
      case "VOTE":
        return {
          ok: true,
          output: { action: "vote", targetPlayerId: action.legalTargetIds[0] },
        };
      case "FINAL_WORDS":
        return {
          ok: true,
          output: { action: "final_words", message: "Good luck, village." },
        };
    }
  }
}
