import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Users, CheckCircle, XCircle, Clock } from "lucide-react";

type Application = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  isOwnerOperator: boolean | null;
  yearsExperience: number | null;
  currentStage: string;
  prescreenStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

const STAGE_LABEL: Record<string, string> = {
  LEAD: "Lead", APPLIED: "Application",
  PRESCREENED_PASS: "Pre-Screen Pass", PRESCREENED_FAIL: "Pre-Screen Fail",
  DOCS_REQUESTED: "Docs Requested", DOCS_RECEIVED: "Docs Received",
  BACKGROUND_RUNNING: "Background Running", BACKGROUND_PASS: "Background Pass", BACKGROUND_FAIL: "Background Fail",
  MEDICAL_REQUESTED: "Medical Scheduled", MEDICAL_PASS: "Medical Pass", MEDICAL_FAIL: "Medical Fail",
  AGREEMENT_SIGNED: "Agreement Signed",
  ORIENTATION: "Orientation", ORIENTATION_DONE: "Orientation Done",
  TRUCK_ASSIGNED: "Truck Assigned",
  ACTIVE: "Active",
  TERMINATED: "Terminated", DISQUALIFIED: "Disqualified",
};

const FUNNEL_GROUPS = [
  { key: "lead", label: "1. Lead", matches: ["LEAD"] },
  { key: "application", label: "2. Application", matches: ["APPLIED"] },
  { key: "prescreen", label: "3. Pre-Screen", matches: ["PRESCREENED_PASS"] },
  { key: "documents", label: "4. Documents", matches: ["DOCS_REQUESTED", "DOCS_RECEIVED"] },
  { key: "background", label: "5. Background", matches: ["BACKGROUND_RUNNING", "BACKGROUND_PASS"] },
  { key: "medical", label: "6. Drug/Physical", matches: ["MEDICAL_REQUESTED", "MEDICAL_PASS"] },
  { key: "agreement", label: "7. Lease/W-2", matches: ["AGREEMENT_SIGNED"] },
  { key: "orientation", label: "8. Orientation", matches: ["ORIENTATION", "ORIENTATION_DONE"] },
  { key: "truck", label: "9. Truck Assigned", matches: ["TRUCK_ASSIGNED"] },
  { key: "active", label: "10. Active", matches: ["ACTIVE"] },
];

const DEAD_END = ["PRESCREENED_FAIL", "BACKGROUND_FAIL", "MEDICAL_FAIL", "DISQUALIFIED", "TERMINATED"];

function stageColor(s: string) {
  if (s === "ACTIVE") return "bg-emerald-100 text-emerald-800";
  if (DEAD_END.includes(s)) return "bg-red-100 text-red-800";
  if (s === "LEAD" || s === "APPLIED") return "bg-blue-100 text-blue-800";
  if (s.includes("DOCS")) return "bg-amber-100 text-amber-800";
  if (s.includes("BACKGROUND")) return "bg-orange-100 text-orange-800";
  if (s.includes("MEDICAL")) return "bg-cyan-100 text-cyan-800";
  return "bg-slate-100 text-slate-800";
}

