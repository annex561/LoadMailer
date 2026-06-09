import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  Clock,
  FileText,
  Stethoscope,
  Shield,
  Truck,
  UserPlus,
  AlertTriangle,
} from "lucide-react";

const STAGES = [
  "LEAD","APPLIED","PRESCREENED_PASS","PRESCREENED_FAIL","DOCS_REQUESTED","DOCS_RECEIVED",
  "BACKGROUND_RUNNING","BACKGROUND_PASS","BACKGROUND_FAIL","MEDICAL_REQUESTED","MEDICAL_PASS",
  "MEDICAL_FAIL","AGREEMENT_SIGNED","ORIENTATION","ORIENTATION_DONE","TRUCK_ASSIGNED","ACTIVE",
  "TERMINATED","DISQUALIFIED",
];

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

function fmtDate(d: any) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export default function RecruiterApplicant() {
  const [, params] = useRoute<{ id: string }>("/recruiting/:id");
  const id = params?.id;
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [truckUnit, setTruckUnit] = useState("");

  const refresh = async () => {
    if (!id) return;
    try {
      const [fullRes, notesRes] = await Promise.all([
        fetch(`/api/recruiting/applications/${id}/full`, { credentials: "include" }),
        fetch(`/api/recruiting/applications/${id}/notes`, { credentials: "include" }),
      ]);
      const full = await fullRes.json();
      const n = await notesRes.json();
      if (fullRes.ok) setData(full);
      if (notesRes.ok) setNotes(n.notes || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
  }, [id]);

  async function callAction(label: string, url: string, body?: any) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast({ title: label, description: "Success" });
      await refresh();
      return json;
    } catch (err) {
      toast({
        title: `${label} failed`,
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function manualStage(toStage: string) {
    if (!id) return;
    const reason = window.prompt(`Reason for moving to "${STAGE_LABEL[toStage] || toStage}"?`);
    if (reason === null) return;
    setBusy("Manual stage override");
    try {
      const res = await fetch(`/api/recruiting/applications/${id}/stage`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage, reason }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Failed");
      }
      toast({ title: "Stage updated" });
      await refresh();
    } catch (err) {
      toast({
        title: "Stage update failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    if (!id || !newNote.trim()) return;
    try {
      const res = await fetch(`/api/recruiting/applications/${id}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNote.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      setNewNote("");
      await refresh();
      toast({ title: "Note saved" });
    } catch (err) {
      toast({ title: "Could not save note", variant: "destructive" });
    }
  }

  if (!id) return <div className="p-6">Invalid URL</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading applicant…</div>;

  const app = data.application;
  const docs: any[] = data.documents || [];
  const screenings: any[] = data.screenings || [];
  const medical: any[] = data.medical || [];
  const events: any[] = data.events || [];

  const employmentHistory = parseJson(app.employmentHistory) || [];
  const accidents = parseJson(app.accidents3yr) || [];
  const violations = parseJson(app.violations3yr) || [];

  // Recommended next action based on stage
  const nextAction = (() => {
    switch (app.currentStage) {
      case "DOCS_RECEIVED":
        return {
          label: "Start Background Check",
          icon: <Shield className="h-4 w-4" />,
          run: () => callAction("Background Check", `/api/recruiting/applications/${id}/screenings/run`),
        };
      case "BACKGROUND_PASS":
        return {
          label: "Schedule Drug Test + Physical",
          icon: <Stethoscope className="h-4 w-4" />,
          run: () => callAction("Schedule Medical", `/api/recruiting/applications/${id}/medical/schedule`),
        };
      case "MEDICAL_REQUESTED":
        return {
          label: "Mark Medical Complete (Pass)",
          icon: <CheckCircle2 className="h-4 w-4" />,
          run: () => callAction("Complete Medical", `/api/recruiting/applications/${id}/medical/complete`, { passed: true }),
        };
      case "MEDICAL_PASS":
        return {
          label: "Send Lease/W-2 for Signature",
          icon: <FileText className="h-4 w-4" />,
          run: () => callAction("Send for Signature", `/api/recruiting/applications/${id}/sign-request`),
        };
      case "AGREEMENT_SIGNED":
        return {
          label: "Start Orientation",
          icon: <FileText className="h-4 w-4" />,
          run: () => manualStage("ORIENTATION"),
        };
      case "ORIENTATION":
        return {
          label: "Mark Orientation Complete",
          icon: <CheckCircle2 className="h-4 w-4" />,
          run: () => callAction("Complete Orientation", `/api/recruiting/applications/${id}/orientation/complete`),
        };
      case "ORIENTATION_DONE":
        return null; // truck assignment uses its own form below
      case "TRUCK_ASSIGNED":
        return {
          label: "Promote to Active Driver",
          icon: <UserPlus className="h-4 w-4" />,
          run: () => callAction("Promote to Active", `/api/recruiting/applications/${id}/activate`),
        };
      default:
        return null;
    }
  })();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/recruiting">
            <a className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-600">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Funnel
            </a>
          </Link>
          <h1 className="text-3xl font-bold mt-2">
            {app.firstName} {app.lastName}
          </h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              {app.phone}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {app.email}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Badge className="text-sm">{STAGE_LABEL[app.currentStage] || app.currentStage}</Badge>
            <span className="text-xs text-slate-500">
              Type: {app.isOwnerOperator === null ? "—" : app.isOwnerOperator ? "Owner-Operator" : "Company Driver"}
            </span>
            <span className="text-xs text-slate-500">
              {app.yearsExperience !== null ? `· ${app.yearsExperience} yrs exp` : ""}
            </span>
          </div>
        </div>

        {/* PRIMARY ACTION */}
        {nextAction && (
          <Button
            disabled={busy !== null}
            onClick={nextAction.run}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            size="lg"
          >
            {nextAction.icon}
            <span className="ml-2">{busy === nextAction.label ? "Working…" : nextAction.label} →</span>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT — Applicant data */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold mb-4">Applicant Data</h2>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <Field label="Date of Birth">{fmtDate(app.dob)}</Field>
                <Field label="SSN (last 4)">{app.ssn || "—"}</Field>
                <Field label="Driver License">
                  {app.driverLicenseClass} · {app.driverLicenseNumber} · {app.driverLicenseState}
                </Field>
                <Field label="License Expiration">{fmtDate(app.driverLicenseExpiration)}</Field>
                <Field label="Current Address" wide>
                  {app.currentAddress}, {app.currentCity}, {app.currentState} {app.currentZip}
                </Field>
                <Field label="Pre-Screen Status">
                  <span
                    className={
                      app.prescreenStatus === "PASS"
                        ? "text-emerald-700 font-semibold"
                        : app.prescreenStatus === "FAIL"
                          ? "text-red-700 font-semibold"
                          : "text-slate-700"
                    }
                  >
                    {app.prescreenStatus || "—"}
                  </span>
                </Field>
                <Field label="License Issues">
                  Suspension/Revocation: {app.licenseSuspensionRevocation ? "Yes" : "No"} ·
                  Denied: {app.licenseDenialEver ? "Yes" : "No"}
                </Field>
                <Field label="DOT Test History">
                  Drug: {app.failedDotDrugTestEver ? "Failed" : "Clean"} ·
                  Alcohol: {app.failedDotAlcoholTestEver ? "Failed" : "Clean"}
                </Field>
                <Field label="Felony">
                  {app.felonyConviction ? `Yes — ${app.felonyExplanation || "no explanation"}` : "No"}
                </Field>
                <Field label="Work Authorized">{app.authorizedToWorkInUs ? "Yes" : "No"}</Field>
              </div>
            </CardContent>
          </Card>

          {Array.isArray(app.prescreenReasons) && app.prescreenReasons.length > 0 && (
            <Card>
              <CardContent className="p-6 border-l-4 border-red-500">
                <h2 className="text-lg font-bold text-red-900 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" /> Pre-Screen Flagged
                </h2>
                <ul className="mt-3 list-disc list-inside text-sm text-red-800 space-y-1">
                  {app.prescreenReasons.map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {employmentHistory.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-bold mb-4">Employment History (49 CFR 391.21)</h2>
                <div className="space-y-3">
                  {employmentHistory.map((e: any, i: number) => (
                    <div key={i} className="rounded-lg border p-4 text-sm">
                      <div className="font-semibold">{e.employer}</div>
                      <div className="text-slate-600">
                        {e.position} · {e.fromDate} to {e.toDate} ·{" "}
                        {e.wasDOT ? "DOT-regulated" : "Non-DOT"}
                      </div>
                      <div className="text-slate-600 mt-1 text-xs">
                        Reason: {e.reasonForLeaving}
                      </div>
                      {(e.supervisor || e.supervisorPhone) && (
                        <div className="text-slate-500 mt-1 text-xs">
                          Supervisor: {e.supervisor} {e.supervisorPhone && `· ${e.supervisorPhone}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Documents */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5" /> Documents ({docs.length})
              </h2>
              {docs.length === 0 ? (
                <div className="text-sm text-slate-500">No documents uploaded yet.</div>
              ) : (
                <div className="grid gap-2">
                  {docs.map((d: any) => (
                    <div
                      key={d.id}
                      className="rounded-lg border p-3 flex items-center justify-between text-sm gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{d.type}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {d.filename} · {(d.sizeBytes / 1024).toFixed(0)} KB · {fmtDate(d.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {d.verified ? (
                          <Badge className="bg-emerald-100 text-emerald-800">✓ Verified</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">
                            Pending
                          </Badge>
                        )}
                        {d.storagePath && (
                          <a
                            href={d.storagePath}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-emerald-700 hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Screenings */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Shield className="h-5 w-5" /> Background Screenings ({screenings.length})
              </h2>
              {screenings.length === 0 ? (
                <div className="text-sm text-slate-500">
                  No screenings run yet. Use the recommended action to start.
                </div>
              ) : (
                <div className="grid gap-2">
                  {screenings.map((s: any) => (
                    <div key={s.id} className="rounded-lg border p-3 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{s.kind}</div>
                        <div className="text-xs text-slate-500">{s.vendor} · {fmtDate(s.createdAt)}</div>
                      </div>
                      <Badge
                        className={
                          s.status === "CLEAN" || s.status === "NOT_PROHIBITED" || s.status === "CLEAR" || s.status === "PASS"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }
                      >
                        {s.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Medical */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Stethoscope className="h-5 w-5" /> Drug Test + DOT Physical ({medical.length})
              </h2>
              {medical.length === 0 ? (
                <div className="text-sm text-slate-500">Not yet scheduled.</div>
              ) : (
                <div className="grid gap-2">
                  {medical.map((m: any) => (
                    <div key={m.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{m.kind.replace(/_/g, " ")}</div>
                        <Badge>{m.status}</Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {m.vendor} · scheduled {fmtDate(m.scheduledFor)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status Timeline */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5" /> Status Timeline ({events.length})
              </h2>
              <div className="space-y-2.5">
                {events
                  .slice()
                  .reverse()
                  .map((e: any) => (
                    <div key={e.id} className="border-l-2 border-slate-200 pl-3 py-1">
                      <div className="text-sm font-medium">
                        {STAGE_LABEL[e.toStage] || e.toStage}
                      </div>
                      {e.reason && (
                        <div className="text-xs text-slate-500 mt-0.5">{e.reason}</div>
                      )}
                      <div className="text-xs text-slate-400 mt-0.5">
                        {fmtDate(e.createdAt)} · by {e.triggeredBy}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — Stage control panel */}
        <div className="space-y-4">
          {/* Truck assignment helper (only at ORIENTATION_DONE) */}
          {app.currentStage === "ORIENTATION_DONE" && (
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold flex items-center gap-2 mb-3">
                  <Truck className="h-5 w-5" /> Assign Truck
                </h3>
                <Input
                  placeholder="Truck unit # (e.g. T-401)"
                  value={truckUnit}
                  onChange={(e) => setTruckUnit(e.target.value)}
                />
                <Button
                  disabled={busy !== null || !truckUnit.trim()}
                  onClick={() => callAction("Assign Truck", `/api/recruiting/applications/${id}/truck/assign`, { truckUnit: truckUnit.trim() })}
                  className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Assign →
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Disqualify */}
          {app.currentStage !== "ACTIVE" && app.currentStage !== "DISQUALIFIED" && app.currentStage !== "TERMINATED" && (
            <Card>
              <CardContent className="p-6">
                <h3 className="font-bold text-red-700 flex items-center gap-2 mb-3">
                  <XCircle className="h-5 w-5" /> Disqualify
                </h3>
                <p className="text-sm text-slate-600">
                  Move to DISQUALIFIED with reason. The driver gets a polite rejection SMS + email.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => manualStage("DISQUALIFIED")}
                  className="mt-3 w-full"
                >
                  Disqualify Applicant
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Manual override */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold mb-3">Manual Stage Override</h3>
              <p className="text-xs text-slate-500 mb-2">
                Force a specific stage. Use only when the recommended action doesn&apos;t apply.
              </p>
              <select
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) {
                    manualStage(v);
                    e.target.value = "";
                  }
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                defaultValue=""
              >
                <option value="">Select stage…</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Recruiter notes */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold mb-3">Recruiter Notes ({notes.length})</h3>
              <Textarea
                placeholder="Add a private note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                className="text-sm"
              />
              <Button
                disabled={!newNote.trim()}
                onClick={addNote}
                size="sm"
                className="mt-2 w-full"
              >
                Save Note
              </Button>
              <div className="mt-4 space-y-3 max-h-72 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="rounded border border-slate-200 p-3 text-sm">
                    <div className="text-slate-800">{n.body}</div>
                    <div className="text-xs text-slate-400 mt-1">{fmtDate(n.createdAt)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-slate-900">{children}</div>
    </div>
  );
}

function parseJson(s: any) {
  if (!s) return null;
  if (typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
