import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface IntakeRow {
  id: string;
  createdAt: string;
  parsedJson: any;
  reviewReason: string | null;
  parseError?: string | null;
  matchedDriverId: string | null;
  matchedDriverConfidence: number | null;
  validatorFailures: Array<{ field: string; reason: string; severity: string }>;
  pdfPath: string | null;
  sourceType?: string;
  sourceFilename?: string | null;
}

interface Props {
  row: IntakeRow;
  drivers: Array<{ id: string; name: string }>;
  onSave: (patch: Partial<IntakeRow>) => Promise<void>;
  onApprove: (driverId: string | null) => Promise<void>;
  onReject: () => Promise<void>;
}

export function ReviewQueueRow({ row, drivers, onSave, onApprove, onReject }: Props) {
  const parsed = row.parsedJson ?? {};
  const [edited, setEdited] = useState(parsed);
  const [driverId, setDriverId] = useState(row.matchedDriverId ?? "");
  const [saving, setSaving] = useState(false);

  // Warnings come from the server-side validator output and don't update
  // until a save round-trip. When the dispatcher edits live (e.g. picks a
  // driver, adds an AM/PM-disambiguated time), we hide the now-resolved
  // warnings client-side so the UI matches reality.
  const warningsFor = (field: string) => {
    const all = (row.validatorFailures ?? []).filter((f) => f.field === field);
    if (field === "driverName" && driverId) return []; // resolved live
    return all;
  };

  // Top-banner reviewReason text — strip "driver needs manual assignment"
  // once a driver has been picked. Pure display fix; the underlying server
  // record still has the original reason until the next save.
  const liveReviewReason = (() => {
    if (!row.reviewReason) return row.reviewReason;
    if (!driverId) return row.reviewReason;
    return row.reviewReason
      .split("|")
      .map((s) => s.trim())
      .filter((s) => !/driver needs manual assignment/i.test(s))
      .join(" | ")
      .trim() || null;
  })();

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ parsedJson: edited, matchedDriverId: driverId || null });
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel =
    row.sourceType === "email"
      ? `📧 Email${row.sourceFilename ? ` · ${row.sourceFilename}` : ""}`
      : row.sourceType === "upload"
        ? `📤 Upload${row.sourceFilename ? ` · ${row.sourceFilename}` : ""}`
        : row.sourceType === "manual"
          ? "✏️ Manual entry"
          : "";

  return (
    <Card className="mb-4" data-testid={`review-row-${row.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <Badge variant="destructive">{parsed.broker?.value ?? "Unknown"}</Badge>{" "}
            <span className="font-mono text-sm">{parsed.loadNumber?.value}</span>
            {sourceLabel && (
              <span className="text-xs text-muted-foreground ml-2">{sourceLabel}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </div>
        </div>

        {/* Why this landed in the review queue. The reviewReason text is from
            the original parse — we strip the "driver needs manual assignment"
            piece if the dispatcher has already picked a driver, so the live
            UI matches what's actually still pending. */}
        {(row.parseError || liveReviewReason) && (
          <div
            className={`rounded-md border p-3 text-sm ${
              row.parseError
                ? "border-red-500/40 bg-red-500/5 text-red-300"
                : "border-amber-500/40 bg-amber-500/5 text-amber-300"
            }`}
            data-testid={`review-reason-${row.id}`}
          >
            <div className="font-medium mb-1">
              {row.parseError ? "❌ Parser failed" : "⚠️ Needs review"}
            </div>
            <div className="text-xs whitespace-pre-wrap">
              {row.parseError ?? liveReviewReason}
            </div>
            {row.parseError && (
              <div className="text-xs mt-2 opacity-75">
                Common cause: <code>OPENAI_API_KEY</code> missing or invalid in server env. Check Railway → Variables.
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">📍 Pickup</label>
            <Input
              value={edited.pickup?.address ?? ""}
              onChange={(e) =>
                setEdited({ ...edited, pickup: { ...edited.pickup, address: e.target.value } })
              }
              placeholder="Full street address"
              className="font-medium"
              data-testid={`pickup-address-${row.id}`}
            />
            <div className="flex gap-1 mt-1">
              <Input
                value={edited.pickup?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={edited.pickup?.state ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, state: e.target.value } })
                }
                placeholder="ST"
                className="w-16"
              />
            </div>
            <div className="flex gap-1 mt-1">
              <Input
                type="date"
                value={edited.pickup?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={edited.pickup?.time ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, time: e.target.value } })
                }
              />
            </div>
            {warningsFor("pickup").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium">📍 Drop</label>
            <Input
              value={edited.drop?.address ?? ""}
              onChange={(e) =>
                setEdited({ ...edited, drop: { ...edited.drop, address: e.target.value } })
              }
              placeholder="Full street address"
              className="font-medium"
              data-testid={`drop-address-${row.id}`}
            />
            <div className="flex gap-1 mt-1">
              <Input
                value={edited.drop?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={edited.drop?.state ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, state: e.target.value } })
                }
                placeholder="ST"
                className="w-16"
              />
            </div>
            <div className="flex gap-1 mt-1">
              <Input
                type="date"
                value={edited.drop?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={edited.drop?.time ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, time: e.target.value } })
                }
              />
            </div>
            {warningsFor("drop").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>
        </div>

        {(parsed.commodity?.value || parsed.specialInstructions?.value) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {parsed.commodity?.value && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Commodity</label>
                <div className="text-foreground">{parsed.commodity.value}</div>
              </div>
            )}
            {parsed.specialInstructions?.value && (
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">⚠️ Special Instructions</label>
                <div className="text-amber-300 font-medium">{parsed.specialInstructions.value}</div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Rate</label>
            <Input
              type="number"
              value={edited.rate?.value ?? ""}
              onChange={(e) =>
                setEdited({ ...edited, rate: { ...edited.rate, value: Number(e.target.value) } })
              }
            />
            {warningsFor("rate").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium">Assign Driver</label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full border border-input rounded p-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid={`select-driver-${row.id}`}
            >
              <option value="">— select —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {warningsFor("driverName").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>
        </div>

        {/* Action buttons. On mobile each button is full width (easy tap
            targets while driving / standing). On desktop they sit on one
            row right-aligned. Approve & Dispatch is the primary action so
            it appears first on mobile (top of stack). */}
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            onClick={() => onApprove(driverId || null)}
            data-testid={`btn-approve-${row.id}`}
            className="w-full sm:w-auto sm:order-3"
            size="lg"
          >
            Approve &amp; Dispatch
          </Button>
          <Button
            variant="outline"
            onClick={save}
            disabled={saving}
            className="w-full sm:w-auto sm:order-1"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="destructive"
            onClick={onReject}
            className="w-full sm:w-auto sm:order-2"
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
