import { NextResponse } from "next/server";

const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { content } = await req.json();
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/conversations/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", api_access_token: TOKEN },
    body: JSON.stringify({ content, message_type: 1, private: false, content_attributes: { sender: "agent" } }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
