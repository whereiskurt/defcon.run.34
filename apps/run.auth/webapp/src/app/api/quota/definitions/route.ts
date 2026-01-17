import { NextResponse } from "next/server";
import { QUOTA_DEFINITIONS, getEnabledQuotas } from "@/lib/quota-definitions";

/**
 * GET /api/quota/definitions
 *
 * List all quota type definitions.
 * Public endpoint - no authentication required.
 */
export async function GET() {
  try {
    const definitions = getEnabledQuotas();

    return NextResponse.json({
      definitions: definitions.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        tierLimits: d.tierLimits,
        resetPolicy: d.resetPolicy,
      })),
      allDefinitions: Object.values(QUOTA_DEFINITIONS).map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        tierLimits: d.tierLimits,
        resetPolicy: d.resetPolicy,
        enabled: d.enabled,
      })),
    });
  } catch (error) {
    console.error("[GET /api/quota/definitions] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
