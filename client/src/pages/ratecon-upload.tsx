/**
 * RateCon Upload — one-page dispatch flow.
 *
 * Upload PDF → AI parses → shows extracted fields → driver picker (if needed)
 * → "Dispatch" button → SMS sent → done.  No review-queue navigation required.
 */

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Phase =
  | "idle"          // waiting for file
  | "uploading"     // posting to /api/ratecon-intake/upload
  | "parsing"       // polling for parsed/in_review
  | "review"        // showing parsed data, waiting for dispatch
  | "dispatching"   // posting to approve-and-dispatch
  | "done"          // success
  | "error";        // something went wrong

interface Parsed {
  loadNumber?: { value: string };
  broker?: { value: string };
  rate?: { value: number };
  pickup?: { date: string; address: string; city: string; state: string };
  drop?: { date: string; address: string; city: string; state: string };
  driverName?: { value: string };
  equipmentType?: { value: string };
}

interface IntakeRow {
  id: string;
  status: string;
  parsedJson: Parsed | null;
  matchedDriverId: string | null;
  matchedDriverConfidence: number | null;
  reviewReason: string | null;
  validatorFailures: Array<{ field: string; reason: string; severity: string }> | null;
}

interface Driver {
  id: string;
  name: string;
  phone?: string;
}

function FieldRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%] truncate">{String(value)}</span>
    </div>
  );
}

