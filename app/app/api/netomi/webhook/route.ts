import { NextRequest, NextResponse } from "next/server";
import { findOrCreateContact, findOrCreateConversation, createMessage } from "@/lib/chatwoot";

const INBOX_ID = parseInt(process.env.CHATWOOT_INBOX_ID || "0");

function getCustomAttr(attrs: Array<{ name: string; value?: string | null }>, name: string): string | undefined {
  const val = attrs.find(a => a.name === name)?.value;
  return val ? val.trim() || undefined : undefined;
}

function fallbackName(conversationId: string): string {
  const num = parseInt(conversationId.replace(/-/g, "").substring(0, 8), 16) % 9000 + 1000;
  return `Visitor #${num}`;
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json() as Record<string, unknown>;

    // ── Detect payload shape ─────────────────────────────────────────────────
    // User message:  flat root  { conversationId, messagePayload, additionalAttributes, ... }
    // Bot response:  wrapped    { body: { triggerType:"RESPONSE", requestPayload: { conversationId, ... }, attachments, timestamp } }

    const isWrapped = !!raw.body;
    const body = (isWrapped ? raw.body : raw) as Record<string, unknown>;

    let conversationId: string;
    let content: string | null = null;
    let messageType: "incoming" | "outgoing" = "incoming";
    let timestampMs: number = Date.now();
    let visitorNameStr: string | undefined;
    let email: string | undefined;

    if (!isWrapped) {
      // ── User message ───────────────────────────────────────────────────────
      conversationId = body.conversationId as string;
      const msgPayload = body.messagePayload as Record<string, unknown> | undefined;
      content = (msgPayload?.text as string | undefined)?.trim() ?? null;
      if (!content) return NextResponse.json({ ok: true });
      messageType = "incoming";
      timestampMs = (msgPayload?.timestamp as number) || Date.now();

      const customAttrs = (body.additionalAttributes as Record<string, unknown> | undefined);
      const attrs = (Array.isArray(customAttrs?.CUSTOM_ATTRIBUTES) ? customAttrs!.CUSTOM_ATTRIBUTES : []) as Array<{ name: string; value?: string | null }>;
      visitorNameStr = getCustomAttr(attrs, "visitor_name");
      email = getCustomAttr(attrs, "visitor_email");

    } else {
      // ── Bot response ───────────────────────────────────────────────────────
      const reqPayload = body.requestPayload as Record<string, unknown>;
      conversationId = reqPayload?.conversationId as string;
      timestampMs = (body.timestamp as number) || Date.now();

      const attachments = (body.attachments ?? []) as Array<{
        attachment?: { text?: string; attachmentResponseType?: string };
      }>;
      const textParts = attachments
        .filter(a => a.attachment?.text?.trim() && a.attachment.attachmentResponseType === "ANSWER_AI_RESPONSE")
        .map(a => a.attachment!.text!.trim());

      if (textParts.length === 0) return NextResponse.json({ ok: true });
      content = textParts.join("\n\n");
      messageType = "outgoing";

      // Extract visitor info from requestPayload.additionalAttributes
      const customAttrs2 = (reqPayload?.additionalAttributes as Record<string, unknown> | undefined);
      const attrs = (Array.isArray(customAttrs2?.CUSTOM_ATTRIBUTES) ? customAttrs2!.CUSTOM_ATTRIBUTES : []) as Array<{ name: string; value?: string | null }>;
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
    await createMessage(conv.id, content!, messageType, isoTime);

    console.log(`[webhook] ${messageType} → Chatwoot conv=${conv.id} (${conversationId}): "${content!.substring(0, 60)}"`);
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
