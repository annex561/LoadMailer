/**
 * Admin recruitment dashboard — Stage 1.
 * Route: /admin/recruitment
 *
 * Lists all leads (newest first), shows stage at a glance, click-to-call,
 * click-to-text (opens default SMS app), one-tap stage moves. Activities log
 * shows on lead detail view (Stage 1 keeps it inline in the list row expansion).
 *
 * No automated outbound here — admin texts/calls manually from this dashboard
 * until Stage 2 (separate PR, approval-gated) introduces the sequence engine.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, MessageSquare, Mail, RefreshCw } from "lucide-react";

type Lead = {
  id: string;
  stage: string;
  source: string;
  kind: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  currentCarrier: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  notes: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  settlement_sent: "Settlement Sent",
  conversation: "Conversation",
  application_sent: "App Sent",
  compliance_pending: "Compliance",
  lease_signed: "Lease Signed",
  first_load: "First Load",
  active_30d: "Active 30d",
  active_90d: "Active 90d",
  lost: "Lost",
  dormant: "Dormant",
};

const STAGE_COLOR: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  settlement_sent: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  conversation: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  application_sent: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  compliance_pending: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  lease_signed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  first_load: "bg-teal-500/10 text-teal-300 border-teal-500/30",
  active_30d: "bg-green-500/10 text-green-300 border-green-500/30",
  active_90d: "bg-green-600/20 text-green-200 border-green-600/40",
  lost: "bg-red-500/10 text-red-300 border-red-500/30",
  dormant: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

const NEXT_STAGE: Record<string, string> = {
  new: "settlement_sent",
  settlement_sent: "conversation",
  conversation: "application_sent",
  application_sent: "compliance_pending",
  compliance_pending: "lease_signed",
  lease_signed: "first_load",
  first_load: "active_30d",
  active_30d: "active_90d",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RecruitmentDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recruitment/leads");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function moveStage(leadId: string, toStage: string) {
    try {
      const res = await fetch(`/api/recruitment/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toStage }),
      });
      if (!res.ok) throw new Error("Stage update failed");
      refresh();
    } catch (err: any) {
      setError(err?.message || "Stage update failed");
    }
  }

  useEffect(() => { refresh(); }, []);

  const byStage = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage] = (acc[l.stage] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Recruitment</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Owner-operator and driver leads. Stage 1 — manual outreach only.
            </p>
          </div>
          <Button onClick={refresh} variant="outline" data-testid="button-refresh"
            className="border-zinc-800 hover:bg-zinc-900">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Stage summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          {Object.entries(STAGE_LABEL).filter(([k]) => byStage[k] > 0).map(([stage, label]) => (
            <Card key={stage} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-3">
                <div className="text-xs text-zinc-400">{label}</div>
                <div className="text-2xl font-bold">{byStage[stage] || 0}</div>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-3">
              <div className="text-xs text-zinc-400">Total</div>
              <div className="text-2xl font-bold">{leads.length}</div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Lead list */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>All Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && leads.length === 0 ? (
              <p className="text-zinc-400 text-sm">Loading…</p>
            ) : leads.length === 0 ? (
              <p className="text-zinc-400 text-sm">
                No leads yet. Share <code className="text-emerald-300">/owner-operators</code> in your ads and outreach.
              </p>
            ) : (
              <div className="space-y-2">
                {leads.map((lead) => {
                  const next = NEXT_STAGE[lead.stage];
                  return (
                    <div key={lead.id} data-testid={`lead-${lead.id}`}
                      className="grid grid-cols-1 md:grid-cols-[1fr,auto,auto] gap-3 p-3 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{lead.firstName} {lead.lastName || ""}</span>
                          <Badge variant="outline" className={STAGE_COLOR[lead.stage] || ""}>
                            {STAGE_LABEL[lead.stage] || lead.stage}
                          </Badge>
                          <span className="text-xs text-zinc-500">{lead.source}</span>
                        </div>
                        <div className="text-sm text-zinc-300 mt-1">
                          {lead.phone}
                          {lead.email ? ` · ${lead.email}` : ""}
                          {lead.currentCarrier ? ` · ${lead.currentCarrier}` : ""}
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          Created {fmtDate(lead.createdAt)}
                          {lead.lastContactedAt && ` · Last contact ${fmtDate(lead.lastContactedAt)}`}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button asChild size="sm" variant="outline" className="border-zinc-800 hover:bg-zinc-800">
                          <a href={`tel:${lead.phone}`} data-testid={`call-${lead.id}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="border-zinc-800 hover:bg-zinc-800">
                          <a href={`sms:${lead.phone}`} data-testid={`sms-${lead.id}`}>
                            <MessageSquare className="h-4 w-4" />
                          </a>
                        </Button>
                        {lead.email && (
                          <Button asChild size="sm" variant="outline" className="border-zinc-800 hover:bg-zinc-800">
                            <a href={`mailto:${lead.email}`} data-testid={`email-${lead.id}`}>
                              <Mail className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {next && (
                          <Button size="sm" onClick={() => moveStage(lead.id, next)}
                            data-testid={`advance-${lead.id}`}
                            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950">
                            → {STAGE_LABEL[next]}
                          </Button>
                        )}
                        {lead.stage !== "lost" && (
                          <Button size="sm" variant="outline"
                            onClick={() => moveStage(lead.id, "lost")}
                            data-testid={`lose-${lead.id}`}
                            className="border-red-500/40 text-red-300 hover:bg-red-500/10">
                            Lost
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
