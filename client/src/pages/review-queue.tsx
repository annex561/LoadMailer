import { useEffect, useState } from "react";
import { ReviewQueueRow, type IntakeRow } from "@/components/review-queue-row";

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);

  const load = async () => {
    const [rqRes, drvRes] = await Promise.all([
      fetch("/api/ratecon-intake/review-queue"),
      fetch("/api/drivers"),
    ]);
    setRows(await rqRes.json());
    setDrivers(await drvRes.json());
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // 30s auto-refresh
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">
        Review Queue <span className="text-muted-foreground">({rows.length})</span>
      </h1>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No loads need review. ✓</p>
      ) : (
        rows.map((r) => (
          <ReviewQueueRow
            key={r.id}
            row={r}
            drivers={drivers}
            onSave={async (patch) => {
              const res = await fetch(`/api/ratecon-intake/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                alert(`Save failed:\n${errorBody.error || "Unknown error"}`);
                return;
              }
              alert("✅ Saved");
              load();
            }}
            onApprove={async (driverId) => {
              const res = await fetch(`/api/ratecon-intake/${r.id}/approve-and-dispatch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ driverId }),
              });
              if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                alert(`Dispatch failed:\n\n${errorBody.error || "Unknown error"}`);
                return;
              }
              const result = await res.json().catch(() => ({}));
              const smsOk = result?.sms?.ok;
              const smsErr = result?.sms?.error;
              alert(
                smsOk
                  ? `✅ Dispatched — driver SMS sent.\nLoad ${(result.loadId || "").slice(0, 8)}`
                  : `Load created (${(result.loadId || "").slice(0, 8)}) but SMS failed:\n${smsErr || "unknown"}`,
              );
              load();
            }}
            onReject={async () => {
              const res = await fetch(`/api/ratecon-intake/${r.id}/reject`, { method: "POST" });
              if (!res.ok) {
                const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                alert(`Reject failed:\n${errorBody.error || "Unknown error"}`);
                return;
              }
              load();
            }}
          />
        ))
      )}
    </div>
  );
}
