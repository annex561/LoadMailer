import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Confirmation {
  loadNumber: string;
  broker: string;
  pickup: { city: string; state: string; address: string; date: string; time: string };
  drop: { city: string; state: string; address: string; date: string; time: string };
  specialInstructions: string | null;
  equipmentType: string;
  weight: number | null;
  pay: {
    lineItems: Array<{ label: string; amount: number }>;
    deductions: Array<{ label: string; amount: number }>;
    netPay: number;
    recurringDeductions: Array<{ label: string; amount: number }>;
  };
  confirmationStatus: string;
}

export default function DriverConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setData)
      .catch(() => setError("Load not found or link expired"));
  }, [token]);

  const respond = async (action: "accept" | "decline") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      // refresh to show new status
      const r = await fetch(`/api/confirm/${token}`);
      setData(await r.json());
    } catch {
      setError("Submit failed — try again");
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <div className="p-6 text-center">{error}</div>;
  if (!data) return <div className="p-6 text-center">Loading...</div>;

  const mapsUrl = (city: string, state: string, addr: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addr}, ${city}, ${state}`)}`;

  return (
    <div className="max-w-md mx-auto p-4 pb-24 space-y-3">
      <div className="text-center">
        <div className="text-sm text-muted-foreground">Load</div>
        <div className="text-2xl font-bold">#{data.loadNumber}</div>
        <div className="text-sm">{data.broker}</div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">📍 Pickup</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm">
          <p className="font-medium">{data.pickup.city}, {data.pickup.state}</p>
          <p>{data.pickup.address}</p>
          <p className="text-muted-foreground">
            {new Date(data.pickup.date).toLocaleDateString()} @ {data.pickup.time}
          </p>
          <a
            href={mapsUrl(data.pickup.city, data.pickup.state, data.pickup.address)}
            target="_blank" rel="noreferrer"
            className="text-blue-600 underline text-sm"
          >
            Open in Maps
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">📍 Drop</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm">
          <p className="font-medium">{data.drop.city}, {data.drop.state}</p>
          <p>{data.drop.address}</p>
          <p className="text-muted-foreground">
            {new Date(data.drop.date).toLocaleDateString()} @ {data.drop.time}
          </p>
          <a
            href={mapsUrl(data.drop.city, data.drop.state, data.drop.address)}
            target="_blank" rel="noreferrer"
            className="text-blue-600 underline text-sm"
          >
            Open in Maps
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">💰 Your Pay</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm space-y-1">
          {data.pay.lineItems.map((li, i) => (
            <div key={i} className="flex justify-between">
              <span>{li.label}</span>
              <span>${li.amount.toFixed(2)}</span>
            </div>
          ))}
          {data.pay.deductions.map((d, i) => (
            <div key={i} className="flex justify-between text-muted-foreground">
              <span>{d.label}</span>
              <span>${d.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t my-2" />
          <div className="flex justify-between font-bold">
            <span>Net this load</span>
            <span>${data.pay.netPay.toFixed(2)}</span>
          </div>
          {data.pay.recurringDeductions.length > 0 && (
            <div className="mt-3 pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Weekly deductions (on statement):</p>
              {data.pay.recurringDeductions.map((d, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{d.label}</span>
                  <span>${d.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data.specialInstructions && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm">{data.specialInstructions}</CardContent>
        </Card>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-3 flex gap-2">
        {data.confirmationStatus === "pending" ? (
          <>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => respond("decline")}
              disabled={submitting}
              data-testid="btn-decline"
            >
              Decline
            </Button>
            <Button
              className="flex-1"
              onClick={() => respond("accept")}
              disabled={submitting}
              data-testid="btn-accept"
            >
              Accept Load
            </Button>
          </>
        ) : (
          <div className="flex-1 text-center font-medium">
            {data.confirmationStatus === "accepted" ? "✓ Accepted" : "✗ Declined"}
          </div>
        )}
      </div>
    </div>
  );
}
