import { NextResponse } from "next/server";
import { createArenaModelCatalog } from "@/server/model-runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await createArenaModelCatalog().listEligibleModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.error(
      "OpenRouter model catalog load failed:",
      error instanceof Error ? error.message : "Unknown catalog error",
    );
    return NextResponse.json(
      {
        error: "Eligible OpenRouter models could not be loaded.",
        code: "MODEL_CATALOG_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
