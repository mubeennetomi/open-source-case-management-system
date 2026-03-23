import { NextRequest, NextResponse } from "next/server";
const BASE = process.env.CHATWOOT_BASE_URL!;
const TOKEN = process.env.CHATWOOT_API_TOKEN!;
export async function GET() {
  const r2 = await fetch(`${BASE}/api/v1/profile`, { headers: { api_access_token: TOKEN } });
  return NextResponse.json(await r2.json(), { status: r2.status });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
  // First get the agent's profile to obtain id and role
  const profileRes = await fetch(`${BASE}/api/v1/profile`, { headers: { api_access_token: TOKEN } });
  const profile = await profileRes.json();
  const agentId = profile.id;
  const role = profile.role || "agent";
  // Map dashboard values to Chatwoot API values
  const statusMap: Record<string, string> = { online: "available", busy: "busy", offline: "offline" };
  const r2 = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT_ID}/agents/${agentId}`, {
    method: "PATCH",
    headers: { api_access_token: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      role,
      availability_status: statusMap[body.availability] ?? body.availability,
    }),
  });
  return NextResponse.json(await r2.json(), { status: r2.status });
}
