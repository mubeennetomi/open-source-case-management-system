"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

interface SyncState {
  syncedConversationIds: string[];
  lastSyncAt: string | null;
  totalSynced: number;
}

interface SyncResult {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  done: boolean;
  duration_ms: number;
  errors: string[];
}

interface Inbox {
  id: number;
  name: string;
  channel_type: string;
}

export default function Home() {
  const [state, setState] = useState<SyncState | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/state");
    if (res.ok) setState(await res.json());
  }, []);

  const loadInboxes = useCallback(async () => {
    const res = await fetch("/api/inboxes");
    if (res.ok) {
      const data = await res.json();
      setInboxes(data.payload || []);
    }
  }, []);

  useEffect(() => {
    loadState();
    loadInboxes();
  }, [loadState, loadInboxes]);

  async function runSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: `${startDate}T00:00:00.000Z`,
          endTime: `${endDate}T23:59:59.999Z`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Sync failed");
      } else {
        setResult(data);
        toast.success(`Sync complete: ${data.processed} conversations synced`);
        await loadState();
      }
    } catch {
      toast.error("Network error during sync");
    } finally {
      setSyncing(false);
    }
  }

  async function resetSync() {
    if (!confirm("Reset sync state? This will re-sync all conversations on next run.")) return;
    await fetch("/api/reset", { method: "POST" });
    toast.info("Sync state reset");
    await loadState();
    setResult(null);
  }

  const inboxConfigured = Boolean(
    process.env.NEXT_PUBLIC_CHATWOOT_INBOX_ID &&
      process.env.NEXT_PUBLIC_CHATWOOT_INBOX_ID !== "" &&
      process.env.NEXT_PUBLIC_CHATWOOT_INBOX_ID !== "0"
  );

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors />

      {/* Header */}
      <div className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Netomi ↔ Chatwoot Sync</h1>
            <p className="text-sm text-muted-foreground">
              Mirror Netomi conversations into Chatwoot for agent monitoring
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={inboxConfigured ? "default" : "destructive"}>
              {inboxConfigured ? "Inbox configured" : "Inbox not set"}
            </Badge>
            <Link
              href="/monitor"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Open Monitor View →
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Tabs defaultValue="sync">
          <TabsList>
            <TabsTrigger value="sync">Sync</TabsTrigger>
            <TabsTrigger value="inboxes">Chatwoot Inboxes</TabsTrigger>
            <TabsTrigger value="setup">Setup Guide</TabsTrigger>
          </TabsList>

          {/* ── SYNC TAB ──────────────────────────────────────── */}
          <TabsContent value="sync" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Synced</CardDescription>
                  <CardTitle className="text-3xl">{state?.totalSynced ?? "—"}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Last Sync</CardDescription>
                  <CardTitle className="text-sm font-medium">
                    {state?.lastSyncAt
                      ? new Date(state.lastSyncAt).toLocaleString()
                      : "Never"}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Status</CardDescription>
                  <CardTitle>
                    <Badge variant={syncing ? "secondary" : "outline"}>
                      {syncing ? "Syncing..." : "Idle"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Date Range</CardTitle>
                <CardDescription>
                  Fetch Netomi conversations within this window
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  />
                </div>
                <Button onClick={runSync} disabled={syncing} className="min-w-28">
                  {syncing ? "Syncing..." : "Run Sync"}
                </Button>
                <Button variant="outline" onClick={resetSync} disabled={syncing}>
                  Reset State
                </Button>
              </CardContent>
            </Card>

            {!inboxConfigured && (
              <div className="rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950 p-4 text-sm">
                <strong>Action required:</strong> Set <code>CHATWOOT_INBOX_ID</code> and{" "}
                <code>NEXT_PUBLIC_CHATWOOT_INBOX_ID</code> in <code>.env.local</code>. Go to
                the <strong>Chatwoot Inboxes</strong> tab to find the inbox ID, then restart
                the dev server.
              </div>
            )}

            {syncing && (
              <Card>
                <CardContent className="pt-6 space-y-2">
                  <p className="text-sm text-muted-foreground">Sync in progress — this may take a minute...</p>
                  <Progress className="h-2" value={null} />
                </CardContent>
              </Card>
            )}

            {result && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Last Run Result</CardTitle>
                  <CardDescription>
                    Completed in {(result.duration_ms / 1000).toFixed(1)}s
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-green-600">{result.processed}</p>
                      <p className="text-xs text-muted-foreground">Synced</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped (already synced)</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-red-600">Errors</p>
                        {result.errors.map((e, i) => (
                          <p key={i} className="text-xs font-mono text-muted-foreground break-all">
                            {e}
                          </p>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── INBOXES TAB ───────────────────────────────────── */}
          <TabsContent value="inboxes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Chatwoot Inboxes</CardTitle>
                <CardDescription>
                  Copy the ID of your API inbox and set it as{" "}
                  <code>CHATWOOT_INBOX_ID</code> in <code>.env.local</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {inboxes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No inboxes found — or Chatwoot API token may be invalid.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">ID</th>
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2">Channel Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboxes.map((inbox) => (
                        <tr key={inbox.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono font-bold">{inbox.id}</td>
                          <td className="py-2 pr-4">{inbox.name}</td>
                          <td className="py-2">
                            <Badge
                              variant={
                                inbox.channel_type === "Channel::Api" ? "default" : "secondary"
                              }
                            >
                              {inbox.channel_type}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SETUP TAB ─────────────────────────────────────── */}
          <TabsContent value="setup" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Setup Guide</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <Step n={1} title="Create an API Inbox in Chatwoot">
                  Go to <strong>Settings → Inboxes → Add Inbox</strong> and select{" "}
                  <strong>API</strong>. Name it <em>&quot;Netomi Bot Conversations&quot;</em>.
                  Assign agents and save.
                </Step>
                <Separator />
                <Step n={2} title="Set CHATWOOT_INBOX_ID">
                  From the <strong>Inboxes</strong> tab above, copy the numeric ID. Open{" "}
                  <code>.env.local</code> and set both:
                  <pre className="mt-2 rounded bg-muted p-2 font-mono text-xs">
                    CHATWOOT_INBOX_ID=&lt;id&gt;{"\n"}NEXT_PUBLIC_CHATWOOT_INBOX_ID=&lt;id&gt;
                  </pre>
                  Restart the dev server.
                </Step>
                <Separator />
                <Step n={3} title="Update Netomi Token (when it expires)">
                  The Netomi JWT expires periodically. When sync fails with a 401, log in to{" "}
                  <strong>studio.netomi.com</strong>, open DevTools → Application →{" "}
                  Cookies, copy the <code>access-token</code> value, and update{" "}
                  <code>NETOMI_ACCESS_TOKEN</code> in <code>.env.local</code>.
                </Step>
                <Separator />
                <Step n={4} title="Run Sync">
                  Go to the <strong>Sync</strong> tab, pick a date range, and click{" "}
                  <strong>Run Sync</strong>. Already-synced conversations are skipped
                  automatically.
                </Step>
                <Separator />
                <Step n={5} title="Agents work in Chatwoot">
                  Agents can view all Netomi conversations in Chatwoot, add labels, assign
                  conversations, and write private notes. Completed Netomi conversations are
                  automatically marked as resolved.
                </Step>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {n}
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
