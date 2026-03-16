import fs from "fs";
import path from "path";

const STATE_FILE = path.join(process.cwd(), "sync-state.json");

interface SyncState {
  syncedConversationIds: string[];
  lastSyncAt: string | null;
  totalSynced: number;
}

function readState(): SyncState {
  if (!fs.existsSync(STATE_FILE)) {
    return { syncedConversationIds: [], lastSyncAt: null, totalSynced: 0 };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function writeState(state: SyncState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function isAlreadySynced(conversationId: string): boolean {
  const state = readState();
  return state.syncedConversationIds.includes(conversationId);
}

export function markAsSynced(conversationId: string): void {
  const state = readState();
  if (!state.syncedConversationIds.includes(conversationId)) {
    state.syncedConversationIds.push(conversationId);
    state.totalSynced = state.syncedConversationIds.length;
    state.lastSyncAt = new Date().toISOString();
    writeState(state);
  }
}

export function getSyncState(): SyncState {
  return readState();
}

export function resetSyncState(): void {
  writeState({ syncedConversationIds: [], lastSyncAt: null, totalSynced: 0 });
}
