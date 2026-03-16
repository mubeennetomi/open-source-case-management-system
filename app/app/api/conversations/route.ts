import { NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
const INBOX_ID = process.env.CHATWOOT_INBOX_ID!;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") || "1";
  const assigneeType = searchParams.get("assignee_type") || "all";
  const url = `${BASE}/api/v1/accounts/${ACCOUNT}/conversations?inbox_id=${INBOX_ID}&page=${page}&assignee_type=${assigneeType}`;
  const res = await fetch(url, { headers: { api_access_token: TOKEN } });
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });
  return NextResponse.json(await res.json());
}
