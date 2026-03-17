const BASE_URL = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
const API_TOKEN = process.env.CHATWOOT_API_TOKEN!;

function headers() {
  return {
    "Content-Type": "application/json",
    api_access_token: API_TOKEN,
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatwoot API error ${res.status} at ${path}: ${body}`);
  }

  const json = await res.json();

  // Chatwoot sometimes wraps the response in a `payload` key — unwrap if needed
  // but only for non-array payloads that look like a single entity
  return json as T;
}

// ── Inboxes ───────────────────────────────────────────────────────────────────

export async function listInboxes(): Promise<{ payload: ChaInbox[] }> {
  return request("/inboxes");
}

export interface ChaInbox {
  id: number;
  name: string;
  channel_type: string;
  channel_id: string;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export interface ChaContact {
  id: number;
  name: string;
  identifier: string;
  contact_inboxes: { source_id: string; inbox: { id: number } }[];
}

// Normalise a raw API response to a ChaContact — handles multiple wrapping shapes.
function normaliseContact(raw: unknown): ChaContact {
  const obj = raw as Record<string, unknown>;

  // { payload: { contact: { id, ... } } }
  if (obj.payload && typeof obj.payload === "object") {
    const payload = obj.payload as Record<string, unknown>;
    if (payload.contact && typeof payload.contact === "object") {
      return payload.contact as ChaContact;
    }
    // { payload: { id, ... } }
    if (payload.id) return payload as unknown as ChaContact;
  }

  // Direct: { id, name, ... }
  if (obj.id) return obj as unknown as ChaContact;

  console.error("[chatwoot] Unexpected contact response shape:", JSON.stringify(obj));
  throw new Error("Unexpected contact response shape from Chatwoot API");
}

export async function findOrCreateContact(
  identifier: string,
  name: string,
  inboxId: number,
  email?: string
): Promise<ChaContact> {
  // Search by identifier
  const search = await request<{ payload: ChaContact[] | { contacts: ChaContact[] } }>(
    `/contacts/search?q=${encodeURIComponent(identifier)}&include_contacts=true`
  );

  // payload can be an array OR { contacts: [...] } depending on Chatwoot version
  const contacts = Array.isArray(search.payload)
    ? search.payload
    : (search.payload as { contacts?: ChaContact[] }).contacts ?? [];

  const existing = contacts.find((c) => c.identifier === identifier);
  if (existing) {
    console.log(`[chatwoot] Found existing contact id=${existing.id} for identifier=${identifier}`);
    if (email && !(existing as unknown as Record<string, unknown>).email) {
      await request(`/contacts/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ email }),
      }).catch(() => {});
    }
    return { ...existing, _alreadyExisted: true } as ChaContact & { _alreadyExisted?: boolean };
  }

  // Create new contact
  console.log(`[chatwoot] Creating contact for identifier=${identifier}`);
  const body: Record<string, unknown> = { identifier, name };
  if (email) body.email = email;
  let raw: unknown;
  try {
    raw = await request<unknown>("/contacts", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    if (email && String(e).includes("422")) {
      // Email already taken by another contact — create without email
      raw = await request<unknown>("/contacts", { method: "POST", body: JSON.stringify({ identifier, name }) });
    } else {
      throw e;
    }
  }

  const contact = normaliseContact(raw);
  console.log(`[chatwoot] Created contact id=${contact.id}`);

  if (!contact.id) {
    throw new Error(`Contact creation returned no id. Raw: ${JSON.stringify(raw)}`);
  }

  return contact;
}

export async function getOrCreateContactInbox(
  contactId: number,
  inboxId: number
): Promise<{ source_id: string }> {
  // List existing contact inboxes
  const data = await request<{ payload: { source_id: string; inbox: { id: number } }[] }>(
    `/contacts/${contactId}/contact_inboxes`
  );

  const list = Array.isArray(data.payload) ? data.payload : [];
  const existing = list.find((ci) => ci.inbox?.id === inboxId);
  if (existing) return existing;

  // Create new contact inbox
  const result = await request<{ source_id: string } | { payload: { source_id: string } }>(
    `/contacts/${contactId}/contact_inboxes`,
    {
      method: "POST",
      body: JSON.stringify({ inbox_id: inboxId }),
    }
  );

  // Unwrap payload if needed
  const r = result as Record<string, unknown>;
  if (r.payload && typeof r.payload === "object") {
    return r.payload as { source_id: string };
  }
  return result as { source_id: string };
}

// ── Conversations ─────────────────────────────────────────────────────────────

export interface ChaConversation {
  id: number;
  inbox_id: number;
  status: string;
  additional_attributes?: Record<string, unknown>;
}

export async function createConversation(
  inboxId: number,
  contactId: number,
  additionalAttributes: Record<string, unknown> = {},
  createdAt?: string
): Promise<ChaConversation> {
  const body: Record<string, unknown> = {
    inbox_id: inboxId,
    contact_id: contactId,
    additional_attributes: additionalAttributes,
  };
  if (createdAt) {
    body.created_at = Math.floor(new Date(createdAt).getTime() / 1000);
  }
  const raw = await request<unknown>(`/conversations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Handle possible payload wrapping
  const obj = raw as Record<string, unknown>;
  const conv = (obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload)
    ? obj.payload
    : obj) as ChaConversation;

  if (!conv.id) {
    throw new Error(`Conversation creation returned no id. Raw: ${JSON.stringify(raw)}`);
  }

  return conv;
}

export async function resolveConversation(conversationId: number): Promise<void> {
  await request(`/conversations/${conversationId}/toggle_status`, {
    method: "POST",
    body: JSON.stringify({ status: "resolved" }),
  });
}

export async function deleteConversation(conversationId: number): Promise<void> {
  const url = `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Chatwoot delete error ${res.status}: ${body}`);
  }
}

export async function listAllConversationIds(inboxId: number): Promise<number[]> {
  const ids: number[] = [];
  let page = 1;
  while (true) {
    const data = await request<{ data?: { meta?: unknown; payload?: unknown[] }; payload?: unknown[] }>(
      `/conversations?inbox_id=${inboxId}&page=${page}`
    );
    const items = (data as Record<string, unknown>).data
      ? ((data as Record<string, unknown>).data as Record<string, unknown>).payload as { id: number }[]
      : (data as Record<string, unknown>).payload as { id: number }[];
    if (!items || items.length === 0) break;
    ids.push(...items.map((c) => c.id));
    if (items.length < 25) break; // Chatwoot default page size is 25
    page++;
  }
  return ids;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function createMessage(
  conversationId: number,
  content: string,
  messageType: "incoming" | "outgoing",
  createdAt?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    content,
    message_type: messageType === "incoming" ? 0 : 1,
    private: false,
  };

  if (createdAt) {
    body.created_at = Math.floor(new Date(createdAt).getTime() / 1000);
    // Also store in content_attributes as fallback since Chatwoot cloud may ignore created_at
    body.content_attributes = { original_time: createdAt };
  }

  await request<{ id: number; message_type: number }>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
