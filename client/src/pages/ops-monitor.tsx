import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface OpsSnapshot {
  ok: boolean;
  gmailLastScan: string | null;
  parserLastSuccess: string | null;
  parserRunsLastHour: number;
  parserFailureRatePct: number;
  alertPhone: string;
  activeCooldowns: string[];
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function statusFor(snap: OpsSnapshot): {
  gmail: "ok" | "warn" | "down";
  parser: "ok" | "warn" | "down";
} {
  const gmailAge = snap.gmailLastScan
    ? Date.now() - new Date(snap.gmailLastScan).getTime()
    : Infinity;
  const gmail: "ok" | "warn" | "down" =
    gmailAge < 5 * 60_000 ? "ok" : gmailAge < 15 * 60_000 ? "warn" : "down";

  const parser: "ok" | "warn" | "down" =
    snap.parserFailureRatePct < 25
      ? "ok"
      : snap.parserFailureRatePct < 50
      ? "warn"
      : "down";

  return { gmail, parser };
}

function Dot({ status }: { status: "ok" | "warn" | "down" }) {
  const color =
    status === "ok" ? "bg-green-500" : status === "warn" ? "bg-yellow-500" : "bg-red-500";
  return <span className={`inline-block h-3 w-3 rounded-full ${color}`} />;
}

export default function OpsMonitor() {
  const { toast } = useToast();

  const { data: snap, isLoading, refetch } = useQuery<OpsSnapshot>({
    queryKey: ["/api/ops/snapshot"],
    refetchInterval: 15000,
  });

  const testAlert = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ops/test-alert", { method: "POST" });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.ok ? "Test alert sent" : "Test alert failed",
        description: data.ok
          ? `SMS dispatched to ${data.phone}`
          : data.error || "Unknown error",
        variant: data.ok ? "default" : "destructive",
      });
    },
  });

  if (isLoading || !snap) {
    return <div className="p-6">Loading ops snapshot…</div>;
  }

  const status = statusFor(snap);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ops Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Live health of Gmail scanner, parser, and dispatch pipeline. Alerts to{" "}
            <span className="font-mono">{snap.alertPhone}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button
            onClick={() => testAlert.mutate()}
            disabled={testAlert.isPending}
          >
            {testAlert.isPending ? "Sending…" : "Send Test Alert"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Dot status={status.gmail} /> Gmail Scanner
            </CardTitle>
            <CardDescription>Should tick every ~1 min</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <div>
                Last scan: <span className="font-medium">{ago(snap.gmailLastScan)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {snap.gmailLastScan || "no scans recorded yet"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Dot status={status.parser} /> RateCon Parser
            </CardTitle>
            <CardDescription>OpenAI + regex fallback</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              <div>
                Runs (last hr):{" "}
                <span className="font-medium">{snap.parserRunsLastHour}</span>
              </div>
              <div>
                Failure rate:{" "}
                <span className="font-medium">{snap.parserFailureRatePct}%</span>
              </div>
              <div>
                Last success:{" "}
                <span className="font-medium">{ago(snap.parserLastSuccess)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Alert Cooldowns</CardTitle>
          <CardDescription>
            Each alert key cools down 60 minutes after firing
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snap.activeCooldowns.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active cooldowns — all clear.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {snap.activeCooldowns.map((k) => (
                <Badge key={k} variant="destructive">
                  {k}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
