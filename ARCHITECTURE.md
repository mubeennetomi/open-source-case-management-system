# Case Management System — Architecture & Flow Documentation

## Overview

This application bridges **Netomi AI chat widget** and **Chatwoot** to provide a unified agent inbox. When a user sends a message from the chat widget, both the user message and the bot response are forwarded to Chatwoot via webhooks. Agents monitor and respond to conversations through a custom dashboard.

**Stack:** Next.js (App Router), React, Tailwind CSS, Chatwoot API, Netomi API, WebSocket (ActionCable)

---

## System Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Chat Widget  │────▶│   Netomi AI Bot   │────▶│  This App   │
│  (End User)   │     │  (Processes msg)  │     │  (Next.js)  │
└──────────────┘     └──────────────────┘     └──────┬──────┘
                                                      │
                                              Webhook │ REST API
                                                      ▼
                                               ┌─────────────┐
                                               │   Chatwoot   │
                                               │  (CRM/Inbox) │
                                               └──────┬──────┘
                                                      │
                                              WebSocket│ (ActionCable)
                                                      ▼
                                               ┌─────────────┐
                                               │  Dashboard   │
                                               │  (Agent UI)  │
                                               └─────────────┘
```

---

## Core Flows

### 1. New User Message (Chat Widget → Chatwoot)

When a user sends a message from the Netomi chat widget:

```
User types message in chat widget
    ↓
Netomi forwards to POST /api/netomi/webhook
    Payload contains: conversationId, text, visitor_name, visitor_email, triggerType=REQUEST
    ↓
findOrCreateContact(identifier=conversationId, name, inboxId, email)
    ├─ Search Chatwoot contacts by identifier (= Netomi conversationId)
    ├─ If found → update name/email if needed, return existing contact
    └─ If not found → POST /api/v1/contacts → create new contact
    ↓
findOrCreateConversation(contact.id, inboxId, conversationId)
    ├─ GET contact's conversations in the inbox
    ├─ If conversation exists → return it
    └─ If not → POST /api/v1/conversations → create with netomi_conversation_id
    ↓
createMessage(conv.id, content, messageType="incoming")
    └─ POST /api/v1/conversations/{id}/messages
       message_type=0 (incoming), private=false
       content_attributes: { original_time, ownerType }
    ↓
Chatwoot stores message
    ↓
WebSocket pushes message.created event to dashboard
    ↓
Dashboard displays message in real-time
```

### 2. Bot Response (Netomi AI → Chatwoot)

When the Netomi bot generates a response:

```
Netomi AI generates response
    ↓
POST /api/netomi/webhook
    Payload contains: triggerType=RESPONSE, attachments (bot reply text)
    ↓
Same findOrCreateContact + findOrCreateConversation flow
    ↓
For each attachment in response:
    Extract text from attachment.attachment.text
    Strip HTML tags
    ↓
createMessage(conv.id, content, messageType="outgoing")
    └─ POST /api/v1/conversations/{id}/messages
       message_type=1 (outgoing), private=false
       content_attributes: { original_time, ownerType: "BOT" }
    ↓
WebSocket → Dashboard shows bot response (blue bubble, left side)
```

### 3. Handoff (Bot → Human Agent)

When the bot determines a human agent is needed:

```
Netomi sends handoff signal
    ↓
PUT /api/netomi/webhook
    Payload contains: conversationId from requestPayload
    ↓
findOrCreateContact + findOrCreateConversation (same flow)
    ↓
setCustomAttributes(conv.id, { handed_off: true })
    └─ POST /api/v1/conversations/{id}/custom_attributes
    ↓
WebSocket → conversation.updated event
    ↓
Dashboard detects handed_off=true
    ↓
"Reply" tab becomes visible (was hidden before handoff)
Agent can now respond to the customer
```

**Before handoff:** Agent can only add Private Notes
**After handoff:** Agent can send Replies (visible to customer) and Private Notes

### 4. Agent Sends Reply

```
Agent types reply in dashboard, clicks "Send Reply"
    ↓
POST /api/conversations/{id}/reply
    body: { content: "reply text" }
    ↓
Proxied to Chatwoot: POST /api/v1/conversations/{id}/messages
    message_type=1 (outgoing), private=false
    content_attributes: { sender: "agent" }
    ↓
WebSocket → message.created
    ↓
Dashboard updates with agent's reply
```

### 5. Agent Adds Private Note

```
Agent types note, clicks "Add Note"
    ↓
POST /api/conversations/{id}/notes
    body: { content: "note text" }
    ↓
Proxied to Chatwoot: POST /api/v1/conversations/{id}/messages
    message_type=1, private=true
    ↓
