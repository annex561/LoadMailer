import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, Stethoscope, RefreshCw, Phone, Send } from "lucide-react";

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

interface TwilioProbeResponse {
  ok: boolean;
  isTrial?: boolean;
  account?: { sid?: string; friendlyName?: string; type?: string; status?: string; error?: string };
  balance?: { currency?: string; balance?: string; error?: string };
  recentMessages?: Array<{
    sid: string;
    to: string;
    from: string;
    status: string;
    errorCode: number | null;
    errorMessage: string | null;
    dateSent: string | null;
    body?: string;
  }> | { error: string };
  summary?: {
    total: number;
    failed: number;
    statuses: Record<string, number>;
    commonErrorCodes: number[];
  };
  hints?: string[];
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

  const [testPhoneInput, setTestPhoneInput] = useState("+16602290858");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; messageSid?: string; error?: string } | null>(null);
  const [diagSending, setDiagSending] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    ok?: boolean;
    loadNumber?: string;
    withUrl?: { ok: boolean; messageSid?: string; error?: string; body?: string };
    withProdUrl?: { ok: boolean; messageSid?: string; error?: string; body?: string };
    noUrl?: { ok: boolean; messageSid?: string; error?: string; body?: string };
    error?: string;
  } | null>(null);
  const [probeEnabled, setProbeEnabled] = useState(false);
  const { data: probe, isFetching: probeFetching, refetch: refetchProbe } =
    useQuery<TwilioProbeResponse>({
      queryKey: ["/api/admin/twilio-probe"],
      enabled: probeEnabled,
      staleTime: 0,
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

      {/* Test SMS to arbitrary number — for isolating per-recipient carrier blocks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Send test SMS to any number
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sends the standard test dispatch body (matches your TCR Sample #1) to whatever number
            you enter. Use this to isolate per-recipient carrier blocks: if your dispatcher number
            keeps getting 30007 but a different recipient delivers, the block is per-recipient and
            real drivers will work fine.
          </p>
          <div className="flex gap-2">
            <Input
              value={testPhoneInput}
              onChange={(e) => setTestPhoneInput(e.target.value)}
              placeholder="+16602290858"
              className="font-mono text-sm"
            />
            <Button
              onClick={async () => {
                setTestSending(true);
                setTestResult(null);
                try {
                  const r = await fetch("/api/admin/test-dispatch/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ phone: testPhoneInput.trim() }),
                  });
                  setTestResult(await r.json());
                  // Wait 3s then re-probe so the new message shows up in the list
                  setProbeEnabled(true);
                  setTimeout(() => refetchProbe(), 3000);
                } catch (e: any) {
                  setTestResult({ ok: false, error: e?.message ?? String(e) });
                } finally {
                  setTestSending(false);
                }
              }}
              disabled={!testPhoneInput.trim() || testSending}
            >
              {testSending ? "Sending…" : "Send test"}
            </Button>
          </div>
          {testResult && (
            <div
              className={`p-3 rounded-md border text-sm ${
                testResult.ok
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-red-500/40 bg-red-500/5"
              }`}
            >
              <div className="font-medium">
                {testResult.ok ? "✅ Twilio accepted the message" : "❌ Twilio rejected the message"}
              </div>
              {testResult.messageSid && (
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  SID: {testResult.messageSid}
                </div>
              )}
              {testResult.error && (
                <div className="text-xs text-red-500 mt-1">{testResult.error}</div>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                Auto-reprobing Twilio in 3 sec to check delivery status…
              </div>
            </div>
          )}

          {/* URL diagnostic — fires two messages with body identical except for the URL */}
          <div className="mt-6 pt-6 border-t">
            <div className="font-semibold text-sm mb-1">URL filter diagnostic (Twilio T&S request)</div>
            <p className="text-xs text-muted-foreground mb-3">
              Per Twilio T&S ticket #26735656: fires three sends to the recipient above. Bodies
              are identical except for the URL line: (1) WITH "test-" prefix URL — what the test
              endpoint currently emits, (2) WITH production-style URL — what real loads actually
              send (no "test-" prefix), (3) WITHOUT URL. If only (2) and (3) deliver, real
              production traffic will work as-is and only the test endpoint needs cleanup.
            </p>
            <Button
              variant="outline"
              onClick={async () => {
                setDiagSending(true);
                setDiagResult(null);
                try {
                  const r = await fetch("/api/admin/test-dispatch/url-diagnostic", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ phone: testPhoneInput.trim() }),
                  });
                  setDiagResult(await r.json());
                  setProbeEnabled(true);
                  setTimeout(() => refetchProbe(), 8000);
                } catch (e: any) {
                  setDiagResult({ error: e?.message ?? String(e) });
                } finally {
                  setDiagSending(false);
                }
              }}
              disabled={!testPhoneInput.trim() || diagSending}
            >
              {diagSending ? "Sending triple…" : "Run URL diagnostic (3 sends)"}
            </Button>

            {diagResult && (
              <div className="mt-3 space-y-2">
                {diagResult.error && (
                  <div className="p-3 rounded-md border border-red-500/40 bg-red-500/5 text-sm text-red-500">
                    {diagResult.error}
                  </div>
                )}
                {diagResult.withUrl && (
                  <div
                    className={`p-3 rounded-md border text-sm ${
                      diagResult.withUrl.ok
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-red-500/40 bg-red-500/5"
                    }`}
                  >
                    <div className="font-medium">
                      WITH "test-" URL (current test endpoint) — {diagResult.withUrl.ok ? "✅ Twilio accepted" : "❌ Twilio rejected"}
                    </div>
                    {diagResult.withUrl.messageSid && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        SID: {diagResult.withUrl.messageSid}
                      </div>
                    )}
                    {diagResult.withUrl.error && (
                      <div className="text-xs text-red-500 mt-1">{diagResult.withUrl.error}</div>
                    )}
                  </div>
                )}
                {diagResult.withProdUrl && (
                  <div
                    className={`p-3 rounded-md border text-sm ${
                      diagResult.withProdUrl.ok
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-red-500/40 bg-red-500/5"
                    }`}
                  >
                    <div className="font-medium">
                      WITH production-style URL (no "test-" prefix) — {diagResult.withProdUrl.ok ? "✅ Twilio accepted" : "❌ Twilio rejected"}
                    </div>
                    {diagResult.withProdUrl.messageSid && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        SID: {diagResult.withProdUrl.messageSid}
                      </div>
                    )}
                    {diagResult.withProdUrl.error && (
                      <div className="text-xs text-red-500 mt-1">{diagResult.withProdUrl.error}</div>
                    )}
                  </div>
                )}
                {diagResult.noUrl && (
                  <div
                    className={`p-3 rounded-md border text-sm ${
                      diagResult.noUrl.ok
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-red-500/40 bg-red-500/5"
                    }`}
                  >
                    <div className="font-medium">
                      {diagResult.noUrl.ok ? "✅ WITHOUT URL — Twilio accepted" : "❌ WITHOUT URL — Twilio rejected"}
                    </div>
                    {diagResult.noUrl.messageSid && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        SID: {diagResult.noUrl.messageSid}
                      </div>
                    )}
                    {diagResult.noUrl.error && (
                      <div className="text-xs text-red-500 mt-1">{diagResult.noUrl.error}</div>
                    )}
                  </div>
                )}
                {diagResult.withUrl && diagResult.noUrl && (
                  <div className="p-3 rounded-md border border-amber-500/40 bg-amber-500/5 text-xs">
                    <div className="font-semibold mb-1">Next step:</div>
                    <div className="text-muted-foreground">
                      Wait ~30 sec, click <strong>Re-probe Twilio</strong> below, then look for all three SIDs in the
                      Last 10 messages list. The pattern that delivers tells us the fix. Reply to Danny on ticket
                      #26735656 with all SIDs and statuses.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Twilio-side probe — fetches real status from Twilio API */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Twilio carrier probe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hits the Twilio API and shows the truth about your account: Trial vs Full,
            balance, and the actual delivery status of the last 10 messages — including
            carrier error codes (30007 = filtered, 21610 = STOP'd, etc). This is the
            answer to "the API said it sent but the driver got nothing."
          </p>
          <Button
            onClick={() => {
              if (!probeEnabled) setProbeEnabled(true);
              else refetchProbe();
            }}
            disabled={probeFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${probeFetching ? "animate-spin" : ""}`} />
            {probeEnabled ? "Re-probe Twilio" : "Probe Twilio now"}
          </Button>

          {probe && (
            <div className="space-y-3 mt-4">
              {probe.isTrial && (
                <div className="p-3 rounded-md border border-red-500/40 bg-red-500/10">
                  <div className="font-bold text-red-600 dark:text-red-400">
                    🚨 Trial account detected — this is why SMS is failing
                  </div>
                  <div className="text-sm mt-1">
                    Trial Twilio accounts cannot send via 10DLC. Every send returns 30007. Upgrade at{" "}
                    <a
                      href="https://console.twilio.com/billing/manage-billing/upgrade"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                    >
                      console.twilio.com/billing
                    </a>
                    .
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-xs text-muted-foreground">Account type</div>
                  <div className={`font-mono text-sm ${probe.isTrial ? "text-red-500" : "text-emerald-500"}`}>
                    {probe.account?.type ?? probe.account?.error ?? "?"}
                  </div>
                </div>
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="font-mono text-sm">
                    {probe.balance?.balance
                      ? `${probe.balance.balance} ${probe.balance.currency}`
                      : probe.balance?.error ?? "?"}
                  </div>
                </div>
              </div>

              {probe.summary && (
                <div className="p-3 rounded-md border bg-card">
                  <div className="text-xs text-muted-foreground">Last 10 messages</div>
                  <div className="text-sm mt-1">
                    {probe.summary.failed > 0 ? (
                      <span className="text-red-500 font-medium">
                        {probe.summary.failed}/{probe.summary.total} failed
                      </span>
                    ) : (
                      <span className="text-emerald-500 font-medium">
                        all {probe.summary.total} OK
                      </span>
                    )}
                    {probe.summary.commonErrorCodes.length > 0 && (
                      <span className="ml-2 text-muted-foreground">
                        (error codes: {probe.summary.commonErrorCodes.join(", ")})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Statuses: {Object.entries(probe.summary.statuses).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </div>
                </div>
              )}

              {probe.hints && probe.hints.length > 0 && (
                <div className="p-3 rounded-md border border-amber-500/40 bg-amber-500/5 space-y-1">
                  <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">Diagnosis</div>
                  {probe.hints.map((h, i) => (
                    <div key={i} className="text-sm">{h}</div>
                  ))}
                </div>
              )}

              {Array.isArray(probe.recentMessages) && (
                <div className="space-y-1 max-h-96 overflow-auto">
                  {probe.recentMessages.map((m) => (
                    <div key={m.sid} className="p-2 rounded border bg-card font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span>{m.dateSent ? new Date(m.dateSent).toLocaleString() : "—"}</span>
                        <Badge
                          variant={m.errorCode ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {m.status}
                          {m.errorCode ? ` · ${m.errorCode}` : ""}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        {m.from} → {m.to}
                      </div>
                      {m.errorMessage && (
                        <div className="text-red-500 mt-1">{m.errorMessage}</div>
                      )}
                      {m.body && <div className="text-muted-foreground mt-1 truncate">{m.body}</div>}
                    </div>
                  ))}
                </div>
              )}
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
