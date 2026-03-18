import { NextResponse } from "next/server";
import { listInboxes } from "@/lib/chatwoot";

export async function GET() {
  try {
    const data = await listInboxes();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