WebSocket → message.created
    ↓
Dashboard shows note with amber/yellow styling
(Not visible to customer)
```

### 6. Agent Assignment

```
Agent selects assignee from dropdown in right panel
    ↓
POST /api/conversations/{id}/assignments
    body: { assignee_id: agentId }
    ↓
Proxied to Chatwoot assignment endpoint
    ↓
Conversation now shows assigned agent
Tab counts update (Mine / Unassigned / All)
```

### 7. Conversation Status Change

```
Agent clicks "Resolve" or selects status from dropdown
    ↓
POST /api/conversations/{id}/status
    body: { status: "resolved" | "open" | "pending" | "snoozed" }
    ↓
Proxied to Chatwoot: POST /api/v1/conversations/{id}/toggle_status
    ↓
WebSocket → conversation.status_changed
    ↓
Dashboard updates status badge
```

---

## Contact & Conversation Creation Logic

### Contact Identification

- Each Netomi conversation has a unique `conversationId` (UUID)
- This UUID is used as the Chatwoot contact `identifier`
- One contact per Netomi conversation (1:1 mapping)

### Contact Creation Rules

```
1. Search Chatwoot by identifier
2. If found:
   - Update name if current is "Visitor #XXXX" and real name is now available
   - Update email if not previously set
   - Return existing contact
3. If not found:
   - Create with name, identifier, inbox_id, email
   - If 422 (email conflict) → retry without email
   - Return new contact
```

### Visitor Name Fallback

When no visitor name is provided:
```
conversationId = "d6ea64ab-1ee6-44a6-9409-83e82ad9d155"
hash = parseInt("d6ea64ab".replace(/-/g, ""), 16) % 9000 + 1000
name = "Visitor #4523"
```

### Conversation Creation

- One Chatwoot conversation per Netomi conversation per inbox
- `additional_attributes.netomi_conversation_id` links back to Netomi
- Metadata stored: device_info, platform, browser, started_at, ended_at

---

## Message Type Codes

| Code | Type | Description |
|------|------|-------------|
| 0 | incoming | User message (from chat widget) |
| 1 | outgoing | Bot response or agent reply |
| 2 | activity | System event (internal) |

### Distinguishing Bot vs Agent Messages

Both bot and agent messages have `message_type=1` (outgoing). They are distinguished by:
- `content_attributes.ownerType`: `"BOT"` for bot, `"AGENT"` for agent
- `content_attributes.sender`: `"agent"` for agent replies
- `private: true` for private notes

---

## Dashboard (Agent Inbox)

### Layout

```
┌────────────────────┬──────────────────────────┬──────────────────┐
│  Conversation List  │   Message Thread          │  Right Panel     │
│                    │                          │  (Conversation   │
│  Tabs:             │  Bot (left, blue)         │   Details)       │
│  Mine | Unassigned │  User (right, dark)       │                  │
│  | All             │  Agent (left, green)      │  Contact Info    │
│                    │  Notes (right, amber)     │  Participants    │
│  Search + Filter   │                          │  Previous Convs  │
│                    │  ─────────────────────   │  Labels          │
│                    │  Reply | Private Note     │  Actions         │
│                    │  [text input] [Send]      │                  │
└────────────────────┴──────────────────────────┴──────────────────┘
```

### Real-Time Updates (WebSocket)

The dashboard connects to Chatwoot's ActionCable WebSocket:

```
Connection: wss://app.chatwoot.com/cable
Channel: RoomChannel
Auth: pubsub_token + account_id + user_id (from /api/profile)
```

**Events handled:**
| Event | Action |
|-------|--------|
| `message.created` | Append message to current conversation |
| `message.updated` | Update existing message in-place |
| `conversation.created` | Add new conversation to list |
| `conversation.status_changed` | Update conversation status |
| `conversation.updated` | Update custom_attributes (handed_off flag) |

**Connection indicator:** Green dot = connected, Red dot = disconnected (next to "Agent Inbox" header)

### Agent Actions

| Action | Endpoint | Notes |
|--------|----------|-------|
| Send Reply | `POST /api/conversations/{id}/reply` | Only when handed_off=true |
| Add Note | `POST /api/conversations/{id}/notes` | Always available |
| Resolve | `POST /api/conversations/{id}/status` | Sets status to "resolved" |
| Assign Agent | `POST /api/conversations/{id}/assignments` | From agent dropdown |
| Add Label | `POST /api/conversations/{id}/labels` | Append to labels array |
| Remove Label | `POST /api/conversations/{id}/labels` | Filter from labels array |
| Edit Contact | `PUT /api/contacts/{id}` | Name, email, phone |
| Delete Contact | `DELETE /api/contacts/{id}` | Removes conversation |
| Block Contact | `POST /api/contacts/{id}/block` | Toggle block status |
| Email Transcript | `POST /api/conversations/{id}/transcript` | Sends to email address |
| Add Participant | `POST /api/conversations/{id}/participants` | Adds agent to conversation |

---

## Historical Sync

The home page (`/`) provides a sync tool to import historical Netomi conversations into Chatwoot.

```
Admin selects date range + optional botRefId
    ↓
