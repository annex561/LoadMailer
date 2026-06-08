import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type CallRow = {
  id: string; createdAt: string; fromNumber: string | null; toNumber: string | null;
  direction: string; legType: string | null; durationSec: number | null;
  recordingSid: string; transcript: string | null; transcriptStatus: string;
  aiClassification: { category?: string; isLoadOffer?: boolean; confidence?: number; summary?: string } | null;
  linkedIntakeId: string | null;
  driverId: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  load_offer: "bg-green-100 text-green-800", driver: "bg-blue-100 text-blue-800",
  shipper: "bg-purple-100 text-purple-800", spam: "bg-gray-200 text-gray-600",
  other: "bg-gray-100 text-gray-700",
};

export default function CallsPage() {
  const { data: calls, isLoading, refetch } = useQuery<CallRow[]>({
    queryKey: ["/api/voice/calls"], refetchInterval: 30_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const driverFilter = new URLSearchParams(window.location.search).get("driver");
  const shown = (calls ?? []).filter((c) => !driverFilter || c.driverId === driverFilter);

  async function convert(id: string) {
    const r = await fetch(`/api/voice/calls/${id}/convert`, { method: "POST", credentials: "include" });
    if (r.ok) refetch();
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Inbound Calls</h1>
      {isLoading && <p>Loading…</p>}
      <div className="space-y-2">
        {shown.map((c) => {
          const cat = c.aiClassification?.category ?? "—";
          const isOpen = openId === c.id;
          return (
            <div key={c.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpenId(isOpen ? null : c.id)}>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${CATEGORY_COLORS[cat] ?? "bg-gray-100"}`}>{cat}</span>
                  <span className="font-medium">{c.fromNumber ?? "unknown"}</span>
                  <span className="text-sm text-gray-500">{c.direction} · {c.legType ?? "call"} · {c.durationSec ?? 0}s</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              {isOpen && (
                <div className="mt-3 space-y-2">
                  <audio controls className="w-full" src={`/api/voice/recording/${c.recordingSid}/audio`} />
                  {c.aiClassification?.summary && <p className="text-sm italic text-gray-700">{c.aiClassification.summary}</p>}
                  <pre className="text-sm whitespace-pre-wrap bg-gray-50 p-2 rounded max-h-60 overflow-auto">
                    {c.transcript ?? `(${c.transcriptStatus})`}
                  </pre>
                  {c.linkedIntakeId
                    ? <a className="text-blue-600 text-sm underline" href={`/review-queue?intake=${c.linkedIntakeId}`}>View linked load in review queue →</a>
                    : <button className="text-sm px-3 py-1 rounded bg-green-600 text-white" onClick={() => convert(c.id)}>Convert to Load</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
