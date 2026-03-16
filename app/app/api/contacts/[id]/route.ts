import { NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
const h = { "Content-Type": "application/json", api_access_token: TOKEN };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}`, {
    method: "PUT", headers: h, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}/contacts/${id}`, {
    method: "DELETE", headers: h,
  });
  return NextResponse.json({ ok: res.ok }, { status: res.status });
}
