import { NextResponse } from "next/server";

const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;

export async function GET() {
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/agents`, {
    headers: { api_access_token: TOKEN },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
