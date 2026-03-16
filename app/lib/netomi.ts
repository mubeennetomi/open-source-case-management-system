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
  pageSize = 100
): Promise<NetomiConversationListResponse> {
  const baseUrl = process.env.NETOMI_BASE_URL;
  const botRefId = process.env.NETOMI_BOT_REF_ID;
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
  endTime: string
): Promise<NetomiConversationSummary[]> {
  const firstPage = await fetchConversationList(startTime, endTime, 1, 100);
  const { totalPages, conversationList } = firstPage.payload;

  if (totalPages <= 1) return conversationList;

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      fetchConversationList(startTime, endTime, i + 2, 100)
    )
  );

  return [
    ...conversationList,
    ...remainingPages.flatMap((r) => r.payload.conversationList),
  ];
}

export async function fetchConversationLogs(
  conversationId: string,
  startTime: string,
  endTime: string
): Promise<NetomiMessage[]> {
  const baseUrl = process.env.NETOMI_BASE_URL;
  const botRefId = process.env.NETOMI_BOT_REF_ID;
  const env = process.env.NETOMI_ENV;

  const response = await fetch(
    `${baseUrl}/api/conversation-viewer/getConversationLogs`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        filters: {
          conversationId,
          startTime,
          endTime,
          env,
          timeZone: "Asia/Kolkata",
          botRefId,
          channelType: "CHAT",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Netomi logs API error: ${response.status}`);
  }

  const data: NetomiConversationLogsResponse = await response.json();
  return data.payload;
}
