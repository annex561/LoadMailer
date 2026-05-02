import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, Stethoscope, RefreshCw } from "lucide-react";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface HealthResponse {
  ok: boolean;
  checks: Check[];
  env: { node: string };
}

interface DiagnoseResponse {
  ok: boolean;
  wouldDispatch: boolean;
  findings: Check[];
  load?: { id: string; loadNumber?: string; brokerName?: string; driverId?: string; confirmationToken?: string };
  driver?: { id: string; name: string; phone?: string; smsOptedOutAt?: string | null; trackingToken?: string };
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
  ) : (
    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
  );
}

export default function SystemHealthPage() {
  const [loadIdInput, setLoadIdInput] = useState("");
  const [diagnoseLoadId, setDiagnoseLoadId] = useState<string | null>(null);

  const { data: health, isLoading: healthLoading, refetch: refetchHealth, isFetching: healthFetching } =
    useQuery<HealthResponse>({
      queryKey: ["/api/admin/health"],
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    });

  const { data: diagnose, isLoading: diagnoseLoading, isFetching: diagnoseFetching } =
    useQuery<DiagnoseResponse>({
      queryKey: [`/api/admin/dispatch-diagnose/${diagnoseLoadId}`],
      enabled: !!diagnoseLoadId,
      staleTime: 0,
    });

  const failedChecks = health?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Diagnostic checks for SMS dispatch, Twilio config, and DB schema. Hit this page first
            whenever a dispatch behaves unexpectedly — it'll tell you exactly what's wrong.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchHealth()} disabled={healthFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${healthFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall banner */}
      {health && (
        <Card className={health.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}>
          <CardContent className="p-4 flex items-center gap-3">
            {health.ok ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                <div>
                  <div className="font-semibold">All systems healthy</div>
                  <div className="text-sm text-muted-foreground">
                    {health.checks.length} checks passed. Dispatch should work end-to-end.
                  </div>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="w-6 h-6 text-red-500" />
                <div>
                  <div className="font-semibold">{failedChecks.length} check{failedChecks.length === 1 ? "" : "s"} failing</div>
                  <div className="text-sm text-muted-foreground">
                    Fix these before testing dispatch — they will silently break the SMS flow.
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-check list */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration checks</CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-3">
              {health?.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-md border bg-card">
                  <StatusIcon ok={c.ok} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 break-words">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-load dispatch diagnosis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5" />
            Diagnose a specific load
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter a load UUID (from the URL bar after clicking a load) — this checks every precondition
            that <code>sendDispatchSms</code> evaluates and reports pass/fail per step. Does NOT actually send the SMS.
          </p>
          <div className="flex gap-2">
            <Input
              value={loadIdInput}
              onChange={(e) => setLoadIdInput(e.target.value)}
              placeholder="b3126526-57cc-47ef-94d8-c9443ab4be21"
              className="font-mono text-xs"
            />
            <Button onClick={() => setDiagnoseLoadId(loadIdInput.trim() || null)} disabled={!loadIdInput.trim()}>
              Diagnose
            </Button>
          </div>

          {diagnoseLoading && diagnoseLoadId && <div className="text-sm text-muted-foreground">Checking…</div>}

          {diagnose && (
            <div className="space-y-3 mt-4">
              <div
                className={`p-3 rounded-md border ${
                  diagnose.wouldDispatch ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"
                }`}
              >
                <div className="font-medium">
                  {diagnose.wouldDispatch
                    ? "✅ Dispatch would succeed if you click Approve & Dispatch"
                    : "❌ Dispatch would fail — see findings below"}
                </div>
                {diagnose.load && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Load #{diagnose.load.loadNumber} {diagnose.load.brokerName && `· ${diagnose.load.brokerName}`}
                  </div>
                )}
                {diagnose.driver && (
                  <div className="text-xs text-muted-foreground">
                    Driver: {diagnose.driver.name} · {diagnose.driver.phone ?? "no phone"}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {diagnose.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-md border bg-card">
                    <StatusIcon ok={f.ok} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{f.name}</div>
                      <div className="text-xs text-muted-foreground mt-1 break-words">{f.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
