import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "run.gpx",
    timestamp: new Date().toISOString(),
  });
}
