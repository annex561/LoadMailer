import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Trash2, Filter } from "lucide-react";

interface LoadRow {
  id: string;
  loadNumber: string;
  brokerName: string | null;
  origin: string;
  destination: string;
  rate: number | null;
  status: string | null;
  driverId: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  bad: boolean;
  reasons: string[];
}

interface ListResponse {
  ok: boolean;
  total: number;
  loads: LoadRow[];
}

type FilterMode = "all" | "bad" | "good" | "archived";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export default function LoadsCleanupPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastResult, setLastResult] = useState<
    | { kind: "archived"; archived: number; requested: number }
    | { kind: "deleted"; deleted: number; requested: number; blocked: any[] }
    | null
  >(null);

  const { data, isLoading, refetch } = useQuery<ListResponse>({
    queryKey: ["/api/admin/loads/all"],
    refetchOnWindowFocus: false,
  });

  const all = data?.loads ?? [];

  const filtered = useMemo(() => {
    let rows = all;
    if (filterMode === "bad") rows = rows.filter((r) => r.bad);
    else if (filterMode === "good") rows = rows.filter((r) => !r.bad && r.status !== "archived");
    else if (filterMode === "archived") rows = rows.filter((r) => r.status === "archived");
    else rows = rows.filter((r) => r.status !== "archived");

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        return [r.loadNumber, r.brokerName, r.origin, r.destination, r.status]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      });
    }
    return rows;
  }, [all, filterMode, search]);

  // When the filter or search changes, drop any selections that are no longer visible.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map((r) => r.id));
      const next = new Set<string>();
      for (const id of Array.from(prev)) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [filtered]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === filtered.length) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  };

  const handleArchive = async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Archive ${selected.size} load(s)?\n\nThey'll be hidden from all queues (active loads, factoring, dispatch). Data is preserved — you can recover them later via SQL if needed.`,
      )
    )
      return;
    setArchiving(true);
    try {
      const res = await fetch("/api/admin/loads/archive-selected", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastResult({ kind: "archived", archived: data.archived, requested: data.requested });
        setSelected(new Set());
        refetch();
      } else {
        alert(`Archive failed:\n${data.error || "unknown"}`);
      }
    } catch (e: any) {
      alert(`Archive failed:\n${e?.message || e}`);
    } finally {
      setArchiving(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return;
    const typed = prompt(
      `PERMANENTLY DELETE ${selected.size} load(s)?\n\n` +
        `This is IRREVERSIBLE. The rows will be removed from the database.\n` +
        `Only archived loads can be hard-deleted.\n\n` +
        `Type DELETE to confirm:`,
    );
    if (typed !== "DELETE") {
      if (typed !== null) alert("Cancelled — confirmation text did not match.");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/loads/delete-permanent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loadIds: Array.from(selected),
          confirm: "PERMANENT_DELETE_I_UNDERSTAND",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastResult({
          kind: "deleted",
          deleted: data.deleted,
          requested: data.requested,
          blocked: data.blocked || [],
        });
        setSelected(new Set());
        refetch();
        if (data.blocked && data.blocked.length > 0) {
          alert(
            `Deleted ${data.deleted} of ${data.requested}.\n\n` +
              `${data.blocked.length} blocked by foreign-key constraints (other tables still reference these loads):\n\n` +
              data.blocked
                .slice(0, 5)
                .map((b: any) => `${b.loadNumber}: ${b.reason.slice(0, 100)}`)
                .join("\n"),
          );
        }
      } else {
        alert(
          `Permanent delete failed:\n${data.error || "unknown"}\n\n` +
            (data.notArchived
              ? `${data.notArchived.length} of your selection are not archived. Archive them first.`
              : ""),
        );
      }
    } catch (e: any) {
      alert(`Permanent delete failed:\n${e?.message || e}`);
    } finally {
      setDeleting(false);
    }
  };

  const badCount = all.filter((r) => r.bad && r.status !== "archived").length;
  const goodCount = all.filter((r) => !r.bad && r.status !== "archived").length;
  const archivedCount = all.filter((r) => r.status === "archived").length;

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Loads Cleanup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Check the rows you want to remove, then click <strong>Archive Selected</strong>. Archived
            loads disappear from every queue (Active Loads, Factoring, Dispatch) but data is preserved
            and recoverable.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total active" value={all.filter((r) => r.status !== "archived").length} />
        <Card label="Looks good" value={goodCount} accent="emerald" />
        <Card label="Flagged as bad" value={badCount} accent="amber" />
        <Card label="Already archived" value={archivedCount} accent="muted" />
      </div>

      {lastResult && (
        <div className="p-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 text-sm">
          {lastResult.kind === "archived" ? (
            <>✅ Archived {lastResult.archived} of {lastResult.requested} load(s).</>
          ) : (
            <>
              ✅ Permanently deleted {lastResult.deleted} of {lastResult.requested} load(s).
              {lastResult.blocked.length > 0 && (
                <> {lastResult.blocked.length} blocked by foreign-key constraints (see browser alert).</>
              )}
            </>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-2 flex-wrap">
          {(["all", "bad", "good", "archived"] as FilterMode[]).map((m) => (
            <Button
              key={m}
              variant={filterMode === m ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterMode(m)}
              data-testid={`filter-${m}`}
            >
              {m === "all" && "All active"}
              {m === "bad" && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                  Bad only ({badCount})
                </>
              )}
              {m === "good" && `Good only (${goodCount})`}
              {m === "archived" && `Archived (${archivedCount})`}
            </Button>
          ))}
        </div>
        <Input
          type="text"
          placeholder="Search load #, broker, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
      </div>

      {/* Selected count + action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-card border rounded-md sticky top-0 z-10">
        <div className="text-sm">
          <strong>{selected.size}</strong> of {filtered.length} selected
        </div>
        <div className="flex gap-2 flex-wrap">
          {filterMode === "archived" ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0 || deleting}
              onClick={handlePermanentDelete}
              className="bg-red-700 hover:bg-red-800"
              title="Hard-delete archived loads. IRREVERSIBLE. Only works on rows that are already status=archived."
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {deleting ? "Deleting…" : `⚠ Permanently Delete (${selected.size})`}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0 || archiving}
              onClick={handleArchive}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {archiving ? "Archiving…" : `Archive Selected (${selected.size})`}
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="w-10 p-2 text-left">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = selected.size > 0 && selected.size < filtered.length;
                    }
                  }}
                  onChange={toggleAll}
                  data-testid="checkbox-select-all"
                />
              </th>
              <th className="p-2 text-left font-medium">Load #</th>
              <th className="p-2 text-left font-medium">Broker</th>
              <th className="p-2 text-left font-medium">Origin</th>
              <th className="p-2 text-left font-medium">Destination</th>
              <th className="p-2 text-left font-medium">Rate</th>
              <th className="p-2 text-left font-medium">Status</th>
              <th className="p-2 text-left font-medium">Created</th>
              <th className="p-2 text-left font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-muted-foreground">
                  No loads match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b hover:bg-muted/30 ${
                    selected.has(r.id) ? "bg-primary/5" : ""
                  } ${r.bad ? "bg-amber-500/5" : ""}`}
                  data-testid={`row-${r.id}`}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      data-testid={`checkbox-${r.id}`}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{r.loadNumber}</td>
                  <td className="p-2 truncate max-w-[200px]" title={r.brokerName ?? ""}>
                    {r.brokerName || "—"}
                  </td>
                  <td className="p-2 truncate max-w-[200px]" title={r.origin}>
                    {r.origin || <span className="text-red-500">— no origin —</span>}
                  </td>
                  <td className="p-2 truncate max-w-[200px]" title={r.destination}>
                    {r.destination || <span className="text-red-500">— no destination —</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">{fmtMoney(r.rate)}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">
                      {r.status || "?"}
                    </Badge>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-2">
                    {r.bad ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-amber-500"
                        title={r.reasons.join(" · ")}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {r.reasons[0] || "bad"}
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-500">ok</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Archived rows are kept in the DB. To restore a row manually:{" "}
        <code>UPDATE loads SET status = 'pending' WHERE id = '...'</code>.
      </p>
    </div>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "amber" | "muted";
}) {
  const ring =
    accent === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : accent === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : accent === "muted"
          ? "border-border bg-muted/30"
          : "border-border";
  return (
    <div className={`p-3 rounded-md border ${ring}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
