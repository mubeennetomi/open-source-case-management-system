import { NextResponse } from "next/server";
import { getSyncState } from "@/lib/sync-state";

export async function GET() {
  return NextResponse.json(getSyncState());
}
