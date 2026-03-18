import { NextRequest, NextResponse } from "next/server";
import { findOrCreateContact, findOrCreateConversation, createMessage, setCustomAttributes } from "@/lib/chatwoot";

const INBOX_ID = parseInt(process.env.CHATWOOT_INBOX_ID || "0");

function getCustomAttr(attrs: Array<{ name: string; value?: string | null }>, name: string): string | undefined {
  const val = attrs.find(a => a.name === name)?.value;
  return val ? val.trim() || undefined : undefined;
}

function fallbackName(conversationId: string): string {
  const num = parseInt(conversationId.replace(/-/g, "").substring(0, 8), 16) % 9000 + 1000;
  return `Visitor #${num}`;
}

function extractAttrs(obj: Record<string, unknown> | undefined) {
  const customAttrs = obj?.additionalAttributes as Record<string, unknown> | undefined;
  return (Array.isArray(customAttrs?.CUSTOM_ATTRIBUTES) ? customAttrs!.CUSTOM_ATTRIBUTES : []) as Array<{ name: string; value?: string | null }>;
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json() as Record<string, unknown>;

    // Unwrap { body: {...} } wrapper if present — Netomi sends bot responses this way
    const payload = (raw.body && typeof raw.body === "object" && !Array.isArray(raw.body))
      ? raw.body as Record<string, unknown>
      : raw;

    console.log(`[webhook] triggerType=${payload.triggerType} keys=${Object.keys(payload).join(",")}`);

    const triggerType = payload.triggerType as string | undefined;

    let conversationId: string;
    let content: string | null = null;
    let messageType: "incoming" | "outgoing" = "incoming";
    let timestampMs: number = Date.now();
    let visitorNameStr: string | undefined;
    let email: string | undefined;
    const ownerType = payload.ownerType as string | undefined;

    if (triggerType === "RESPONSE") {
      // ── Bot response ───────────────────────────────────────────────────────
      const reqPayload = payload.requestPayload as Record<string, unknown> | undefined;
      conversationId = (reqPayload?.conversationId ?? payload.conversationId) as string;
      timestampMs = (payload.timestamp as number) || Date.now();

      const attachments = (payload.attachments ?? []) as Array<{
        attachment?: { text?: string; attachmentResponseType?: string };
      }>;
      const textParts = attachments
        .map(a => a.attachment?.text?.replace(/<[^>]*>/g, "").trim())
        .filter((t): t is string => !!t);

      console.log(`[webhook] RESPONSE attachments=${attachments.length} textParts=${textParts.length}`);
      if (textParts.length === 0) return NextResponse.json({ ok: true });

      content = textParts.join("\n\n");
      messageType = "outgoing";

      const attrs = extractAttrs(reqPayload);
      visitorNameStr = getCustomAttr(attrs, "visitor_name");
      email = getCustomAttr(attrs, "visitor_email");

    } else {
      // ── User message (REQUEST or no triggerType) ───────────────────────────
      conversationId = payload.conversationId as string;
      const msgPayload = payload.messagePayload as Record<string, unknown> | undefined;
      content = (msgPayload?.text as string | undefined)?.trim() ?? null;
      if (!content) {
        console.log(`[webhook] Skipping — no message text`);
        return NextResponse.json({ ok: true });
      }
      messageType = "incoming";
      timestampMs = (msgPayload?.timestamp as number) || Date.now();

      const attrs = extractAttrs(payload);
      visitorNameStr = getCustomAttr(attrs, "visitor_name");
      email = getCustomAttr(attrs, "visitor_email");
    }

    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
    }

    const name = visitorNameStr || fallbackName(conversationId);
    const isoTime = new Date(timestampMs).toISOString();

    const contact = await findOrCreateContact(conversationId, name, INBOX_ID, email);
    const conv = await findOrCreateConversation(contact.id, INBOX_ID, conversationId);
    console.log(`[webhook] creating message in conv=${conv.id} (${conversationId}) with content="${content.substring(0, 60)}" at ${isoTime}`);
    await createMessage(conv.id, content!, messageType, isoTime, ownerType);

    console.log(`[webhook] ${messageType} → conv=${conv.id} (${conversationId}): "${content!.substring(0, 60)}"`);
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const raw = await req.json() as Record<string, unknown>;

    const payload = (raw.body && typeof raw.body === "object" && !Array.isArray(raw.body))
      ? raw.body as Record<string, unknown>
      : raw;

    const reqPayload = payload.requestPayload as Record<string, unknown> | undefined;
    const conversationId = (reqPayload?.conversationId ?? payload.conversationId) as string | undefined;

    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
    }

    const attrs = extractAttrs(reqPayload ?? payload);
    const visitorNameStr = getCustomAttr(attrs, "visitor_name");
    const email = getCustomAttr(attrs, "visitor_email");
    const name = visitorNameStr || fallbackName(conversationId);

    const contact = await findOrCreateContact(conversationId, name, INBOX_ID, email);
    const conv = await findOrCreateConversation(contact.id, INBOX_ID, conversationId);

    await setCustomAttributes(conv.id, { handed_off: true });

    console.log(`[webhook:handoff] Set handed_off=true on conv=${conv.id} (${conversationId})`);
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[webhook:handoff] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
