import { useEffect, useMemo, useState } from "react";
import { ReviewQueueRow, type IntakeRow } from "@/components/review-queue-row";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState("");

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const p = r.parsedJson ?? {};
      const haystack = [
        p?.loadNumber?.value ?? "",
        p?.broker?.value ?? "",
        p?.pickup?.city ?? "",
        p?.drop?.city ?? "",
        r.sourceFilename ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  // Group rows by load number so the dispatcher can see duplicates at a glance
  const dupCountByLoadNum = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const ln = String(r.parsedJson?.loadNumber?.value ?? "");
      if (!ln) continue;
      counts[ln] = (counts[ln] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const rejectDuplicates = async (loadNumber: string) => {
    const total = dupCountByLoadNum[loadNumber] ?? 1;
    if (
      !confirm(
        `Combine all ${total} rows for load # ${loadNumber} into ONE row?\n\n` +
          `Server will pick the row with the most complete data (full street addresses, special instructions, etc.) and merge any unique fields from the others into it. Other ${total - 1} duplicates get rejected.`,
      )
    )
      return;
    const res = await fetch("/api/ratecon-intake/reject-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loadNumber }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      alert(`Bulk reject failed:\n${e.error}`);
      return;
    }
    const { rejectedCount, keptIntakeId } = await res.json();
    alert(
      `✅ Combined ${total} rows of load ${loadNumber} into one.\n` +
        `Kept: ${(keptIntakeId || "").slice(0, 8)}\n` +
        `Rejected: ${rejectedCount} duplicate(s)`,
    );
    load();
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h1 className="text-2xl font-bold">
          Review Queue{" "}
          <span className="text-muted-foreground">
            ({filteredRows.length}
            {filteredRows.length !== rows.length ? ` of ${rows.length}` : ""})
          </span>
        </h1>
        <Input
          type="text"
          placeholder="Search by load #, broker, city, or filename…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
          data-testid="input-review-search"
        />
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-muted-foreground">
          {rows.length === 0 ? "No loads need review. ✓" : "No matches for that search."}
        </p>
      ) : (
        filteredRows.map((r) => {
          const ln = String(r.parsedJson?.loadNumber?.value ?? "");
          const dupCount = dupCountByLoadNum[ln] ?? 0;
          return (
            <div key={r.id}>
              {dupCount > 1 && (
                <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1.5 mb-1 text-xs text-amber-300">
                  <span>
                    ⚠️ {dupCount} rows in queue with load # <code>{ln}</code>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rejectDuplicates(ln)}
                    data-testid={`btn-merge-duplicates-${r.id}`}
                  >
                    Combine into one
                  </Button>
                </div>
              )}
              <ReviewQueueRow
                row={r}
                drivers={drivers}
                onSave={async (patch) => {
                  const res = await fetch(`/api/ratecon-intake/${r.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                  });
                  if (!res.ok) {
                    const errorBody = await res
                      .json()
                      .catch(() => ({ error: `HTTP ${res.status}` }));
                    alert(`Save failed:\n${errorBody.error || "Unknown error"}`);
                    return;
                  }
                  alert("✅ Saved");
                  load();
                }}
                onApprove={async (driverId) => {
                  const res = await fetch(
                    `/api/ratecon-intake/${r.id}/approve-and-dispatch`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ driverId }),
                    },
                  );
                  if (!res.ok) {
                    const errorBody = await res
                      .json()
                      .catch(() => ({ error: `HTTP ${res.status}` }));
                    alert(`Dispatch failed:\n\n${errorBody.error || "Unknown error"}`);
                    return;
                  }
                  const result = await res.json().catch(() => ({}));
                  const smsOk = result?.sms?.ok;
                  const smsErr = result?.sms?.error;
                  alert(
                    smsOk
                      ? `✅ Dispatched — driver SMS sent.\nLoad ${(result.loadId || "").slice(
                          0,
                          8,
                        )}`
                      : `Load created (${(result.loadId || "").slice(
                          0,
                          8,
                        )}) but SMS failed:\n${smsErr || "unknown"}`,
                  );
                  load();
                }}
                onReject={async () => {
                  const res = await fetch(`/api/ratecon-intake/${r.id}/reject`, {
                    method: "POST",
                  });
                  if (!res.ok) {
                    const errorBody = await res
                      .json()
                      .catch(() => ({ error: `HTTP ${res.status}` }));
                    alert(`Reject failed:\n${errorBody.error || "Unknown error"}`);
                    return;
                  }
                  load();
                }}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
