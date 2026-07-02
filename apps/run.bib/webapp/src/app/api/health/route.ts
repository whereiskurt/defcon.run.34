import { NextResponse } from "next/server";

/**
 * GET /api/health - Health check endpoint for load balancer
 *
 * Whitelisted in middleware.ts so ALB health checks don't require a session.
 */
export async function GET() {
  return NextResponse.json({
    status: "healthy",
    service: "run.bib",
    timestamp: new Date().toISOString(),
  });
}
