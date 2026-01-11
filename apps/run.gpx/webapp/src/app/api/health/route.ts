import { NextResponse } from "next/server";

/**
 * GET /api/health - Health check endpoint for load balancer
 */
export async function GET() {
  return NextResponse.json({
    status: "healthy",
    service: "run.gpx",
    timestamp: new Date().toISOString(),
  });
}