export default function RateconUploadPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [intake, setIntake] = useState<IntakeRow | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [dispatchResult, setDispatchResult] = useState<{ loadNumber?: string; sms?: { ok: boolean } } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load drivers once on mount
  useEffect(() => {
    fetch("/api/drivers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDrivers(Array.isArray(data) ? data : data.drivers ?? []))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const selectFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("Only PDF files are accepted.");
      setPhase("error");
      return;
    }
    setFile(f);
    setPhase("idle");
    setErrorMsg("");
  };

  const handleUpload = async () => {
    if (!file) return;
    setPhase("uploading");
    setErrorMsg("");
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch("/api/ratecon-intake/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const { intakeId } = await res.json();
      setPhase("parsing");
      // Poll until parsed or in_review
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`/api/ratecon-intake/${intakeId}`, { credentials: "include" });
          const row: IntakeRow = await r.json();
          if (
            row.status === "parsed" ||
            row.status === "in_review" ||
            row.status === "auto_dispatched" ||
            row.status === "dispatched"
          ) {
            clearInterval(pollRef.current!);
            if (row.status === "auto_dispatched" || row.status === "dispatched") {
              setIntake(row);
              setDispatchResult({ loadNumber: row.parsedJson?.loadNumber?.value });
              setPhase("done");
            } else {
              setIntake(row);
              // Pre-select matched driver if confidence is high
              if (row.matchedDriverId && (row.matchedDriverConfidence ?? 0) >= 0.85) {
                setSelectedDriverId(row.matchedDriverId);
              }
              setPhase("review");
            }
          } else if (attempts > 40) {
            clearInterval(pollRef.current!);
            setErrorMsg("Parsing is taking longer than expected. Try the Review Queue.");
            setPhase("error");
          }
        } catch {
          if (attempts > 5) {
            clearInterval(pollRef.current!);
            setErrorMsg("Lost connection while waiting for parse result.");
            setPhase("error");
          }
        }
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "Upload failed.");
      setPhase("error");
    }
  };

  const handleDispatch = async () => {
    if (!intake) return;
    setPhase("dispatching");
    try {
      const body: Record<string, string> = {};
      if (selectedDriverId) body.driverId = selectedDriverId;
      const res = await fetch(`/api/ratecon-intake/${intake.id}/approve-and-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dispatch failed.");
      setDispatchResult({ loadNumber: data.loadNumber, sms: data.sms });
      setPhase("done");
    } catch (err: any) {
      setErrorMsg(err.message || "Dispatch failed.");
      setPhase("review");
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPhase("idle");
    setFile(null);
    setIntake(null);
    setSelectedDriverId("");
    setErrorMsg("");
    setDispatchResult(null);
  };

  const p = intake?.parsedJson;
  const errors = (intake?.validatorFailures ?? []).filter((f) => f.severity === "error");
  const warnings = (intake?.validatorFailures ?? []).filter((f) => f.severity === "warning");
  const needsDriver = !selectedDriverId;

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === "done") {
    return (
      <div className="max-w-lg mx-auto p-6 text-center space-y-4">
        <div className="text-6xl">✅</div>
        <h2 className="text-2xl font-bold text-green-400">Dispatched!</h2>
        {dispatchResult?.loadNumber && (
          <p className="text-muted-foreground">
            Load <span className="font-semibold text-foreground">{dispatchResult.loadNumber}</span> created.
          </p>
        )}
        {dispatchResult?.sms && (
          <p className="text-sm text-muted-foreground">
            {dispatchResult.sms.ok ? "✅ Driver SMS sent." : "⚠️ Load created but SMS failed — check Twilio."}
          </p>
        )}
        <Button onClick={reset} className="w-full mt-4">Upload Another RateCon</Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Upload Rate Confirmation</h1>
      <p className="text-sm text-muted-foreground">
        Drop a PDF — AI extracts the load, assigns the driver, and dispatches automatically.
      </p>

      {/* ── Drop zone ── */}
      {(phase === "idle" || phase === "error") && (
        <Card>
          <CardContent className="p-0">
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
              onClick={() => inputRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) selectFile(f); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              data-testid="upload-dropzone"
            >
              {file ? (
                <div className="space-y-1">
                  <p className="text-2xl">📄</p>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-3xl">📂</p>
                  <p className="text-muted-foreground">Drag RateCon PDF here</p>
                  <p className="text-sm text-muted-foreground">or tap to browse</p>
                </div>
              )}
              <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f); }} />
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "error" && errorMsg && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}

      {(phase === "idle" || phase === "error") && file && (
        <Button onClick={handleUpload} className="w-full" data-testid="btn-upload-ratecon">
          Upload &amp; Parse
        </Button>
      )}

      {/* ── Parsing spinner ── */}
      {(phase === "uploading" || phase === "parsing") && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <div className="text-4xl animate-pulse">🤖</div>
            <p className="font-medium">
              {phase === "uploading" ? "Uploading PDF…" : "AI is reading the RateCon…"}
            </p>
            <p className="text-sm text-muted-foreground">Usually takes 5–15 seconds.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Parsed data review + dispatch ── */}
      {(phase === "review" || phase === "dispatching") && intake && p && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Extracted Load Data</CardTitle>
              <div className="flex gap-1">
                {errors.length > 0 && <Badge variant="destructive">{errors.length} error{errors.length > 1 ? "s" : ""}</Badge>}
                {warnings.length > 0 && <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</Badge>}
                {errors.length === 0 && warnings.length === 0 && <Badge className="bg-green-700">Looks good</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Key fields */}
            <div className="rounded-md bg-muted/30 p-3 space-y-0.5">
              <FieldRow label="Load #" value={p.loadNumber?.value} />
              <FieldRow label="Broker" value={p.broker?.value} />
              <FieldRow label="Rate" value={p.rate?.value ? `$${p.rate.value.toFixed(2)}` : null} />
              <FieldRow label="Equipment" value={p.equipmentType?.value} />
              <FieldRow label="Pickup" value={p.pickup ? `${p.pickup.city}, ${p.pickup.state} — ${p.pickup.date}` : null} />
              <FieldRow label="Delivery" value={p.drop ? `${p.drop.city}, ${p.drop.state} — ${p.drop.date}` : null} />
            </div>

            {/* Validation issues */}
            {errors.length > 0 && (
              <div className="text-xs text-red-400 space-y-0.5">
                {errors.map((f, i) => <p key={i}>❌ {f.field}: {f.reason}</p>)}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="text-xs text-yellow-400 space-y-0.5">
                {warnings.map((f, i) => <p key={i}>⚠️ {f.field}: {f.reason}</p>)}
              </div>
            )}

            {/* Driver picker */}
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Assign Driver <span className="text-red-400">*</span>
              </label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedDriverId}
                onChange={(e) => setSelectedDriverId(e.target.value)}
                disabled={phase === "dispatching"}
              >
                <option value="">— Select driver —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.phone ? ` · ${d.phone}` : ""}
                  </option>
                ))}
              </select>
              {p.driverName?.value && !selectedDriverId && (
                <p className="text-xs text-muted-foreground">
                  RateCon mentions: <span className="text-foreground">{p.driverName.value}</span>
                </p>
              )}
            </div>

            {/* Dispatch error */}
            {phase === "review" && errorMsg && (
              <p className="text-sm text-red-400">{errorMsg}</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={reset} disabled={phase === "dispatching"} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleDispatch}
                disabled={needsDriver || phase === "dispatching" || errors.length > 0}
                className="flex-1 bg-green-700 hover:bg-green-600"
                data-testid="btn-dispatch"
              >
                {phase === "dispatching" ? "Dispatching…" : "🚀 Dispatch & Notify Driver"}
              </Button>
            </div>
            {errors.length > 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Fix errors before dispatching — or{" "}
                <a href={`/review-queue?highlight=${intake.id}`} className="underline text-primary">
                  edit in Review Queue
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