POST /api/sync with { startTime, endTime, botRefId }
    ↓
Fetch conversation list from Netomi API
    ↓
For each conversation:
    ├─ Check if already synced (in-memory state)
    ├─ Fetch full webhook history from Netomi
    ├─ findOrCreateContact
    │   └─ If contact already existed → SKIP (dedup)
    ├─ createConversation with metadata
    ├─ createMessage for each message (in order)
    └─ Mark as synced
    ↓
Return { processed, skipped, failed }
```

**Deduplication:** If a contact already exists in Chatwoot (by identifier), the entire conversation is skipped to prevent duplicates.

---

## API Surface

### Webhook (External)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/netomi/webhook` | Receive user messages and bot responses |
| PUT | `/api/netomi/webhook` | Receive handoff notifications |

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List (with assignee_type filter) |
| GET | `/api/conversations/{id}` | Get details |
| POST | `/api/conversations/{id}/status` | Change status |
| POST | `/api/conversations/{id}/assignments` | Assign agent |
| POST | `/api/conversations/{id}/reply` | Send agent reply |
| POST | `/api/conversations/{id}/notes` | Add private note |
| GET/POST | `/api/conversations/{id}/labels` | Get/set labels |
| GET | `/api/conversations/{id}/messages` | Get all messages |
| GET/POST | `/api/conversations/{id}/participants` | Get/add participants |
| POST | `/api/conversations/{id}/transcript` | Email transcript |

### Contacts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contacts/{id}` | Get contact details |
| PUT | `/api/contacts/{id}` | Update contact |
| DELETE | `/api/contacts/{id}` | Delete contact |
| GET | `/api/contacts/{id}/conversations` | Contact's conversations |
| POST | `/api/contacts/{id}/block` | Block/unblock |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profile` | Current user profile (pubsub_token) |
| GET | `/api/agents` | List agents |
| GET | `/api/inboxes` | List inboxes |
| GET | `/api/health` | Health check |
| POST | `/api/sync` | Run historical sync |
| POST | `/api/reset` | Reset sync state |
| GET | `/api/state` | Get sync state |

---

## Environment Variables

| Variable | Description | Client-side |
|----------|-------------|-------------|
| `CHATWOOT_BASE_URL` | Chatwoot API base URL | No |
| `CHATWOOT_ACCOUNT_ID` | Chatwoot account ID | No |
| `CHATWOOT_API_TOKEN` | Chatwoot API access token | No |
| `CHATWOOT_INBOX_ID` | Chatwoot inbox ID | No |
| `NEXT_PUBLIC_CHATWOOT_BASE_URL` | Chatwoot base URL (client) | Yes |
| `NEXT_PUBLIC_CHATWOOT_ACCOUNT_ID` | Account ID (client) | Yes |
| `NEXT_PUBLIC_CHATWOOT_INBOX_ID` | Inbox ID (client) | Yes |
| `NEXT_PUBLIC_CHATWOOT_WS_URL` | WebSocket URL | Yes |
| `NETOMI_BASE_URL` | Netomi Studio URL | No |
| `NETOMI_COOKIE` | Auth cookie for Netomi API | No |
| `NETOMI_BOT_ID` | Bot identifier | No |
| `NETOMI_ORG_ID` | Organization ID | No |
| `NETOMI_USER_ID` | User ID for Netomi API | No |
| `NETOMI_CHANNEL` | Channel type (NETOMI_WEB_WIDGET) | No |
| `NETOMI_BOT_REF_ID` | Bot reference ID | No |
| `NETOMI_ENV` | Netomi environment (SANDBOX) | No |
| `CONFIG_HOST` | Config manager endpoint | No |
| `CONFIG_SERVICE_NAME` | Service name for config manager | No |
| `APP_ENV` | Application environment | No |
| `REGION` | Deployment region | No |

---

## Config Management

At container startup, `scripts/fetch-config.js` runs:
1. Fetches configuration from the config manager service
2. Writes values to `.env` file
3. Loads `.env` into `process.env` via `dotenv`
4. Starts the Next.js server

This allows environment-specific configuration without baking secrets into the Docker image.
