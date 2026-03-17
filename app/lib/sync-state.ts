// In-memory sync state — persists for the lifetime of the process.
// On Vercel, this resets on each cold start, but deduplication is also
// enforced by checking whether a contact with the same identifier already
// exists in Chatwoot (see syncSingleConversation in sync.ts).

interface SyncState {
  syncedConversationIds: string[];
  lastSyncAt: string | null;
  totalSynced: number;
}

const state: SyncState = {
  syncedConversationIds: [],
  lastSyncAt: null,
  totalSynced: 0,
};

export function isAlreadySynced(conversationId: string): boolean {
  return state.syncedConversationIds.includes(conversationId);
}

export function markAsSynced(conversationId: string): void {
  if (!state.syncedConversationIds.includes(conversationId)) {
    state.syncedConversationIds.push(conversationId);
    state.totalSynced = state.syncedConversationIds.length;
    state.lastSyncAt = new Date().toISOString();
  }
}

export function getSyncState(): SyncState {
  return { ...state };
}

export function resetSyncState(): void {
  state.syncedConversationIds = [];
  state.lastSyncAt = null;
  state.totalSynced = 0;
}
