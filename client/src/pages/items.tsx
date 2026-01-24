import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Phone, Mail, Copy, Clock, AlertTriangle, RefreshCw, FileText, Calendar, DollarSign } from "lucide-react";

type Item = any;
type AgingBucket = { label: string; count: number; total: number };
type AgingData = { buckets: AgingBucket[]; total_unpaid: number; total_count: number; as_of: string };

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Request failed");
  return j as T;
}

function fmtMoney(n: any) {
  const v = Number(n || 0);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(isFinite(v) ? v : 0);
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [aging, setAging] = useState<AgingData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    try {
      const [itemsRes, agingRes] = await Promise.all([
        api<{ ok: boolean; items: Item[] }>("/api/ga/items"),
        api<AgingData & { ok: boolean }>("/api/ga/items/aging"),
      ]);
      setItems(itemsRes.items || []);
      setAging(agingRes);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function touch(id: string, kind: "SOFT" | "PAST_DUE" | "FINAL", channel: "CALL" | "EMAIL" | "TEXT", note: string) {
    setBusyId(id);
    try {
      await api(`/api/ga/items/${id}/actions/touch`, {
        method: "POST",
        body: JSON.stringify({ actor: "dispatcher", kind, channel, note }),
      });
      toast({ title: `Touch logged (${kind})` });
      await refresh();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function promise(id: string, iso: string) {
    setBusyId(id);
    try {
      await api(`/api/ga/items/${id}/actions/promise`, {
        method: "POST",
        body: JSON.stringify({ actor: "dispatcher", promise_to_pay_at: iso, note: "Promise recorded" }),
      });
      toast({ title: "Promise set" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function escalate(id: string, level: "L1" | "L2" | "L3", reason: string) {
    setBusyId(id);
    try {
      await api(`/api/ga/items/${id}/actions/escalate`, {
        method: "POST",
        body: JSON.stringify({ actor: "manager", level, reason, note: "Escalated from Items screen" }),
      });
      toast({ title: `Escalated to ${level}` });
      await refresh();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "in_progress": return <Badge variant="outline" className="bg-blue-100 text-blue-800">In Progress</Badge>;
      case "promised": return <Badge className="bg-yellow-500">Promised</Badge>;
      case "escalated": return <Badge variant="destructive">Escalated</Badge>;
      case "closed": return <Badge className="bg-green-600">Closed</Badge>;
      default: return <Badge variant="secondary">Open</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-8 h-8" />
            Items (Collections)
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage outstanding invoices and follow-up actions
          </p>
        </div>
        <Button onClick={refresh} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {aging && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Aging Summary
              </CardTitle>
              <div className="text-right">
                <div className="text-2xl font-bold text-green-600">{fmtMoney(aging.total_unpaid)}</div>
                <div className="text-sm text-gray-500">{aging.total_count} unpaid invoices</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-2">
              {aging.buckets.map((b) => (
                <div
                  key={b.label}
                  className={`p-3 rounded-lg text-center ${
                    b.count > 0 ? "bg-blue-50 dark:bg-blue-900/20" : "bg-gray-50 dark:bg-gray-800"
                  }`}
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{b.label} days</div>
                  <div className="text-lg font-bold">{b.count}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">{fmtMoney(b.total)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !loading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-gray-500">
              No outstanding items. This screen shows loads with invoice_status='sent' that are unpaid.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it) => {
          const id = it.id as string;
          const lane = `${it.origin_city ?? "?"}, ${it.origin_state ?? "?"} → ${it.dest_city ?? "?"}, ${it.dest_state ?? "?"}`;
          const broker = it.broker_name ?? "Broker";
          const inv = it.invoice_id ?? "Invoice";
          const amt = fmtMoney(it.invoice_total ?? 0);

          const softMsg = `${broker}, quick follow-up on ${inv} for ${amt}. Can you confirm payment ETA?`;
          const pastDueMsg = `${broker}, ${inv} for ${amt} is still outstanding. Please confirm payment ETA today and send remittance advice.`;

          return (
            <Card key={id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{inv}</CardTitle>
                  <span className="text-lg font-bold text-green-600">{amt}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {getStatusBadge(it.item_status)}
                  {it.item_owner && (
                    <Badge variant="outline">{it.item_owner}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm space-y-1 text-gray-600 dark:text-gray-400">
                  <div><strong>Lane:</strong> {lane}</div>
                  <div><strong>Broker:</strong> {broker}</div>
                  <div><strong>Sent:</strong> {fmtDate(it.invoice_sent_at)}</div>
                  <div><strong>Last touch:</strong> {fmtDate(it.last_touch_at)}</div>
                  <div><strong>Promise:</strong> {fmtDate(it.promise_to_pay_at)}</div>
                  {it.next_action_at && (
                    <div className="text-blue-600 dark:text-blue-400">
                      <strong>Next Action:</strong> {fmtDate(it.next_action_at)} ({it.next_action_type || "—"})
                    </div>
                  )}
                  {it.escalated_at && (
                    <div className="text-red-600">
                      <strong>Escalated:</strong> {fmtDate(it.escalated_at)} ({it.escalation_level})
                    </div>
                  )}
                  {it.collection_stage && (
                    <div className="text-sm">
                      <strong>Stage:</strong> <Badge variant="outline" className="text-xs">{it.collection_stage}</Badge>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === id}
                    onClick={() => touch(id, "SOFT", "CALL", "Called broker")}
                  >
                    <Phone className="w-3 h-3 mr-1" />
                    Log Call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === id}
                    onClick={async () => {
                      await copyText(softMsg);
                      await touch(id, "SOFT", "EMAIL", "Copied soft follow-up");
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Soft Msg
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === id}
                    onClick={async () => {
                      await copyText(pastDueMsg);
                      await touch(id, "PAST_DUE", "EMAIL", "Copied past-due");
                    }}
                  >
                    <Mail className="w-3 h-3 mr-1" />
                    Past-Due
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === id}
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 3);
                      d.setHours(12, 0, 0, 0);
                      promise(id, d.toISOString());
                    }}
                  >
                    <Clock className="w-3 h-3 mr-1" />
                    Promise +3 Days
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === id}
                    onClick={() => escalate(id, "L1", "No response to follow-ups")}
                  >
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Escalate L1
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
