import { useEffect, useMemo, useState } from "react";
import { ReviewQueueRow, type IntakeRow } from "@/components/review-queue-row";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Read ?intake=:id from the URL. When present, the page renders just that
// single intake — used by the SMS deep-link so the dispatcher can edit one
// load on their phone without scrolling through the whole queue.
function getIntakeIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  return p.get("intake");
}

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState("");
  const [focusIntakeId, setFocusIntakeId] = useState<string | null>(getIntakeIdFromUrl());
  // Error state for the queue fetch. Renders a banner instead of letting
  // a non-array response (e.g., 401 {"message":"Unauthorized"}) crash the
  // whole React tree via rows.filter(...) -> TypeError -> blank black page.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [rqRes, drvRes] = await Promise.all([
        fetch("/api/ratecon-intake/review-queue", { credentials: "include" }),
        fetch("/api/drivers", { credentials: "include" }),
      ]);

      // Queue endpoint — handle auth errors and non-array bodies defensively.
      // The previous code wrote the raw rqRes JSON straight into rows,
      // so a 401 response with body `{"message":"Unauthorized"}` would land
      // in `rows`, and the next `rows.filter(...)` call would TypeError and
      // unmount the React tree, producing a blank black page.
      if (rqRes.status === 401 || rqRes.status === 403) {
        setRows([]);
        setLoadError("Your session expired. Please sign in again to view the review queue.");
      } else if (!rqRes.ok) {
        setRows([]);
        setLoadError(`Review queue failed to load (HTTP ${rqRes.status}). Try refreshing in a minute.`);
      } else {
        const rqJson = await rqRes.json();
        if (Array.isArray(rqJson)) {
          setRows(rqJson);
          setLoadError(null);
        } else {
          setRows([]);
          setLoadError("Review queue returned an unexpected response. Try refreshing.");
        }
      }

      // Drivers endpoint — same defensive pattern, but missing drivers
      // doesn't block the queue from rendering.
      if (drvRes.ok) {
        const drvJson = await drvRes.json();
        setDrivers(Array.isArray(drvJson) ? drvJson : []);
      } else {
        setDrivers([]);
      }
    } catch (err: any) {
      setRows([]);
      setLoadError(`Could not reach the server: ${err?.message ?? String(err)}`);
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // 30s auto-refresh
    return () => clearInterval(iv);
  }, []);

  const filteredRows = useMemo(() => {
    // Deep-link from SMS: only the focused intake. No other queue clutter.
    if (focusIntakeId) return rows.filter((r) => r.id === focusIntakeId);

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
  }, [rows, search, focusIntakeId]);

  // Clear the focus param without a page reload — used by the "Back to queue"
  // button so the dispatcher returns to the full list cleanly.
  const clearFocus = () => {
    setFocusIntakeId(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("intake");
      window.history.replaceState({}, "", url.toString());
    }
  };

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

  const rejectJunk = async () => {
    if (
      !confirm(
        "Reject every row in the queue where the parser couldn't extract a broker or load number? (Non-ratecon PDFs, receipts, parser failures, etc.) This will leave only real ratecons.",
      )
    )
      return;
    const res = await fetch("/api/ratecon-intake/reject-junk", { method: "POST" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      alert(`Cleanup failed:\n${e.error}`);
      return;
    }
    const { rejectedCount } = await res.json();
    alert(`✅ Rejected ${rejectedCount} junk row(s).`);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-6">
      {loadError && (
        <div
          className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          data-testid="review-queue-error-banner"
          role="alert"
        >
          <strong className="font-semibold">Review queue unavailable.</strong>{" "}
          {loadError}
          {/^Your session expired/.test(loadError) && (
            <>
              {" "}
              <a href="/login" className="underline">
                Go to sign-in →
              </a>
            </>
          )}
        </div>
      )}
      {focusIntakeId ? (
        // Single-intake focused view — what the SMS deep-link opens to.
        // Mobile-first: minimal chrome, clear way back to the full queue.
        <div className="mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFocus}
            data-testid="btn-back-to-queue"
            className="-ml-2"
          >
            ← Back to queue
          </Button>
          <h1 className="text-xl sm:text-2xl font-bold mt-1">Edit Load</h1>
          {filteredRows.length === 0 && rows.length > 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              That intake isn't in the review queue anymore — it may have been dispatched or rejected. Tap "Back to queue" to see what's still pending.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3 sm:gap-4">
          <h1 className="text-2xl font-bold">
            Review Queue{" "}
            <span className="text-muted-foreground">
              ({filteredRows.length}
              {filteredRows.length !== rows.length ? ` of ${rows.length}` : ""})
            </span>
          </h1>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={rejectJunk}
              data-testid="btn-reject-junk"
              className="self-start sm:self-auto"
            >
              🧹 Clean junk
            </Button>
            <Input
              type="text"
              placeholder="Search by load #, broker, city, or filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-full sm:max-w-sm"
              data-testid="input-review-search"
            />
          </div>
        </div>
      )}

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
                  const sms = result?.sms || {};
                  const loadLabel = `Load #${result.loadNumber || (result.loadId || "").slice(0, 8)}`;
                  if (sms.ok) {
                    alert(
                      `✅ ${loadLabel}\n` +
                        `Twilio accepted SMS to ${sms.phone || "driver"}\n` +
                        `Message SID: ${sms.messageSid || "(none returned)"}\n\n` +
                        `If the SMS doesn't arrive in 30 sec:\n` +
                        `1. Twilio Console → Monitor → Logs → Messaging\n` +
                        `2. Look up SID ${sms.messageSid || ""} → status (queued/sent/delivered/failed/undelivered)\n` +
                        `3. Common reasons SMS doesn't arrive even though Twilio accepted:\n` +
                        `   • Trial-mode account: destination number not verified\n` +
                        `   • A2P 10DLC not registered (US carriers silently drop)\n` +
                        `   • Carrier filtering / blocked content`,
                    );
                  } else {
                    alert(
                      `❌ ${loadLabel} created but SMS FAILED:\n\n` +
                        `${sms.error || "unknown"}\n\n` +
                        `Driver phone: ${sms.phone || "?"}\n` +
                        `The load is in the system; contact the driver another way.`,
                    );
                  }
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
