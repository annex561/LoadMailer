import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Confirmation {
  loadId: string;
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
  loadStatus: string;
  bolPath: string | null;
  podPath: string | null;
  deliveredAt: string | null;
  driverTrackingToken: string | null;
}

export default function DriverConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const bolInputRef = useRef<HTMLInputElement>(null);
  const podInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const r = await fetch(`/api/confirm/${token}`);
    if (!r.ok) {
      setError("Load not found or link expired");
      return;
    }
    setData(await r.json());
  };

  useEffect(() => {
    refresh();
  }, [token]);

  const respond = async (action: "accept" | "decline" | "picked-up" | "delivered") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      await refresh();
    } catch {
      setError("Submit failed — try again");
    } finally {
      setSubmitting(false);
    }
  };

  const upload = async (file: File, docType: "bol" | "pod") => {
    setUploadStatus(`Uploading ${docType.toUpperCase()}...`);
    try {
      const fd = new FormData();
      fd.append("doc", file);
      fd.append("docType", docType);
      const res = await fetch(`/api/confirm/${token}/upload-doc`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadStatus(`❌ ${j.error || "Upload failed"}`);
        return;
      }
      setUploadStatus(`✅ ${docType.toUpperCase()} uploaded`);
      await refresh();
    } catch (e: any) {
      setUploadStatus(`❌ ${e.message || "Upload failed"}`);
    }
  };

  if (error) return <div className="p-6 text-center">{error}</div>;
  if (!data) return <div className="p-6 text-center">Loading...</div>;

  const mapsUrl = (city: string, state: string, addr: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addr}, ${city}, ${state}`)}`;

  // Lifecycle stage determines which buttons show
  const isPending = data.confirmationStatus === "pending";
  const isDeclined = data.confirmationStatus === "declined";
  const isAccepted = data.confirmationStatus === "accepted" && data.loadStatus === "assigned";
  const isInTransit = data.loadStatus === "in_transit";
  const isDelivered = data.loadStatus === "delivered";

  return (
    <div className="max-w-md mx-auto p-4 pb-32 space-y-3">
      <div className="text-center">
        <div className="text-sm text-muted-foreground">Load</div>
        <div className="text-2xl font-bold">#{data.loadNumber}</div>
        <div className="text-sm">{data.broker}</div>
        {/* Status badge */}
        <div className="mt-2 inline-block px-3 py-1 rounded-full text-xs font-medium border">
          {isPending && "Awaiting your response"}
          {isDeclined && "✗ Declined"}
          {isAccepted && "✓ Accepted — drive to pickup"}
          {isInTransit && "🚚 In transit"}
          {isDelivered && "✅ Delivered"}
        </div>
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

      {/* BOL upload — visible after Accept, before Delivered */}
      {(isAccepted || isInTransit) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">📄 Bill of Lading (BOL)</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm space-y-2">
            {data.bolPath ? (
              <p className="text-green-600">✅ BOL uploaded</p>
            ) : (
              <p className="text-muted-foreground">Take a photo of the signed BOL at pickup.</p>
            )}
            <input
              ref={bolInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, "bol");
              }}
              data-testid="input-bol-upload"
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => bolInputRef.current?.click()}
              data-testid="btn-upload-bol"
            >
              {data.bolPath ? "Replace BOL" : "📸 Take BOL photo"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* POD upload — visible after In Transit */}
      {(isInTransit || isDelivered) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">📄 Proof of Delivery (POD)</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm space-y-2">
            {data.podPath ? (
              <p className="text-green-600">✅ POD uploaded</p>
            ) : (
              <p className="text-muted-foreground">Take a photo of the signed POD at delivery.</p>
            )}
            <input
              ref={podInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, "pod");
              }}
              data-testid="input-pod-upload"
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => podInputRef.current?.click()}
              data-testid="btn-upload-pod"
            >
              {data.podPath ? "Replace POD" : "📸 Take POD photo"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Live tracking link — visible after Accept */}
      {(isAccepted || isInTransit) && data.driverTrackingToken && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">📍 Live tracking</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm">
            <a
              href={`/driver/${data.driverTrackingToken}`}
              className="text-blue-600 underline"
            >
              Share live location
            </a>
          </CardContent>
        </Card>
      )}

      {/* Settlement summary — emphasized when delivered */}
      {isDelivered && (
        <Card className="border-green-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">💵 Settlement</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            <p>
              Delivered{" "}
              {data.deliveredAt && new Date(data.deliveredAt).toLocaleDateString()}.
            </p>
            <p className="font-bold mt-1">
              Net pay this load: ${data.pay.netPay.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      )}

      {uploadStatus && (
        <div className="text-center text-sm font-medium">{uploadStatus}</div>
      )}

      {/* Bottom action bar — buttons change with lifecycle state */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-3 flex gap-2">
        {isPending && (
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
        )}
        {isAccepted && (
          <Button
            className="flex-1"
            onClick={() => respond("picked-up")}
            disabled={submitting}
            data-testid="btn-picked-up"
          >
            ✓ Picked Up
          </Button>
        )}
        {isInTransit && (
          <Button
            className="flex-1"
            onClick={() => respond("delivered")}
            disabled={submitting}
            data-testid="btn-delivered"
          >
            ✓ Delivered
          </Button>
        )}
        {isDelivered && (
          <div className="flex-1 text-center font-medium text-green-600">
            ✅ Load complete
          </div>
        )}
        {isDeclined && (
          <div className="flex-1 text-center font-medium">✗ Declined</div>
        )}
      </div>
    </div>
  );
}
