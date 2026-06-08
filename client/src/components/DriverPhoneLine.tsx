import { useState } from "react";

export default function DriverPhoneLine({ driverId, voiceNumber, onChanged }: {
  driverId: string;
  voiceNumber: string | null;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addLine() {
    if (!confirm("Add a recorded company line for this driver?\n\nReuses a spare number you already own (free). If none is free, it buys one (~$1.15/mo) — only when number-buying is enabled.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/voice/drivers/${driverId}/provision-line`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (r.ok && j.ok) { setMsg(`Line added: ${j.phoneNumber} (${j.mode})`); onChanged?.(); }
      else setMsg(j.error || "Could not add a line.");
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="border rounded-lg p-4 mt-4">
      <h3 className="font-semibold mb-2">Phone Line</h3>
      {voiceNumber ? (
        <div>
          <div className="text-lg font-bold">{voiceNumber} <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">● Recorded</span></div>
          <div className="text-sm text-gray-500 mt-1">Forwards to the driver's cell · voicemail if missed</div>
          <a className="text-blue-600 text-sm underline" href={`/calls?driver=${driverId}`}>View this driver's calls →</a>
        </div>
      ) : (
        <div>
          <button disabled={busy} onClick={addLine} className="px-4 py-2 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">
            {busy ? "Adding…" : "＋ Add recorded line"}
          </button>
          <p className="text-xs text-gray-500 mt-2">Reuses a spare number free, or buys one (~$1.15/mo) — you confirm first.</p>
        </div>
      )}
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </div>
  );
}
