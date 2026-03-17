import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const url = `${BASE}/api/v1/accounts/${ACCOUNT}/conversations/filter?page=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", api_access_token: TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
  return NextResponse.json(await res.json());
}
