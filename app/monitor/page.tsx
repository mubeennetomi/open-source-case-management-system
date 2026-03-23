"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatwootWebSocket } from "@/lib/useChatwootWebSocket";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Conversation {
  id: number; status: string; created_at: number; labels: string[];
  assignee?: Agent | null;
  additional_attributes?: { started_at?: string; ended_at?: string; netomi_conversation_id?: string };
  meta: { sender: { id: number; name: string; identifier: string }; channel: string };
}
interface Message {
  id: number; content: string; message_type: number;
  created_at: number; private: boolean; sender?: { name: string; type: string };
  content_attributes?: { original_time?: string; sender?: string };
}
interface Agent { id: number; name: string; email: string; }
interface Profile { id: number; name: string; email: string; pubsub_token?: string; account_id?: number; availability?: string; }

type Tab = "all" | "assigned" | "unassigned";

// ── Filter types ───────────────────────────────────────────────────────────────
const FILTER_ATTRIBUTES = [
  { key: "status",            label: "Status",                  type: "select",   options: ["open","resolved","pending","snoozed"] },
  { key: "priority",          label: "Priority",                type: "select",   options: ["none","low","medium","high","urgent"] },
  { key: "assignee_id",       label: "Assignee",                type: "agent" },
  { key: "inbox_id",          label: "Inbox",                   type: "text" },
  { key: "team_id",           label: "Team",                    type: "text" },
  { key: "id",                label: "Conversation Identifier", type: "text" },
  { key: "campaign_id",       label: "Campaign",                type: "text" },
  { key: "labels",            label: "Labels",                  type: "text" },
  { key: "browser_language",  label: "Browser Language",        type: "text" },
  { key: "referer",           label: "Referer Link",            type: "text" },
  { key: "created_at",        label: "Created At",              type: "date" },
  { key: "last_activity_at",  label: "Last Activity",           type: "date" },
] as const;

const OPERATORS_FOR: Record<string, { key: string; label: string }[]> = {
  select: [{ key: "equal_to", label: "Equal to" }, { key: "not_equal_to", label: "Not equal to" }],
  agent:  [{ key: "equal_to", label: "Equal to" }, { key: "not_equal_to", label: "Not equal to" }],
  text:   [{ key: "equal_to", label: "Equal to" }, { key: "not_equal_to", label: "Not equal to" }, { key: "contains", label: "Contains" }, { key: "does_not_contain", label: "Does not contain" }, { key: "is_present", label: "Is present" }, { key: "is_not_present", label: "Is not present" }],
  date:   [{ key: "is_greater_than", label: "After" }, { key: "is_less_than", label: "Before" }, { key: "days_before", label: "Days before" }],
};

interface FilterRow { attribute: string; operator: string; value: string; }
function defaultRow(): FilterRow { return { attribute: "status", operator: "equal_to", value: "open" }; }