function relativeTime(d: string) {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function RecruitingDashboard() {
  const { toast } = useToast();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/recruiting/applications", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.applications) setApps(d.applications);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered =
    filter === "all"
      ? apps
      : filter === "active"
        ? apps.filter((a) => a.currentStage === "ACTIVE")
        : filter === "dead"
          ? apps.filter((a) => DEAD_END.includes(a.currentStage))
          : filter === "live"
            ? apps.filter((a) => !DEAD_END.includes(a.currentStage) && a.currentStage !== "ACTIVE")
            : apps;

  const counts = {
    total: apps.length,
    active: apps.filter((a) => a.currentStage === "ACTIVE").length,
    dead: apps.filter((a) => DEAD_END.includes(a.currentStage)).length,
    live: apps.filter((a) => !DEAD_END.includes(a.currentStage) && a.currentStage !== "ACTIVE").length,
  };

  const stageCounts: Record<string, number> = {};
  for (const g of FUNNEL_GROUPS) {
    stageCounts[g.key] = apps.filter((a) => g.matches.includes(a.currentStage)).length;
  }

  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}/drive-with-lamp`
      : "/drive-with-lamp";

  const copyUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    toast({ title: "Copied", description: publicUrl });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Driver Recruiting Funnel</h1>
          <p className="text-slate-600 mt-1">
            All applicants from public landing page to active driver. Powered by TraqIQ.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Public Application Link — Share With Drivers
            </span>
            <div className="flex items-center gap-2 rounded-lg border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm">
              <code className="text-sm font-mono font-semibold text-emerald-900 dark:text-emerald-100 bg-white dark:bg-slate-900 px-3 py-1.5 rounded border border-emerald-200 dark:border-emerald-800 select-all">
                {publicUrl}
              </code>
              <Button
                size="sm"
                variant="default"
                onClick={copyUrl}
                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 px-3 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-sm font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <StatTile icon={<Users className="h-5 w-5" />} label="Total" value={counts.total} />
        <StatTile icon={<Clock className="h-5 w-5" />} label="In Funnel" value={counts.live} color="text-blue-700" />
        <StatTile icon={<CheckCircle className="h-5 w-5" />} label="Active" value={counts.active} color="text-emerald-700" />
        <StatTile icon={<XCircle className="h-5 w-5" />} label="Dead End" value={counts.dead} color="text-slate-600" />
      </div>

      {/* Funnel breakdown */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-bold mb-4">Funnel Breakdown</h2>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-5 lg:grid-cols-10">
            {FUNNEL_GROUPS.map((g) => (
              <div key={g.key} className="rounded-lg border p-3">
                <div className="text-xs text-slate-500">{g.label}</div>
                <div className="text-2xl font-bold mt-1">{stageCounts[g.key]}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { k: "all", label: `All (${counts.total})` },
          { k: "live", label: `Live (${counts.live})` },
          { k: "active", label: `Active (${counts.active})` },
          { k: "dead", label: `Dead End (${counts.dead})` },
        ].map((p) => (
          <Button
            key={p.k}
            size="sm"
            variant={filter === p.k ? "default" : "outline"}
            onClick={() => setFilter(p.k)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Applicants table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-slate-500">Loading applications…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-slate-500">No applications yet in this view.</p>
              <p className="text-sm text-slate-400 mt-2">
                Share the public link above to start collecting driver applications.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-left text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">Name</th>
                    <th className="px-4">Phone</th>
                    <th className="px-4">Type</th>
                    <th className="px-4">Exp.</th>
                    <th className="px-4">Stage</th>
                    <th className="px-4">Updated</th>
                    <th className="px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium">
                        {a.firstName} {a.lastName}
                        <div className="text-xs text-slate-500">{a.email}</div>
                      </td>
                      <td className="px-4 text-slate-600">{a.phone}</td>
                      <td className="px-4 text-slate-600">
                        {a.isOwnerOperator === null ? "—" : a.isOwnerOperator ? "Owner-Op" : "Company"}
                      </td>
                      <td className="px-4 text-slate-600">
                        {a.yearsExperience === null ? "—" : `${a.yearsExperience}y`}
                      </td>
                      <td className="px-4">
                        <Badge className={`${stageColor(a.currentStage)} font-medium`}>
                          {STAGE_LABEL[a.currentStage] || a.currentStage}
                        </Badge>
                      </td>
                      <td className="px-4 text-slate-500 text-xs">{relativeTime(a.updatedAt)}</td>
                      <td className="px-4">
                        <Link href={`/apply/${a.id}/status`}>
                          <span className="text-emerald-600 hover:text-emerald-700 hover:underline text-xs font-semibold cursor-pointer">
                            View →
                          </span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  color = "text-slate-900",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            {icon}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
