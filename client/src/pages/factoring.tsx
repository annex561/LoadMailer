import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, FileText, Send } from "lucide-react";

interface QueueItem {
  loadId: string;
  loadNumber: string;
  brokerName: string | null;
  deliveredAt: string | null;
  rate: number | null;
  ready: boolean;
  issues: string[];
  rateconSource: string | null;
  bolSource: string | null;
  factoringStatus: string | null;
  existingSubmission: any;
}

interface QueueResponse {
  queue: QueueItem[];
  pastCutoff: boolean;
}

interface Submission {
  id: string;
  loadId: string;
  status: string;
  submittedAt: string | null;
  fundedAt: string | null;
  amountInvoiced: number | null;
  amountAdvanced: number | null;
  feeCharged: number | null;
  lovesInvoiceId: string | null;
  lovesScheduleId: string | null;
  errorMessage: string | null;
}

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export default function FactoringPage() {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ loadId: string; ok: boolean; msg: string } | null>(null);

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<QueueResponse>({
    queryKey: ["/api/factoring/queue"],
    refetchInterval: 30_000,
  });
  const { data: subs, isLoading: subsLoading, refetch: refetchSubs } = useQuery<Submission[]>({
    queryKey: ["/api/factoring/submissions"],
    refetchInterval: 30_000,
  });

  const queue = queueData?.queue ?? [];
  const pastCutoff = queueData?.pastCutoff ?? false;
  const pendingSubs = (subs ?? []).filter((s) => s.status === "submitted");
  const fundedSubs = (subs ?? []).filter((s) => s.status === "funded");
  const failedSubs = (subs ?? []).filter((s) => s.status === "rejected" || s.status === "bounced");

  const handleSubmit = async (loadId: string) => {
    if (!confirm("Submit this packet to Love's? You'll get a text to approve before it sends.")) return;
    setSubmitting(loadId);
    setLastResult(null);
    try {
      const res = await fetch(`/api/factoring/submit/${loadId}`, { method: "POST" });
      const data = await res.json();
      if (data.ok && data.pendingApproval) {
        setLastResult({ loadId, ok: true, msg: `📱 Approval SMS sent — reply APPROVE to submit to Love's. Or click "Confirm Send" below to skip.` });
      } else if (data.ok) {
        setLastResult({ loadId, ok: true, msg: `✅ Sent to Love's. Msg ID: ${data.emailMessageId}` });
      } else {
        setLastResult({
          loadId,
          ok: false,
          msg: data.blocked ? `⛔ Blocked: ${data.blocked}` : `❌ ${data.error}`,
        });
      }
      refetchQueue();
      refetchSubs();
    } catch (e: any) {
      setLastResult({ loadId, ok: false, msg: `❌ ${e?.message}` });
    } finally {
      setSubmitting(null);
    }
  };

  const handlePreview = (loadId: string) => {
    window.open(`/api/factoring/preview/${loadId}`, "_blank");
  };

  const handleConfirmSend = async (loadId: string) => {
    if (!confirm("Send this packet to Love's Financial now?")) return;
    setSubmitting(loadId);
    setLastResult(null);
    try {
      const res = await fetch(`/api/factoring/confirm-send/${loadId}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLastResult({ loadId, ok: true, msg: `✅ Sent to Love's. Msg ID: ${data.emailMessageId}` });
      } else {
        setLastResult({
          loadId,
          ok: false,
          msg: data.blocked ? `⛔ Blocked: ${data.blocked}` : `❌ ${data.error}`,
        });
      }
      refetchQueue();
      refetchSubs();
    } catch (e: any) {
      setLastResult({ loadId, ok: false, msg: `❌ ${e?.message}` });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold">Factoring · Love's Financial</h1>
        {pastCutoff && (
          <div className="text-sm text-amber-500 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Past 11 AM CT cutoff — submissions today will fund tomorrow
          </div>
        )}
      </div>

      {lastResult && (
        <div
          className={`p-3 rounded-md border text-sm ${
            lastResult.ok
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-red-500/40 bg-red-500/5"
          }`}
        >
          {lastResult.msg}
        </div>
      )}

      {/* READY QUEUE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Ready for Submission ({queue.filter((q) => q.ready).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queueLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No delivered loads waiting to be factored. ✓
            </p>
          ) : (
            <div className="space-y-2">
              {queue.map((q) => (
                <div
                  key={q.loadId}
                  className={`p-3 rounded-md border ${q.ready ? "border-border" : "border-amber-500/40 bg-amber-500/5"}`}
                  data-testid={`factoring-queue-${q.loadId}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm">
                        Load #{q.loadNumber}{" "}
                        {q.brokerName && (
                          <span className="text-muted-foreground">· {q.brokerName}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Delivered {q.deliveredAt ? new Date(q.deliveredAt).toLocaleString() : "?"} · Rate {fmtMoney(q.rate)}
                      </div>
                      {/* Show exactly which sources the packet will pull from
                          so the dispatcher can verify before submitting. */}
                      <div className="text-xs mt-2 space-y-0.5 font-mono opacity-80">
                        <div>
                          {q.rateconSource ? "✓" : "✗"}{" "}
                          <span className="text-muted-foreground">RateCon:</span>{" "}
                          {q.rateconSource ?? "MISSING"}
                        </div>
                        <div>
                          {q.bolSource ? "✓" : "✗"}{" "}
                          <span className="text-muted-foreground">BOL:</span>{" "}
                          {q.bolSource ?? "MISSING — driver hasn't sent photo yet"}
                        </div>
                      </div>
                      {q.issues.length > 0 && (
                        <div className="text-xs text-amber-500 mt-1 flex items-start gap-1">
                          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {q.issues.join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePreview(q.loadId)}
                        disabled={!q.ready}
                        title={
                          q.ready
                            ? "Render the merged packet PDF without sending"
                            : "Cannot preview — load is missing required docs (see source labels above)"
                        }
                        className="w-full sm:w-auto"
                      >
                        Preview Packet
                      </Button>
                      {q.factoringStatus === "pending_approval" ? (
                        <>
                          <Badge variant="outline" className="text-amber-400 border-amber-400/50 whitespace-nowrap">
                            Awaiting approval
                          </Badge>
                          <Button
                            size="sm"
                            onClick={() => handleConfirmSend(q.loadId)}
                            disabled={submitting === q.loadId}
                            className="w-full sm:w-auto bg-green-700 hover:bg-green-600"
                          >
                            {submitting === q.loadId ? "Sending…" : "Confirm Send"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSubmit(q.loadId)}
                          disabled={!q.ready || submitting === q.loadId}
                          className="w-full sm:w-auto"
                        >
                          {submitting === q.loadId ? "Sending…" : "Submit to Love's"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PENDING — submitted, awaiting funding */}
      {pendingSubs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Submitted, awaiting funding ({pendingSubs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSubs.map((s) => (
                <div key={s.id} className="p-3 rounded-md border text-sm">
                  <div className="flex justify-between gap-2">
                    <div className="font-mono">Load: {s.loadId.slice(0, 8)}</div>
                    <Badge>{s.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Sent {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "?"} · {fmtMoney(s.amountInvoiced)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* FUNDED HISTORY */}
      {fundedSubs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Funded ({fundedSubs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {fundedSubs.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <div className="font-mono">Load: {s.loadId.slice(0, 8)}</div>
                    <Badge variant="secondary">funded</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Funded {s.fundedAt ? new Date(s.fundedAt).toLocaleString() : "?"}
                  </div>
                  <div className="text-xs mt-1 grid grid-cols-3 gap-2">
                    <div>Invoiced: {fmtMoney(s.amountInvoiced)}</div>
                    <div>Fee: {fmtMoney(s.feeCharged)}</div>
                    <div>Advanced: {fmtMoney(s.amountAdvanced)}</div>
                  </div>
                  {s.lovesInvoiceId && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Love's #{s.lovesInvoiceId} · Schedule {s.lovesScheduleId ?? "?"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* FAILED */}
      {failedSubs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Failed ({failedSubs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {failedSubs.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <div className="font-mono">Load: {s.loadId.slice(0, 8)}</div>
                    <Badge variant="destructive">{s.status}</Badge>
                  </div>
                  {s.errorMessage && (
                    <div className="text-xs text-red-500 mt-1">{s.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