const AVATAR_COLORS = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-indigo-100 text-indigo-700",
  "bg-cyan-100 text-cyan-700",
  "bg-rose-100 text-rose-700",
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtMsg(msg: Message) {
  const orig = msg.content_attributes?.original_time;
  if (orig) return new Date(orig).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return fmt(msg.created_at);
}
function fmtConv(conv: Conversation) {
  const orig = conv.additional_attributes?.started_at;
  if (orig) return new Date(orig).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return fmt(conv.created_at);
}
function initials(name: string) {
  return (name || "V").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MonitorPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [participants, setParticipants] = useState<Agent[]>([]);
  const [prevConvs, setPrevConvs] = useState<Conversation[]>([]);
  const [contactDetail, setContactDetail] = useState<{ email?: string; phone_number?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [tabCounts, setTabCounts] = useState({ all: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [inputTab, setInputTab] = useState<"note" | "reply">("reply");
  const [handedOff, setHandedOff] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [transcriptEmail, setTranscriptEmail] = useState("");
  // Modals
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [participantAgentId, setParticipantAgentId] = useState("");
  // Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterRows, setFilterRows] = useState<FilterRow[]>([defaultRow()]);
  const [activeFilters, setActiveFilters] = useState<FilterRow[] | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      if (messagesScrollRef.current) {
        messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
      }
    }, 60);
  }

  // Load profile
  useEffect(() => {
    fetch("/api/profile").then(r => r.json()).then(data => {
      const acct = data.accounts?.find((a: any) => a.id === data.account_id);
      setProfile({ ...data, availability: acct?.availability_status ?? acct?.availability ?? "offline" });
    });
    fetch("/api/agents").then(r => r.json()).then(setAgents);
  }, []);

  // Load conversations for tab
  const loadConvs = useCallback((t: Tab, filters: FilterRow[] | null = null) => {
    setLoading(true);
    if (filters && filters.length > 0) {
      const payload = filters.map((f, i) => {
        const attr = FILTER_ATTRIBUTES.find(a => a.key === f.attribute);
        const noValue = ["is_present","is_not_present"].includes(f.operator);
        let values: (string | number)[] = noValue ? [] : [f.value];
        // numeric fields
        if (["assignee_id","inbox_id","team_id","id","campaign_id"].includes(f.attribute) && !noValue) {
          values = [Number(f.value)];
        }
        return {
          attribute_key: f.attribute,
          filter_operator: f.operator,
          values,
          query_operator: i < filters.length - 1 ? "AND" : null,
          ...(attr?.type === "date" ? {} : {}),
        };
      });
      fetch("/api/conversations/filter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      }).then(r => r.json()).then(data => {
        const list: Conversation[] = (data?.data?.payload ?? data?.payload ?? []).map((c: any) => ({
          ...c,
          assignee: c.assignee ?? (c.meta?.assignee ? { id: c.meta.assignee.id, name: c.meta.assignee.name, email: c.meta.assignee.email ?? "" } : null),
        }));
        setConversations(list);
        if (list.length > 0) setSelected(s => s ?? list[0]);
      }).finally(() => setLoading(false));
    } else {
      const at = t === "all" ? "all" : t === "assigned" ? "me" : "unassigned";
      fetch(`/api/conversations?assignee_type=${at}`)
        .then(r => r.json())
        .then(data => {
          const list: Conversation[] = (data?.data?.payload ?? []).map((c: any) => ({
            ...c,
            assignee: c.assignee ?? (c.meta?.assignee ? { id: c.meta.assignee.id, name: c.meta.assignee.name, email: c.meta.assignee.email ?? "" } : null),
          }));
          setConversations(list);
          if (list.length > 0) setSelected(s => s ?? list[0]);
        })
        .finally(() => setLoading(false));
    }
  }, []);

  // Load tab counts from a single API call (meta contains all counts)
  useEffect(() => {
    fetch("/api/conversations?assignee_type=all").then(r => r.json()).then(data => {
      const meta = data?.data?.meta ?? {};
      setTabCounts({
        all: meta.all_count ?? 0,
        assigned: meta.mine_count ?? 0,
        unassigned: meta.unassigned_count ?? 0,
      });
    });
  }, []);

  useEffect(() => { loadConvs(tab, activeFilters); }, [tab, activeFilters, loadConvs]);

  // Load messages
  useEffect(() => {
    if (!selected) return;
    setContactDetail(null);
    setLoadingMsgs(true);
    setHandedOff(false);
    setInputTab("note");
    // Fetch conversation detail for handed_off status
    fetch(`/api/conversations/${selected.id}`)
      .then(r => r.json())
      .then(data => {
        const ho = data?.custom_attributes?.handed_off === true;
        console.log(`[init] conversation=${selected.id} custom_attributes.handed_off=${ho}`);
        setHandedOff(ho);
        if (ho) setInputTab("reply");
      })
      .catch(() => {});
    fetch(`/api/conversations/${selected.id}/messages`)
      .then(r => r.json())
      .then(data => {
        setMessages((data?.payload ?? []).sort((a: Message, b: Message) => a.created_at - b.created_at));
        const assignee = data?.meta?.assignee;
        if (assignee && assignee.id !== selected.assignee?.id) {
          const a = { id: assignee.id, name: assignee.name, email: assignee.email ?? "" };
          setSelected(prev => prev?.id === selected.id ? { ...prev, assignee: a } : prev);
          setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, assignee: a } : c));
        }
      })
      .finally(() => { setLoadingMsgs(false); scrollToBottom(); });
    fetch(`/api/conversations/${selected.id}/participants`)
      .then(r => r.json())
      .then(data => setParticipants(data?.payload ?? []));
    if (selected.meta?.sender?.id) {
      fetch(`/api/contacts/${selected.meta.sender.id}`)
        .then(r => r.json())
        .then(data => {
          const c = data?.email !== undefined ? data : (data?.payload ?? data);
          setContactDetail({ email: c?.email || undefined, phone_number: c?.phone_number || undefined });
        });
      fetch(`/api/contacts/${selected.meta.sender.id}/conversations`)
        .then(r => r.json())
        .then(data => {
          const all: Conversation[] = data?.payload?.conversations ?? [];
          setPrevConvs(all.filter(c => c.id !== selected.id));
        });
    }
  }, [selected?.id]);

  // WebSocket: real-time updates from Chatwoot
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const { connected: wsConnected } = useChatwootWebSocket(
    profile?.pubsub_token ?? null,
    profile?.account_id ?? null,
    profile?.id ?? null,
    process.env.NEXT_PUBLIC_CHATWOOT_WS_URL ?? "wss://app.chatwoot.com/cable",
    {
      onMessageCreated: (data: any) => {
        if (data.conversation_id !== selectedRef.current?.id) return;
        setMessages(prev => {
          if (prev.some(m => m.id === data.id)) return prev;
          scrollToBottom();
          return [...prev, data].sort((a, b) => a.created_at - b.created_at);
        });
      },
      onMessageUpdated: (data: any) => {
        if (data.conversation_id !== selectedRef.current?.id) return;
        setMessages(prev => prev.map(m => m.id === data.id ? data : m));
      },
      onConversationCreated: (data: any) => {
        setConversations(prev => {
          if (prev.some(c => c.id === data.id)) return prev;
          return [data, ...prev];
        });
        if (profileRef.current?.availability !== "online") return;
        const senderName = data.meta?.sender?.name || "Unknown";
        const time = data.created_at
          ? new Date(data.created_at * 1000).toLocaleTimeString()
          : "";
        toast(`New conversation from ${senderName}`, {
          description: `#${data.id} · ${time}`,
          duration: 10000,
          closeButton: true,
          classNames: {
            toast: "!bg-white !border-gray-200 !shadow-lg !rounded-lg !font-sans",
            title: "!text-gray-800 !font-medium !text-sm",
            description: "!text-gray-500 !text-xs",
            actionButton: "!bg-gray-800 !text-white !text-xs !rounded-md !px-3 !py-1 !font-medium hover:!bg-gray-700",
            closeButton: "!text-gray-400 hover:!text-gray-600",
          },
          action: {
            label: "View",
            onClick: () => setSelected(data),
          },
        });
      },
      onConversationStatusChanged: (data: any) => {
        setConversations(prev => prev.map(c => c.id === data.id ? { ...c, status: data.status } : c));
        if (data.id === selectedRef.current?.id) {
          setSelected(prev => prev ? { ...prev, status: data.status } : prev);
        }
      },
      onConversationUpdated: (data: any) => {
        const assignee = data.meta?.assignee ? { id: data.meta.assignee.id, name: data.meta.assignee.name, email: data.meta.assignee.email ?? "" } : undefined;
        setConversations(prev => prev.map(c => c.id === data.id ? { ...c, ...data, ...(assignee !== undefined ? { assignee } : {}) } : c));
        const ho = data.custom_attributes?.handed_off === true;
        if (data.id === selectedRef.current?.id) {
          setHandedOff(ho);
          if (!ho) setInputTab("note");
          if (assignee !== undefined) setSelected(prev => prev ? { ...prev, assignee } : prev);
        }
        if (ho && profileRef.current?.availability === "online") {
          const senderName = data.meta?.sender?.name || "Unknown";
          const time = data.created_at
            ? new Date(data.created_at * 1000).toLocaleTimeString()
            : "";
          new Audio("/mixkit-correct-answer-tone-2870.wav").play().catch(() => {});
          toast(`Handed off: ${senderName}`, {
            description: `#${data.id} · ${time}`,
            duration: 10000,
            closeButton: true,
            classNames: {
              toast: "!bg-white !border-orange-200 !shadow-lg !rounded-lg !font-sans",
              title: "!text-orange-700 !font-medium !text-sm",
              description: "!text-gray-500 !text-xs",
              actionButton: "!bg-orange-600 !text-white !text-xs !rounded-md !px-3 !py-1 !font-medium hover:!bg-orange-700",
              closeButton: "!text-gray-400 hover:!text-gray-600",
            },
            action: {
              label: "Accept",
              onClick: async () => {
                const p = profileRef.current;
                setSelected(data);
                await fetch(`/api/conversations/${data.id}/assignments`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ assignee_id: p?.id }),
                });
                setConversations(prev => prev.map(c =>
                  c.id === data.id ? { ...c, assignee: { id: p!.id, name: p!.name, email: p!.email } } : c
                ));
              },
            },
          });
        }
      },
    }
  );


  async function setStatus(status: string) {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/conversations/${selected.id}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    const updated = { ...selected, status: data?.current_status ?? status };
    setSelected(updated);
    setConversations(p => p.map(c => c.id === selected.id ? updated : c));
    setSaving(false);
  }

  async function assignAgent(agentId: number | null) {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/conversations/${selected.id}/assignments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignee_id: agentId }),
    });
    const agent = agentId ? (agents.find(a => a.id === agentId) ?? null) : null;
    const updated = { ...selected, assignee: agent };
    setSelected(updated); setConversations(p => p.map(c => c.id === selected.id ? updated : c));
    setSaving(false);
  }

  async function addLabel() {
    if (!selected || !labelInput.trim()) return;
    const next = [...new Set([...(selected.labels ?? []), labelInput.trim().toLowerCase()])];
    await fetch(`/api/conversations/${selected.id}/labels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: next }),
    });
    const updated = { ...selected, labels: next };
    setSelected(updated); setConversations(p => p.map(c => c.id === selected.id ? updated : c));
    setLabelInput("");
  }

  async function removeLabel(label: string) {
    if (!selected) return;
    const next = (selected.labels ?? []).filter(l => l !== label);
    await fetch(`/api/conversations/${selected.id}/labels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: next }),
    });
    const updated = { ...selected, labels: next };
    setSelected(updated); setConversations(p => p.map(c => c.id === selected.id ? updated : c));
  }

  async function addNote() {
    if (!selected || !noteText.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/conversations/${selected.id}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: noteText }),
    });
    const msg = await res.json();
    if (msg?.id) setMessages(p => [...p, msg].sort((a, b) => a.created_at - b.created_at));
    setNoteText(""); setSaving(false);
    scrollToBottom();
  }

  async function sendReply() {
    if (!selected || !replyText.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/conversations/${selected.id}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: replyText }),
    });
    const msg = await res.json();
    if (msg?.id) setMessages(p => [...p, msg].sort((a, b) => a.created_at - b.created_at));
    setReplyText(""); setSaving(false);
    scrollToBottom();
  }

  async function saveEditContact() {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/contacts/${selected.meta.sender.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, email: editEmail, phone_number: editPhone }),
    });
    const updated = { ...selected, meta: { ...selected.meta, sender: { ...selected.meta.sender, name: editName } } };
    setSelected(updated); setConversations(p => p.map(c => c.id === selected.id ? updated : c));
    setEditOpen(false); setSaving(false);
  }

  async function deleteContact() {
    if (!selected) return;
    await fetch(`/api/contacts/${selected.meta.sender.id}`, { method: "DELETE" });
    setConversations(p => p.filter(c => c.id !== selected.id));
    setSelected(null); setDeleteOpen(false);
  }

  async function blockContact() {
    if (!selected) return;
    await fetch(`/api/contacts/${selected.meta.sender.id}/block`, { method: "POST" });
  }

  async function sendTranscript() {
    if (!selected || !transcriptEmail) return;
    setSaving(true);
    await fetch(`/api/conversations/${selected.id}/transcript`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: transcriptEmail }),
    });
    setTranscriptOpen(false); setTranscriptEmail(""); setSaving(false);
  }

  async function addParticipant() {
    if (!selected || !participantAgentId) return;
    const res = await fetch(`/api/conversations/${selected.id}/participants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: [Number(participantAgentId)] }),
    });
    const data = await res.json();
    setParticipants(data?.payload ?? participants);
    setParticipantAgentId("");
  }

  const filtered = conversations.filter(c =>
    (c.meta?.sender?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const displayList = filtered;

  return (
    <div className="flex h-screen bg-white overflow-hidden text-sm font-sans">
      <Toaster richColors closeButton />


      {/* ── Conversation list ────────────────── */}
      <div className="flex flex-col w-72 shrink-0 border-r border-gray-100 bg-white overflow-hidden">
        <div className="px-3 pt-3 pb-0 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">Agent Inbox <span className={`inline-block w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-400"}`} title={wsConnected ? "Connected" : "Disconnected"} /></h2>
              {profile && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
                    <span className={`inline-block w-2 h-2 rounded-full ${profile.availability === "online" ? "bg-green-500" : profile.availability === "busy" ? "bg-yellow-500" : "bg-gray-400"}`} />
                    <span>{profile.name} <span className="text-gray-300">#{profile.id}</span></span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(["online", "offline", "busy"] as const).map(status => (
                      <DropdownMenuItem
                        key={status}
                        onClick={async () => {
                          const res = await fetch("/api/profile", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ availability: status }),
                          });
                          if (res.ok) setProfile(prev => prev ? { ...prev, availability: status } : prev);
                        }}
                        className="flex items-center gap-2 text-xs capitalize"
                      >
                        <span className={`inline-block w-2 h-2 rounded-full ${status === "online" ? "bg-green-500" : status === "busy" ? "bg-yellow-500" : "bg-gray-400"}`} />
                        {status}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <Link href="/" className="text-xs text-gray-400 hover:text-gray-600">Sync</Link>
          </div>
          {/* Tabs */}
          <div className="flex gap-0">
            {(["assigned", "unassigned", "all"] as Tab[]).map(t => {
              const labels: Record<Tab, string> = { assigned: "Mine", unassigned: "Unassigned", all: "All" };
              const counts: Record<Tab, number> = { assigned: tabCounts.assigned, unassigned: tabCounts.unassigned, all: tabCounts.all };
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t ? "border-amber-500 text-amber-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                  {labels[t]}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-400"}`}>{counts[t]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-3 py-2 border-b border-gray-100 space-y-2">
          <div className="flex gap-1.5">
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs outline-none focus:border-gray-400 bg-gray-50" />
            <button onClick={() => setFilterOpen(o => !o)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${activeFilters ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300"}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3h10M3 6h6M5 9h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              {activeFilters ? "Filtered" : "Filter"}
            </button>
          </div>

          {/* Filter panel */}
          {filterOpen && (
            <div className="rounded-md border border-gray-200 bg-white shadow-sm p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Filter conversations</p>
              {filterRows.map((row, i) => {
                const attr = FILTER_ATTRIBUTES.find(a => a.key === row.attribute)!;
                const attrType = attr?.type ?? "text";
                const ops = OPERATORS_FOR[attrType] ?? OPERATORS_FOR.text;
                const noValue = ["is_present","is_not_present"].includes(row.operator);
                return (
                  <div key={i} className="space-y-1 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                    {/* Row 1: attribute + remove */}
                    <div className="flex gap-1 items-center">
                      <select value={row.attribute} onChange={e => {
                        const newAttr = FILTER_ATTRIBUTES.find(a => a.key === e.target.value)!;
                        const newOps = OPERATORS_FOR[newAttr?.type ?? "text"];
                        setFilterRows(p => p.map((r,j) => j===i ? { ...r, attribute: e.target.value, operator: newOps[0].key, value: "" } : r));
                      }} className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-gray-400">
                        {FILTER_ATTRIBUTES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                      </select>
                      {filterRows.length > 1 && (
                        <button onClick={() => setFilterRows(p => p.filter((_,j) => j!==i))} className="text-gray-300 hover:text-red-400 shrink-0">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                        </button>
                      )}
                    </div>
                    {/* Row 2: operator + value */}
                    <div className="flex gap-1">
                      <select value={row.operator} onChange={e => setFilterRows(p => p.map((r,j) => j===i ? { ...r, operator: e.target.value } : r))}
                        className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-gray-400">
                        {ops.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      {!noValue && attrType === "select" && "options" in attr ? (
                        <select value={row.value} onChange={e => setFilterRows(p => p.map((r,j) => j===i ? { ...r, value: e.target.value } : r))}
                          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-gray-400">
                          {(attr.options as readonly string[]).map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                        </select>
                      ) : !noValue && attrType === "agent" ? (
                        <select value={row.value} onChange={e => setFilterRows(p => p.map((r,j) => j===i ? { ...r, value: e.target.value } : r))}
                          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-gray-400">
                          <option value="">Select agent</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      ) : !noValue && attrType === "date" ? (
                        <input type="date" value={row.value} onChange={e => setFilterRows(p => p.map((r,j) => j===i ? { ...r, value: e.target.value } : r))}
                          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-gray-400" />
                      ) : !noValue ? (
                        <input type="text" value={row.value} placeholder="Value" onChange={e => setFilterRows(p => p.map((r,j) => j===i ? { ...r, value: e.target.value } : r))}
                          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-gray-400" />
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <button onClick={() => setFilterRows(p => [...p, defaultRow()])}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium">+ Add filter</button>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setActiveFilters(null); setFilterRows([defaultRow()]); setFilterOpen(false); }}
                  className="flex-1 text-xs border border-gray-200 rounded py-1.5 text-gray-500 hover:bg-gray-50 transition-colors">Clear filters</button>
                <button onClick={() => { setActiveFilters([...filterRows]); setFilterOpen(false); }}
                  className="flex-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded py-1.5 font-medium transition-colors">Apply filters</button>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? <p className="text-center text-xs text-gray-400 pt-10">Loading…</p>
            : displayList.length === 0 ? <p className="text-center text-xs text-gray-400 pt-10">No conversations</p>
            : displayList.map(conv => (
              <button key={conv.id} onClick={() => setSelected(conv)}
                className={`w-full text-left px-3 py-3 border-b border-gray-50 transition-colors ${selected?.id === conv.id ? "bg-amber-50 border-l-2 border-l-amber-400" : "hover:bg-gray-50"}`}>
                <div className="flex items-start gap-2.5">
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5"><AvatarFallback className={`text-xs ${avatarColor(conv.meta?.sender?.name ?? "")}`}>{initials(conv.meta?.sender?.name ?? "V#")}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-medium text-gray-700 text-xs truncate">{conv.meta?.sender?.name ?? "Visitor"}</span>
                      <StatusBadge status={conv.status} />
                    </div>
                    <p className="text-[10px] text-gray-400">{fmtConv(conv)}</p>
                    {conv.assignee && <p className="text-[10px] text-gray-400 mt-0.5">↳ {conv.assignee.name}</p>}
                  </div>
                </div>
              </button>
            ))}
        </div>
      </div>

      {/* ── Messages ────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 bg-white">
        <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 shrink-0">
          {selected ? (
            <>
              <Avatar className="h-8 w-8 shrink-0"><AvatarFallback className={`text-sm ${avatarColor(selected.meta?.sender?.name ?? "")}`}>{initials(selected.meta?.sender?.name ?? "V#")}</AvatarFallback></Avatar>
              <div>
                <h1 className="font-semibold text-gray-800">{selected.meta?.sender?.name ?? "Visitor"}</h1>
                <p className="text-xs text-gray-400">#{selected.id} · {fmtConv(selected)}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Resolve + dropdown */}
                <div className="flex items-center rounded-md border border-gray-200 overflow-hidden">
                  <Button size="sm" variant="ghost" className="rounded-none border-r border-gray-200 h-8 px-3 font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => setStatus(selected.status === "open" ? "resolved" : "open")} disabled={saving}>
                    {selected.status === "open" ? "Resolve" : "Reopen"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 px-2 rounded-none text-gray-500 hover:bg-gray-50 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setStatus("snoozed")}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mr-2"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                        Snooze
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setStatus("pending")}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mr-2"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" /></svg>
                        Mark as pending
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {/* ⋯ menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-gray-100 transition-colors border border-gray-200">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="13" r="1.2" fill="currentColor" /></svg>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTranscriptOpen(true)}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mr-2"><path d="M7 1v8M4 6l3 3 3-3M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Send Transcript
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={blockContact} className="text-red-500">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mr-2"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 3l8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      Block Contact
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Toggle right panel */}
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => setRightPanelOpen(o => !o)}
                    className={`inline-flex items-center justify-center h-8 w-8 rounded-md border transition-colors ${rightPanelOpen ? "border-gray-300 bg-gray-100 text-gray-700" : "border-gray-200 text-gray-400 hover:bg-gray-50"}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      <path d="M10 2v6M12 4l-2 2-2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </TooltipTrigger>
                  <TooltipContent>{rightPanelOpen ? "Hide contact info" : "Show contact info"}</TooltipContent>
                </Tooltip>
              </div>
            </>
          ) : <p className="text-xs text-gray-400">Select a conversation</p>}
        </header>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-50 border-b border-gray-100 shrink-0">
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><span className="h-2 w-2 rounded-full bg-blue-400 inline-block" /> Bot (left)</span>
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><span className="h-2 w-2 rounded-full bg-slate-600 inline-block" /> User (right)</span>
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400"><span className="h-2 w-2 rounded-full bg-amber-400 inline-block" /> Private note</span>
        </div>

        <div ref={messagesScrollRef} className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4">
          <div className="space-y-3">
            {loadingMsgs ? <p className="text-center text-xs text-gray-400 pt-10">Loading…</p>
              : messages.length === 0 ? <p className="text-center text-xs text-gray-400 pt-10">No messages</p>
              : messages.map(msg => {
                if (msg.message_type === 2) return <ActivityMsg key={msg.id} msg={msg} />;
                if (msg.private) return <NoteMsg key={msg.id} msg={msg} />;
                const isUser = msg.message_type === 0;
                return <ChatMsg key={msg.id} msg={msg} isUser={isUser} />;
              })}
          </div>
        </div>

        {selected && (
          <div className="border-t border-gray-100 px-4 py-3 bg-white shrink-0">
            <div className="flex gap-3 mb-1.5">
              {handedOff && (
                <button onClick={() => setInputTab("reply")}
                  className={`text-xs font-medium pb-0.5 border-b-2 transition-colors ${inputTab === "reply" ? "border-blue-500 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>Reply</button>
              )}
              <button onClick={() => setInputTab("note")}
                className={`text-xs font-medium pb-0.5 border-b-2 transition-colors ${inputTab === "note" ? "border-amber-500 text-amber-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>Private Note</button>
            </div>
            <div className="flex gap-2">
              {inputTab === "reply" ? (
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                  placeholder="Send a reply to the customer…" rows={2}
                  className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs resize-none outline-none focus:border-blue-400 placeholder-gray-300" />
              ) : (
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a private note for agents…" rows={2}
                  className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs resize-none outline-none focus:border-amber-400 placeholder-gray-300" />
              )}
              <Button size="sm" variant="outline"
                onClick={inputTab === "reply" ? sendReply : addNote}
                disabled={saving || (inputTab === "reply" ? !replyText.trim() : !noteText.trim())}>
                {inputTab === "reply" ? "Send Reply" : "Add Note"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right panel (collapsible) ─────────── */}
      <div className={`shrink-0 flex flex-col bg-white border-l border-gray-100 overflow-hidden transition-all duration-200 ${rightPanelOpen ? "w-72" : "w-0"}`}>
        {selected && rightPanelOpen && (
          <ScrollArea className="flex-1">
            {/* Contact header */}
            <div className="px-4 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10"><AvatarFallback className={`font-semibold ${avatarColor(selected.meta?.sender?.name ?? "")}`}>{initials(selected.meta?.sender?.name ?? "V#")}</AvatarFallback></Avatar>
                  <div>
                    <p className="font-semibold text-gray-800">{selected.meta?.sender?.name ?? "Visitor"}</p>
                    <p className="text-xs text-gray-400">Contact #{selected.meta?.sender?.id}</p>
                  </div>
                </div>
              </div>

              {/* Contact action icons */}
              <div className="flex gap-2">
                {[
                  { label: "New Conversation", icon: "M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z", action: () => {} },
                  { label: "Edit Contact", icon: "M11 2l1 1-8 8H3v-1L11 2z", action: () => { setEditName(selected.meta.sender.name); setEditEmail(contactDetail?.email || ""); setEditPhone(contactDetail?.phone_number || ""); setEditOpen(true); } },
                  { label: "Merge Contact", icon: "M3 6l4-4 4 4M7 2v10M3 10l4 4 4-4", action: () => {} },
                  { label: "Delete Contact", icon: "M2 4h10M5 4V2h4v2M9 4v8M5 4v8M3 4l1 8h6l1-8", danger: true, action: () => setDeleteOpen(true) },
                ].map(btn => (
                  <Tooltip key={btn.label}>
                    <TooltipTrigger
                      onClick={btn.action}
                      className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${btn.danger ? "border-gray-200 bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-400 hover:border-red-100" : "border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100"}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d={btn.icon} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </TooltipTrigger>
                    <TooltipContent>{btn.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {/* Contact info */}
              <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                <InfoRow label="Email" value={contactDetail?.email || "Not available"} />
                <InfoRow label="Phone" value={contactDetail?.phone_number || "Not available"} />
                <InfoRow label="Identifier" value={selected.meta?.sender?.identifier ?? "—"} mono />
                <InfoRow label="Channel" value={selected.meta?.channel ?? "API"} />
              </div>
            </div>

            <Accordion defaultValue={["actions", "labels"]} className="px-0">

              {/* Conversation Actions */}
              <AccordionItem value="actions" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Conversation Actions</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Assigned Agent</p>
                    <select value={selected.assignee?.id ?? ""} onChange={e => assignAgent(e.target.value ? Number(e.target.value) : null)}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs bg-white outline-none focus:border-gray-400">
                      <option value="">Unassigned</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Status</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["open", "resolved", "pending"].map(s => (
                        <button key={s} onClick={() => setStatus(s)} disabled={saving}
                          className={`rounded-md border px-3 py-1 text-xs font-medium capitalize transition-colors ${selected.status === s
                            ? s === "open" ? "bg-green-600 text-white border-green-600"
                              : s === "resolved" ? "bg-gray-600 text-white border-gray-600"
                              : "bg-amber-500 text-white border-amber-500"
                            : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Labels */}
              <AccordionItem value="labels" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Labels</AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(selected.labels ?? []).length === 0 && <p className="text-xs text-gray-400">No labels</p>}
                    {(selected.labels ?? []).map(label => (
                      <span key={label} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] text-indigo-700">
                        {label}
                        <button onClick={() => removeLabel(label)} className="text-indigo-400 hover:text-indigo-700 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input type="text" placeholder="Add label…" value={labelInput}
                      onChange={e => setLabelInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addLabel()}
                      className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400" />
                    <Button size="sm" variant="outline" onClick={addLabel} disabled={!labelInput.trim()}>Add</Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Conversation Information */}
              <AccordionItem value="convinfo" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Conversation Information</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-1.5 text-xs">
                  <InfoRow label="ID" value={`#${selected.id}`} />
                  <InfoRow label="Created" value={fmtConv(selected)} />
                  <InfoRow label="Status" value={selected.status} />
                  <InfoRow label="Inbox" value="Netomi Bot Conversations" />
                  <InfoRow label="Assignee" value={selected.assignee?.name ?? "Unassigned"} />
                  <InfoRow label="Handed Off" value={handedOff ? "Yes" : "No"} />
                </AccordionContent>
              </AccordionItem>

              {/* Contact Attributes */}
              <AccordionItem value="attrs" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Contact Attributes</AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-1.5 text-xs">
                  <InfoRow label="Email" value={contactDetail?.email || "Not available"} />
                  <InfoRow label="Phone" value={contactDetail?.phone_number || "Not available"} />
                  <InfoRow label="Company" value="Not available" />
                  <InfoRow label="Location" value="Not available" />
                </AccordionContent>
              </AccordionItem>

              {/* Contact Notes */}
              <AccordionItem value="cnotes" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Contact Notes</AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <p className="text-xs text-gray-400">No notes for this contact.</p>
                </AccordionContent>
              </AccordionItem>

              {/* Previous Conversations */}
              <AccordionItem value="prevcovs" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">
                  Previous Conversations {prevConvs.length > 0 && <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5">{prevConvs.length}</span>}
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-2">
                  {prevConvs.length === 0 ? <p className="text-xs text-gray-400">No previous conversations.</p>
                    : prevConvs.slice(0, 5).map(c => (
                      <button key={c.id} onClick={() => setSelected(c)}
                        className="w-full text-left rounded-md border border-gray-100 px-2.5 py-2 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-gray-600">#{c.id}</span>
                          <StatusBadge status={c.status} />
                        </div>
                        <p className="text-[10px] text-gray-400">{fmt(c.created_at)}</p>
                      </button>
                    ))}
                </AccordionContent>
              </AccordionItem>

              {/* Conversation Participants */}
              <AccordionItem value="participants" className="border-b border-gray-100">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">
                  Conversation Participants {participants.length > 0 && <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5">{participants.length}</span>}
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 space-y-2">
                  {participants.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {participants.map(p => (
                        <div key={p.id} className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5">
                          <Avatar className="h-4 w-4"><AvatarFallback className="text-[8px] bg-gray-200 text-gray-600">{initials(p.name)}</AvatarFallback></Avatar>
                          <span className="text-[10px] text-gray-600">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <select value={participantAgentId} onChange={e => setParticipantAgentId(e.target.value)}
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none focus:border-gray-400">
                      <option value="">Add participant…</option>
                      {agents.filter(a => !participants.find(p => p.id === a.id)).map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" onClick={addParticipant} disabled={!participantAgentId}>Add</Button>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Macros */}
              <AccordionItem value="macros">
                <AccordionTrigger className="px-4 py-3 text-xs font-semibold text-gray-600 hover:no-underline">Macros</AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <p className="text-xs text-gray-400">No macros configured.</p>
                </AccordionContent>
              </AccordionItem>

            </Accordion>
          </ScrollArea>
        )}
      </div>

      {/* ── Edit Contact Modal ───────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Name</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
              <input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Not available" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" /></div>
            <div><label className="text-xs font-medium text-gray-600 block mb-1">Phone</label>
              <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="Not available" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEditContact} disabled={saving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Contact Modal ─────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Contact</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Are you sure you want to delete <strong>{selected?.meta?.sender?.name}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteContact}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send Transcript Modal ────────────── */}
      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Transcript</DialogTitle></DialogHeader>
          <div className="py-2">
            <label className="text-xs font-medium text-gray-600 block mb-1">Email address</label>
            <input type="email" value={transcriptEmail} onChange={e => setTranscriptEmail(e.target.value)}
              placeholder="Enter email to send transcript to…"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTranscriptOpen(false)}>Cancel</Button>
            <Button onClick={sendTranscript} disabled={saving || !transcriptEmail}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChatMsg({ msg, isUser }: { msg: Message; isUser: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        msg.content_attributes?.sender === "agent"
          ? <div className="h-6 w-6 shrink-0 rounded-full bg-green-100 flex items-center justify-center mb-1 text-[9px] text-green-700 font-bold">A</div>
          : <div className="h-6 w-6 shrink-0 rounded-full bg-blue-100 flex items-center justify-center mb-1 text-[9px] text-blue-700 font-bold">AI</div>
      )}
      <div className={`max-w-[68%] rounded-2xl px-4 py-2.5 ${isUser ? "bg-slate-700 text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-700 rounded-bl-sm shadow-sm"}`}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${isUser ? "text-slate-300 text-right" : "text-gray-400"}`}>{fmtMsg(msg)}</p>
      </div>
      {isUser && <div className="h-6 w-6 shrink-0 rounded-full bg-slate-200 flex items-center justify-center mb-1 text-[9px] text-slate-600 font-bold">{initials(msg.sender?.name ?? "V")}</div>}
    </div>
  );
}

function NoteMsg({ msg }: { msg: Message }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-xl bg-amber-50 border border-amber-200 border-dashed px-4 py-2.5">
        <p className="text-[10px] font-semibold text-amber-600 mb-1">Private Note · {msg.sender?.name ?? "Agent"}</p>
        <p className="text-xs text-amber-900 whitespace-pre-wrap break-words">{msg.content}</p>
        <p className="text-[10px] text-amber-400 mt-1">{fmtMsg(msg)}</p>
      </div>
    </div>
  );
}

function ActivityMsg({ msg }: { msg: Message }) {
  return (
    <div className="flex justify-center">
      <span className="text-[10px] text-gray-400 bg-white border border-gray-100 px-3 py-1 rounded-full">{msg.content} · {fmtMsg(msg)}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    open: "bg-green-50 text-green-700 border-green-200",
    resolved: "bg-gray-100 text-gray-500 border-gray-200",
    pending: "bg-amber-50 text-amber-600 border-amber-200",
    snoozed: "bg-purple-50 text-purple-600 border-purple-200",
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${s[status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>{status}</span>;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 text-gray-400 shrink-0">{label}</span>
      <span className={`text-gray-600 truncate ${mono ? "font-mono text-[10px]" : ""}`}>{value}</span>
    </div>
  );
}
