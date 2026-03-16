import { fetchAllConversations, fetchConversationLogs, NetomiConversationSummary } from "./netomi";
import {
  findOrCreateContact,
  createConversation,
  createMessage,
  resolveConversation,
} from "./chatwoot";
import { isAlreadySynced, markAsSynced } from "./sync-state";

export interface SyncProgress {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  current: string | null;
  errors: string[];
}

export interface SyncResult extends SyncProgress {
  done: boolean;
  duration_ms: number;
}

// Generate a deterministic visitor name from conversationId
function visitorName(conversationId: string): string {
  const num = parseInt(conversationId.replace(/-/g, "").substring(0, 8), 16) % 9000 + 1000;
  return `Visitor #${num}`;
}

function messageTypeForNetomi(
  generatedBy: string | null | undefined
): "incoming" | "outgoing" {
  // USER messages → incoming (from user's perspective)
  // SYSTEM / BOT messages → outgoing
  return generatedBy === "USER" ? "incoming" : "outgoing";
}

function shouldSkipMessage(msg: { type: string; message: string }): boolean {
  // Skip system carousel placeholders that aren't real text
  const skipPatterns = ["PROACTIVE_GREETING"];
  return skipPatterns.includes(msg.message);
}

async function syncSingleConversation(
  conv: NetomiConversationSummary,
  inboxId: number,
  startTime: string,
  endTime: string
): Promise<void> {
  const name = visitorName(conv.conversationId);

  // 1. Find or create Chatwoot contact
  const contact = await findOrCreateContact(conv.conversationId, name, inboxId);

  // 2. Create conversation in Chatwoot
  const chaConv = await createConversation(inboxId, contact.id, {
    netomi_conversation_id: conv.conversationId,
    device_info: conv.deviceInfo,
    platform: conv.platform,
    browser: conv.browserInfo,
    started_at: conv.startTime,
    ended_at: conv.endTime,
  });

  // 4. Fetch message logs from Netomi
  const logs = await fetchConversationLogs(conv.conversationId, startTime, endTime);

  // 5. Push messages in order
  for (const msg of logs) {
    if (shouldSkipMessage(msg)) continue;

    const content = msg.message || "(no content)";
    const type = messageTypeForNetomi(msg.generatedBy);

    await createMessage(chaConv.id, content, type, msg.time);
  }

  // 6. Resolve if the Netomi conversation is complete
  if (conv.isComplete) {
    await resolveConversation(chaConv.id);
  }
}

export async function runSync(
  startTime: string,
  endTime: string,
  onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
  const inboxId = parseInt(process.env.CHATWOOT_INBOX_ID || "0");
  if (!inboxId) {
    throw new Error("CHATWOOT_INBOX_ID is not set. Create an API inbox in Chatwoot first.");
  }

  const start = Date.now();
  const conversations = await fetchAllConversations(startTime, endTime);

  const progress: SyncProgress = {
    total: conversations.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    current: null,
    errors: [],
  };

  for (const conv of conversations) {
    progress.current = conv.conversationId;
    onProgress?.(progress);

    if (isAlreadySynced(conv.conversationId)) {
      progress.skipped++;
      continue;
    }

    try {
      await syncSingleConversation(conv, inboxId, startTime, endTime);
      markAsSynced(conv.conversationId);
      progress.processed++;
    } catch (err) {
      progress.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      progress.errors.push(`[${conv.conversationId}] ${msg}`);
      console.error(`Failed to sync conversation ${conv.conversationId}:`, err);
    }

    onProgress?.(progress);
  }

  return {
    ...progress,
    current: null,
    done: true,
    duration_ms: Date.now() - start,
  };
}
