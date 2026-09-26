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
    const seatFor = (playerId: string): number => {
      const player = request.observation.authoritative.players.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (!player) throw new Error(`Unknown fake-adapter player ${playerId}.`);
      return player.seat + 1;
    };
    const reply = (output: Record<string, unknown>): ModelAdapterResult => ({
      ok: true,
      output: (request.responseJsonSchema.required as string[]).includes(
        "explanation",
      )
        ? {
            ...output,
            explanation:
              "I chose this legal move based on the current game state.",
          }
        : output,
    });
    switch (action.kind) {
      case "DOCTOR_PROTECT":
        return reply({
          action: "protect",
          targetSeat: seatFor(action.legalTargetIds[0]!),
        });
      case "SEER_INSPECT":
        return reply({
          action: "inspect",
          targetSeat: seatFor(action.legalTargetIds[0]!),
        });
      case "WEREWOLF_PROPOSE":
        return reply({
          action: "propose_elimination",
          targetSeat: seatFor(action.legalTargetIds[0]!),
        });
      case "WEREWOLF_RESPOND":
        return reply({ action: "agree" });
      case "WITCH_ACT":
        return reply({
          action: "use_potions",
          useSavePotion: false,
          eliminateSeat: null,
        });
      case "DISCUSS":
        return reply({ action: "pass" });
      case "VOTE":
        return reply({
          action: "vote",
          targetSeat: seatFor(action.legalTargetIds[0]!),
        });
      case "FINAL_WORDS":
        return reply({ action: "final_words", message: "Good luck, village." });
    }
  }
}
