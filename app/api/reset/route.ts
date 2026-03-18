import { NextResponse } from "next/server";
import { resetSyncState } from "@/lib/sync-state";

export async function POST() {
  resetSyncState();
  return NextResponse.json({ message: "Sync state reset successfully." });
}
