export interface NetomiConversationSummary {
  conversationId: string;
  isComplete: boolean;
  startTime: string;
  endTime: string;
  isGoal: boolean;
  platform?: string;
  deviceType?: string;
  browserInfo?: string;
  dropped: boolean;
  deviceInfo: string;
}

export interface NetomiMessage {
  type: string;
  message: string;
  time: string;
  id?: string;
  locale?: string | null;
  generatedBy?: string | null;
  rephrasedQuery?: string | null;
  customerFeedback?: string | null;
}

export interface NetomiConversationListResponse {
  statusCode: string;
  payload: {
    page: number;
    totalPages: number;
    totalCount: number;
    conversationList: NetomiConversationSummary[];
  };
}

export interface NetomiConversationLogsResponse {
  statusCode: string;
  payload: NetomiMessage[];
}

function buildHeaders() {
  const cookie = process.env.NETOMI_COOKIE;
  const botId = process.env.NETOMI_BOT_ID;
  const orgId = process.env.NETOMI_ORG_ID;
  const userId = process.env.NETOMI_USER_ID;
  const channel = process.env.NETOMI_CHANNEL;

  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-bot-id": botId!,
    "x-channel": channel!,
    "x-org-id": orgId!,
    "x-user-id": userId!,
    Cookie: cookie!,
  };
}

export async function fetchConversationList(
  startTime: string,
  endTime: string,
  pageNumber = 1,
  pageSize = 100,
  botRefIdOverride?: string
): Promise<NetomiConversationListResponse> {
  const baseUrl = process.env.NETOMI_BASE_URL;
  const botRefId = botRefIdOverride || process.env.NETOMI_BOT_REF_ID;
  const env = process.env.NETOMI_ENV;

  const response = await fetch(
    `${baseUrl}/api/conversation-viewer/getConversationList`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        filters: {
          dropoff: false,
          handoff: false,
          deflected: false,
          goals: false,
          labelValue: "",
          label: false,
          searchText: "",
          conversationId: "",
          additionalFilters: [],
          respond: false,
          review: false,
          isExactMatch: true,
          startTime,
          endTime,
          env,
          timeZone: "Asia/Kolkata",
          botRefId,
          channelType: "CHAT",
          pageNumber,
          pageSize,
          enableOpenSearch: true,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Netomi API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAllConversations(
  startTime: string,
  endTime: string,
  botRefIdOverride?: string
): Promise<NetomiConversationSummary[]> {
  const firstPage = await fetchConversationList(startTime, endTime, 1, 100, botRefIdOverride);
  const { totalPages, conversationList } = firstPage.payload;

  if (totalPages <= 1) return conversationList;

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      fetchConversationList(startTime, endTime, i + 2, 100, botRefIdOverride)
    )
  );

  return [
    ...conversationList,
    ...remainingPages.flatMap((r) => r.payload.conversationList),
  ];
}

export interface ParsedWebhookMessage {
  content: string;
  type: "incoming" | "outgoing";
  timestampMs: number;
}

export interface WebhookVisitorInfo {
  name?: string;
  email?: string;
}

export async function fetchWebhookHistory(
  conversationId: string,
  botRefIdOverride?: string
): Promise<{ messages: ParsedWebhookMessage[]; visitorInfo: WebhookVisitorInfo }> {
  const botRefId = botRefIdOverride || process.env.NETOMI_BOT_REF_ID;

  const response = await fetch("https://chatapps-us.netomi.com/api/v3/webhook-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      requestBody: { numberOfMessages: 500, numberOfDays: 30 },
      botRefId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook history API error: ${response.status}`);
  }

  const data = await response.json() as { conversationId: string; responses?: Array<Record<string, unknown>> };
  const messages: ParsedWebhookMessage[] = [];
  const visitorInfo: WebhookVisitorInfo = {};

  for (const entry of data.responses ?? []) {
    const triggerType = entry.triggerType as string;
    const timestamp = entry.timestamp as number;

    if (triggerType === "REQUEST") {
      const reqPayload = entry.requestPayload as Record<string, unknown> | undefined;
      const text = ((reqPayload?.messagePayload as Record<string, unknown>)?.text as string | undefined)?.trim();
      if (!text) continue;

      // Extract visitor info from custom attributes (first occurrence)
      if (!visitorInfo.name && reqPayload?.additionalAttributes) {
        const attrs = ((reqPayload.additionalAttributes as Record<string, unknown>).CUSTOM_ATTRIBUTES ?? []) as Array<{ name: string; value?: string }>;
        visitorInfo.name = attrs.find(a => a.name === "visitor_name")?.value;
        visitorInfo.email = attrs.find(a => a.name === "visitor_email")?.value;
      }

      messages.push({ content: text, type: "incoming", timestampMs: timestamp });
    } else if (triggerType === "RESPONSE") {
      const attachments = (entry.attachments ?? []) as Array<{ attachment?: { text?: string; attachmentResponseType?: string } }>;
      const textParts = attachments
        .filter(a => a.attachment?.text?.trim() && a.attachment.attachmentResponseType === "ANSWER_AI_RESPONSE")
        .map(a => a.attachment!.text!.trim());
      if (textParts.length === 0) continue;
      messages.push({ content: textParts.join("\n\n"), type: "outgoing", timestampMs: timestamp });
    }
  }

  messages.sort((a, b) => a.timestampMs - b.timestampMs);
  console.log(`[netomi] webhook-history for ${conversationId}: fetched ${messages.length} messages, visitor=${visitorInfo.name ?? "unknown"}`);
  return { messages, visitorInfo };
}
