import { NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Toggle block via contact update
  const get = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}`, {
    headers: { api_access_token: TOKEN },
  });
  const contact = await get.json();
  const blocked = !contact.blocked;
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", api_access_token: TOKEN },
    body: JSON.stringify({ blocked }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
