import { NextResponse } from "next/server";
import { listAllConversationIds, deleteConversation } from "@/lib/chatwoot";
import { resetSyncState } from "@/lib/sync-state";

export async function POST() {
  try {
    const inboxId = parseInt(process.env.CHATWOOT_INBOX_ID!, 10);
    const ids = await listAllConversationIds(inboxId);

    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteConversation(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    await resetSyncState();

    return NextResponse.json({ deleted, failed, total: ids.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
