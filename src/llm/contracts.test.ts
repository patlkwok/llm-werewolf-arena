import { describe, expect, it } from "vitest";
import type { PendingAction } from "@/game-engine/types";
import { parseStructuredResponse, responseContractFor } from "./contracts";

const doctorPending: PendingAction = {
  kind: "DOCTOR_PROTECT",
  playerId: "doctor",
  legalTargetIds: ["doctor", "other"],
};

describe("phase response contracts", () => {
  it("parses JSON strings and structured objects", () => {
    expect(
      parseStructuredResponse(
        doctorPending,
        JSON.stringify({ action: "protect", targetPlayerId: "other" }),
      ),
    ).toMatchObject({
      ok: true,
      action: { action: "protect", targetPlayerId: "other" },
    });
    expect(
      parseStructuredResponse(
        { kind: "DISCUSS", playerId: "p", dayNumber: 1, roundNumber: 1 },
        { action: "pass", message: "" },
      ),
    ).toEqual({ ok: true, action: { action: "pass" } });
  });

  it("classifies malformed JSON separately from schema-invalid output", () => {
    expect(parseStructuredResponse(doctorPending, "{bad json")).toMatchObject({
      ok: false,
      category: "MALFORMED_JSON",
    });
    expect(
      parseStructuredResponse(doctorPending, { action: "protect" }),
    ).toMatchObject({
      ok: false,
      category: "SCHEMA_INVALID",
    });
  });

  it("rejects additional properties", () => {
    expect(
      parseStructuredResponse(doctorPending, {
        action: "protect",
        targetPlayerId: "other",
        hiddenProse: "also do something else",
      }),
    ).toMatchObject({ ok: false, category: "SCHEMA_INVALID" });
  });

  it("keeps schema validity separate from game legality", () => {
    expect(
      parseStructuredResponse(doctorPending, {
        action: "protect",
        targetPlayerId: "not-a-legal-target",
      }),
    ).toMatchObject({ ok: true });
    expect(
      parseStructuredResponse(
        {
          kind: "VOTE",
          playerId: "p",
          dayNumber: 1,
          legalTargetIds: ["q"],
          strategicAbstentionAllowed: false,
        },
        { action: "abstain" },
      ),
    ).toEqual({ ok: true, action: { action: "abstain" } });
  });

  it("provides a strict JSON Schema for every phase-specific contract", () => {
    const pendings: PendingAction[] = [
      doctorPending,
      { kind: "SEER_INSPECT", playerId: "p", legalTargetIds: ["q"] },
      {
        kind: "WEREWOLF_PROPOSE",
        playerId: "p",
        legalTargetIds: ["q"],
        attemptNumber: 1,
      },
      {
        kind: "WEREWOLF_RESPOND",
        playerId: "p",
        proposalTargetId: "q",
        attemptNumber: 1,
      },
      { kind: "DISCUSS", playerId: "p", dayNumber: 1, roundNumber: 1 },
      {
        kind: "VOTE",
        playerId: "p",
        dayNumber: 1,
        legalTargetIds: ["q"],
        strategicAbstentionAllowed: false,
      },
      { kind: "FINAL_WORDS", playerId: "p", dayNumber: 1 },
    ];
    for (const pending of pendings) {
      const contract = responseContractFor(pending);
      expect(contract.schemaName).toBeTruthy();
      expect(contract.jsonSchema).toMatchObject({
        type: "object",
        required: expect.any(Array),
        additionalProperties: false,
      });
      expect(contract.jsonSchema).not.toHaveProperty("$schema");
      expect(contract.jsonSchema).not.toHaveProperty("anyOf");
    }
  });
});
