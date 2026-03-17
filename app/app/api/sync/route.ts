import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
      endTime = new Date().toISOString(),
      botRefId,
    } = body;

    const result = await runSync(startTime, endTime, undefined, botRefId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
