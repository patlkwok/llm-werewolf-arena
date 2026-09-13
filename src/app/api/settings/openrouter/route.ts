import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyOpenRouterApiKey } from "@/llm/openrouter";
import { fakeMode } from "@/server/model-runtime";
import {
  clearSessionOpenRouterApiKey,
  getOpenRouterKeyStatus,
  saveSessionOpenRouterApiKey,
} from "@/server/openrouter-key";

const submissionSchema = z
  .object({ apiKey: z.string().trim().min(10).max(512) })
  .strict();

function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export async function GET() {
  return NextResponse.json(getOpenRouterKeyStatus());
}

export async function POST(request: Request) {
  if (crossOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403 },
    );
  }
  const parsed = submissionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid OpenRouter API key." },
      { status: 400 },
    );
  }
  const verification = fakeMode()
    ? ({ ok: true } as const)
    : await verifyOpenRouterApiKey(parsed.data.apiKey);
  if (!verification.ok) {
    return NextResponse.json(
      {
        error:
          verification.category === "INVALID"
            ? "OpenRouter rejected this API key."
            : "OpenRouter could not verify the key. Try again shortly.",
      },
      { status: verification.category === "INVALID" ? 400 : 503 },
    );
  }
  saveSessionOpenRouterApiKey(parsed.data.apiKey);
  return NextResponse.json(getOpenRouterKeyStatus());
}

export async function DELETE(request: Request) {
  if (crossOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403 },
    );
  }
  clearSessionOpenRouterApiKey();
  return NextResponse.json(getOpenRouterKeyStatus());
}
