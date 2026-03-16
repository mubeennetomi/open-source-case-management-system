import { NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}/conversations`, {
    headers: { api_access_token: TOKEN },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
