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
              await fetch(`/api/ratecon-intake/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              load();
            }}
            onApprove={async () => {
              await fetch(`/api/ratecon-intake/${r.id}/approve-and-dispatch`, { method: "POST" });
              load();
            }}
            onReject={async () => {
              await fetch(`/api/ratecon-intake/${r.id}/reject`, { method: "POST" });
              load();
            }}
          />
        ))
      )}
    </div>
  );
}
