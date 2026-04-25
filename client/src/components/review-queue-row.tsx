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
  matchedDriverId: string | null;
  matchedDriverConfidence: number | null;
  validatorFailures: Array<{ field: string; reason: string; severity: string }>;
  pdfPath: string | null;
}

interface Props {
  row: IntakeRow;
  drivers: Array<{ id: string; name: string }>;
  onSave: (patch: Partial<IntakeRow>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}

export function ReviewQueueRow({ row, drivers, onSave, onApprove, onReject }: Props) {
  const parsed = row.parsedJson ?? {};
  const [edited, setEdited] = useState(parsed);
  const [driverId, setDriverId] = useState(row.matchedDriverId ?? "");
  const [saving, setSaving] = useState(false);

  const warningsFor = (field: string) =>
    (row.validatorFailures ?? []).filter((f) => f.field === field);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ parsedJson: edited, matchedDriverId: driverId || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4" data-testid={`review-row-${row.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <Badge variant="destructive">{parsed.broker?.value ?? "Unknown"}</Badge>{" "}
            <span className="font-mono text-sm">{parsed.loadNumber?.value}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Pickup</label>
            <div className="flex gap-1">
              <Input
                value={parsed.pickup?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={parsed.pickup?.state ?? ""}
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
                value={parsed.pickup?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={parsed.pickup?.time ?? ""}
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
            <label className="text-xs font-medium">Drop</label>
            <div className="flex gap-1">
              <Input
                value={parsed.drop?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={parsed.drop?.state ?? ""}
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
                value={parsed.drop?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={parsed.drop?.time ?? ""}
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Rate</label>
            <Input
              type="number"
              value={parsed.rate?.value ?? ""}
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
              className="w-full border rounded p-2"
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

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="destructive" onClick={onReject}>
            Reject
          </Button>
          <Button onClick={onApprove} data-testid={`btn-approve-${row.id}`}>
            Approve & Dispatch
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
