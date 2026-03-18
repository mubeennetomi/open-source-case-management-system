import { NextResponse } from "next/server";

const BASE_URL = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
const API_TOKEN = process.env.CHATWOOT_API_TOKEN!;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${id}`,
    { headers: { api_access_token: API_TOKEN } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
