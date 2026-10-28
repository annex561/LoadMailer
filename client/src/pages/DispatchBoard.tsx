/**
 * S14 — LAMP Dispatch Board (staff only)
 *
 * Shows all recent loads with per-load lane checklist columns.
 * Broker fields are visible here because this page is staff-only (14a-1).
 * Driver-facing views (driver-load-texts, driver portal) must never show broker fields.
 *
 * Lane statuses:
 *   Lane 2: broker detail verified (stored: lane2BrokerVerified)
 *   Lane 3: driver confirmed (derived from driverTextConfirmedAt)
 *   Lane 3: appointment set (stored: lane3AppointmentStatus)
 *   Lane 4: Love's submission (derived from factoringStatus — ONLY after delivery + POD)
 *   Lane 5: POD within 1h (derived)
 *   Lane 5: invoice within 24h (derived)
 *   Lane 5: A/R updated (stored: lane5ArUpdated)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type LaneStatus = "Y" | "N" | "not_yet";

interface BoardLoad {
  id: string;
  loadNumber: string;
  status: string;
  brokerName: string | null;
  brokerPhone: string | null;
  driverTextConfirmedAt: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  deliveredAt: string | null;
  podUploadedAt: string | null;
  factoringStatus: string | null;
  factoringSubmittedAt: string | null;
  signedBolRequired: boolean;
  lane2BrokerVerified: LaneStatus;
  lane3AppointmentStatus: LaneStatus;
  lane5ArUpdated: LaneStatus;
  relayTasks: string | null;
  dispatchNotes: string | null;
  // Derived
  lane3DriverConfirmed: LaneStatus;
  lane4Factoring: LaneStatus;
  lane5Pod: LaneStatus;
  lane5Invoice: LaneStatus;
}

const STATUS_COLOR: Record<LaneStatus, string> = {
  Y: "#16a34a",       // green
  N: "#dc2626",       // red
  not_yet: "#9ca3af", // gray
};

function LaneBadge({ status }: { status: LaneStatus }) {
  const label = status === "not_yet" ? "—" : status;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      color: "#fff",
      background: STATUS_COLOR[status],
    }}>
      {label}
    </span>
  );
}

function LaneSelect({
  value,
  loadId,
  field,
}: {
  value: LaneStatus;
  loadId: string;
  field: "lane2BrokerVerified" | "lane3AppointmentStatus" | "lane5ArUpdated";
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (newValue: LaneStatus) =>
      apiRequest("PATCH", `/api/loads/${loadId}/dispatch-checklist`, { [field]: newValue }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/dispatch/board"] }),
  });

  return (
    <select
      value={value}
      onChange={(e) => mutation.mutate(e.target.value as LaneStatus)}
      disabled={mutation.isPending}
      style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4 }}
    >
      <option value="not_yet">—</option>
      <option value="Y">Y</option>
      <option value="N">N</option>
    </select>
  );
}

export default function DispatchBoard() {
  const { data: loads, isLoading, error } = useQuery<BoardLoad[]>({
    queryKey: ["/api/dispatch/board"],
  });

  if (isLoading) return <div style={{ padding: 32 }}>Loading dispatch board…</div>;
  if (error) return <div style={{ padding: 32, color: "red" }}>Error loading board: {String(error)}</div>;

  return (
    <div style={{ padding: "16px 24px", overflowX: "auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>LAMP Dispatch Board</h1>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
        Staff view — broker details visible. Lane 4 (Love's) is auto-blocked until delivery + POD on file.
      </p>

      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 1200 }}>
        <thead>
          <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
            <th style={th}>Load #</th>
            <th style={th}>Status</th>
            <th style={th}>Broker</th>
            <th style={th}>Pickup</th>
            <th style={th}>Delivery</th>
            <th style={th}>L2 Broker Verified</th>
            <th style={th}>L3 Confirmed</th>
            <th style={th}>L3 Appt</th>
            <th style={th}>L4 Love's</th>
            <th style={th}>L5 POD ≤1h</th>
            <th style={th}>L5 Invoice ≤24h</th>
            <th style={th}>L5 A/R</th>
            <th style={th}>Relay Tasks</th>
            <th style={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {(loads ?? []).map((load) => (
            <tr key={load.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={td}>
                <a href={`/loads/${load.id}`} style={{ color: "#2563eb", fontWeight: 600 }}>
                  {load.loadNumber || load.id.slice(0, 8)}
                </a>
              </td>
              <td style={td}>{load.status}</td>
              <td style={td}>
                {/* 14a-1: broker fields only here — staff board */}
                <div style={{ fontWeight: 500 }}>{load.brokerName ?? "—"}</div>
                <div style={{ color: "#6b7280", fontSize: 11 }}>{load.brokerPhone ?? ""}</div>
              </td>
              <td style={td}>{load.pickupDate ?? "—"}</td>
              <td style={td}>{load.deliveryDate ?? "—"}</td>
              <td style={td}>
                <LaneSelect
                  value={load.lane2BrokerVerified as LaneStatus}
                  loadId={load.id}
                  field="lane2BrokerVerified"
                />
              </td>
              <td style={td}>
                {/* Lane 3 driver confirmed: read-only (S13 drives it) */}
                <LaneBadge status={load.lane3DriverConfirmed} />
              </td>
              <td style={td}>
                <LaneSelect
                  value={load.lane3AppointmentStatus as LaneStatus}
                  loadId={load.id}
                  field="lane3AppointmentStatus"
                />
              </td>
              <td style={td}>
                {/* Lane 4: derived, read-only — blocked pre-delivery by gate in factoring-loves */}
                <LaneBadge status={load.lane4Factoring} />
                {load.factoringStatus === "manual_review" && (
                  <div style={{ fontSize: 10, color: "#dc2626" }}>⚠ needs review</div>
                )}
              </td>
              <td style={td}>
                <LaneBadge status={load.lane5Pod} />
              </td>
              <td style={td}>
                <LaneBadge status={load.lane5Invoice} />
              </td>
              <td style={td}>
                <LaneSelect
                  value={load.lane5ArUpdated as LaneStatus}
                  loadId={load.id}
                  field="lane5ArUpdated"
                />
              </td>
              <td style={{ ...td, maxWidth: 180, whiteSpace: "pre-wrap" }}>
                {load.relayTasks ?? ""}
              </td>
              <td style={{ ...td, maxWidth: 180, whiteSpace: "pre-wrap" }}>
                {load.dispatchNotes ?? ""}
              </td>
            </tr>
          ))}
          {(loads ?? []).length === 0 && (
            <tr>
              <td colSpan={14} style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                No loads in the last 30 days
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: "nowrap",
  borderBottom: "2px solid #d1d5db",
};

const td: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "top",
};
