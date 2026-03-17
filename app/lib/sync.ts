import { fetchAllConversations, fetchWebhookHistory, NetomiConversationSummary } from "./netomi";
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


async function syncSingleConversation(
  conv: NetomiConversationSummary,
  inboxId: number,
  botRefId?: string
): Promise<void> {
  // 1. Fetch messages from webhook-history (includes visitor info)
  const { messages, visitorInfo } = await fetchWebhookHistory(conv.conversationId, botRefId);

  const name = visitorInfo.name || visitorName(conv.conversationId);
  const email = visitorInfo.email;

  // 2. Find or create Chatwoot contact
  const contact = await findOrCreateContact(conv.conversationId, name, inboxId, email);

  // 3. Create conversation in Chatwoot
  const chaConv = await createConversation(inboxId, contact.id, {
    netomi_conversation_id: conv.conversationId,
    device_info: conv.deviceInfo,
    platform: conv.platform,
    browser: conv.browserInfo,
    started_at: conv.startTime,
    ended_at: conv.endTime,
  }, conv.startTime);

  // 4. Push messages in order
  for (const msg of messages) {
    const isoTime = new Date(msg.timestampMs).toISOString();
    await createMessage(chaConv.id, msg.content, msg.type, isoTime);
  }
}

export async function runSync(
  startTime: string,
  endTime: string,
  onProgress?: (p: SyncProgress) => void,
  botRefId?: string
): Promise<SyncResult> {
  const inboxId = parseInt(process.env.CHATWOOT_INBOX_ID || "0");
  if (!inboxId) {
    throw new Error("CHATWOOT_INBOX_ID is not set. Create an API inbox in Chatwoot first.");
  }

  const start = Date.now();
  const conversations = await fetchAllConversations(startTime, endTime, botRefId);

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
      await syncSingleConversation(conv, inboxId, botRefId);
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
