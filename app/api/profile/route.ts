import { NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
export async function GET() {
  const res = await fetch(`${BASE}/auth/sign_in`, { method: "GET" });
  // Use agents list + token lookup instead
  const r2 = await fetch(`${BASE}/api/v1/profile`, { headers: { api_access_token: TOKEN } });
  return NextResponse.json(await r2.json(), { status: r2.status });
}
