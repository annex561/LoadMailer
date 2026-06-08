import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGE_LABEL: Record<string, string> = {
  LEAD: "Lead Captured",
  APPLIED: "Application Submitted",
  PRESCREENED_PASS: "Pre-Screening Passed",
  PRESCREENED_FAIL: "Not Approved",
  DOCS_REQUESTED: "Documents Needed",
  DOCS_RECEIVED: "Documents Received",
  BACKGROUND_RUNNING: "Background Check In Progress",
  BACKGROUND_PASS: "Background Cleared",
  BACKGROUND_FAIL: "Background Not Cleared",
  MEDICAL_REQUESTED: "Drug Test + Physical Scheduled",
  MEDICAL_PASS: "Medical Cleared",
  MEDICAL_FAIL: "Medical Not Cleared",
  AGREEMENT_SIGNED: "Agreement Signed",
  ORIENTATION: "Orientation In Progress",
  ORIENTATION_DONE: "Orientation Complete",
  TRUCK_ASSIGNED: "Truck Assigned",
  ACTIVE: "Active Driver",
  TERMINATED: "Terminated",
  DISQUALIFIED: "Disqualified",
};

const FUNNEL_STAGES = [
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

const STAGE_ORDER: Record<string, number> = {
  LEAD: 1, APPLIED: 2, PRESCREENED_PASS: 3, DOCS_REQUESTED: 4, DOCS_RECEIVED: 5,
  BACKGROUND_RUNNING: 6, BACKGROUND_PASS: 7, MEDICAL_REQUESTED: 8, MEDICAL_PASS: 9,
  AGREEMENT_SIGNED: 10, ORIENTATION: 11, ORIENTATION_DONE: 12, TRUCK_ASSIGNED: 13, ACTIVE: 14,
};

const DEAD_END = ["PRESCREENED_FAIL", "BACKGROUND_FAIL", "MEDICAL_FAIL", "DISQUALIFIED", "TERMINATED"];

export default function RecruitingStatus() {
  const [, params] = useRoute<{ id: string }>("/apply/:id/status");
  const id = params?.id;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/recruiting/applications/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <main className="force-light-theme min-h-screen flex items-center justify-center text-slate-500 bg-white" style={{ colorScheme: "light" }}>
        Loading…
      </main>
    );
  }
  if (error || !data?.application) {
    return (
      <main className="force-light-theme min-h-screen flex items-center justify-center bg-white text-slate-900" style={{ colorScheme: "light" }}>
        <p className="text-red-600">{error || "Application not found"}</p>
      </main>
    );
  }

  const app = data.application;
  const isDead = DEAD_END.includes(app.currentStage);
  const reasons: string[] = app.prescreenReasons || [];

  return (
    <main className="force-light-theme min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a href="/drive-with-lamp" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white font-bold text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="font-bold text-lg leading-tight text-slate-900">LAMP Logistics</div>
              <div className="text-xs text-slate-500 leading-tight">Driver Portal</div>
            </div>
          </a>
          <Badge variant={isDead ? "destructive" : "default"} className="text-xs">
            {STAGE_LABEL[app.currentStage] || app.currentStage}
          </Badge>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <Card>
          <CardContent className="p-8">
            <h1 className="text-2xl font-bold">
              {app.firstName}, here&apos;s where you are
            </h1>

            {/* Progress strip */}
            <div className="mt-8 grid gap-2 grid-cols-2 sm:grid-cols-5">
              {FUNNEL_STAGES.map((stage) => {
                const currentN = STAGE_ORDER[app.currentStage] ?? 0;
                const targetN = Math.min(...stage.matches.map((m) => STAGE_ORDER[m] ?? 99));
                const passed = currentN > targetN;
                const current = stage.matches.includes(app.currentStage);
                return (
                  <div
                    key={stage.key}
                    className={`rounded-lg border-2 px-3 py-2 text-xs ${
                      current
                        ? "border-emerald-500 bg-emerald-50"
                        : passed
                          ? "border-emerald-200 bg-emerald-50/30"
                          : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="font-bold">{stage.label}</div>
                    <div className="text-slate-500 mt-0.5">
                      {current ? "current" : passed ? "✓ done" : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stage-specific messaging */}
            <div className="mt-8 rounded-lg border bg-slate-50 p-5">
              {app.currentStage === "APPLIED" && (
                <>
                  <h3 className="font-bold">Application received</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Thanks for completing your application. We&apos;re reviewing it now. If you pass
                    pre-screening, we&apos;ll text you within 24 hours with next steps.
                  </p>
                </>
              )}
              {app.currentStage === "DOCS_REQUESTED" && (
                <>
                  <h3 className="font-bold text-emerald-700">
                    You passed pre-screening — please upload your documents
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Driver license, SSN card, voided check, and any current DOT medical card. Use
                    your phone&apos;s camera.
                  </p>
                </>
              )}
              {app.currentStage === "BACKGROUND_RUNNING" && (
                <>
                  <h3 className="font-bold">Background check in progress</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Typically 24-72 hours. We&apos;ll text you the moment it clears.
                  </p>
                </>
              )}
              {app.currentStage === "MEDICAL_REQUESTED" && (
                <>
                  <h3 className="font-bold">Drug test and DOT physical scheduled</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Check your email for the appointment confirmation. Bring photo ID. We pay.
                  </p>
                </>
              )}
              {app.currentStage === "ACTIVE" && (
                <>
                  <h3 className="font-bold text-emerald-700">Active driver — welcome</h3>
                  <p className="mt-1 text-sm text-slate-700">
                    You&apos;re live. Loads will appear in TraqIQ. First settlement Friday.
                  </p>
                </>
              )}
              {app.currentStage === "PRESCREENED_FAIL" && (
                <>
                  <h3 className="font-bold text-red-700">
                    Application not approved at this time
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Based on the information you provided, we can&apos;t move forward right now.
                  </p>
                  {reasons.length > 0 && (
                    <ul className="mt-2 list-disc list-inside text-sm text-slate-600">
                      {reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  <p className="mt-3 text-sm text-slate-600">
                    You may reapply in 12 months. Questions: recruit@lamplogistics.com.
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {data.events?.length > 0 && (
          <Card>
            <CardContent className="p-8">
              <h2 className="text-lg font-bold">Your Timeline</h2>
              <div className="mt-4 space-y-3">
                {data.events.slice().reverse().map((e: any, i: number) => (
                  <div key={i} className="border-l-2 border-slate-200 pl-4 py-1">
                    <div className="text-sm font-medium">
                      {STAGE_LABEL[e.toStage] || e.toStage}
                    </div>
                    {e.reason && <div className="text-xs text-slate-500">{e.reason}</div>}
                    <div className="text-xs text-slate-400">
                      {new Date(e.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-sm text-slate-500">
          Questions? Email recruit@lamplogistics.com
        </div>
      </div>
    </main>
  );
}
