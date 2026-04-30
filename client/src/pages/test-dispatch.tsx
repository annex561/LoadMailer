import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send, Eye } from "lucide-react";

/**
 * Admin "Test Dispatch SMS" page. Sends a fully-rendered dispatch SMS to a
 * specified phone using a fake-but-realistic load — does NOT touch real
 * loads or real drivers. Helpful for iterating on copy and verifying 10DLC
 * delivery without messaging a real driver by accident.
 */
export default function TestDispatchPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    phone: "",
    loadNumber: "",
    brokerName: "Total Quality Logistics (TEST)",
    originCity: "Atlanta",
    originState: "GA",
    destCity: "Dallas",
    destState: "TX",
    pickupAddress: "",
    deliveryAddress: "",
    pickupTime: "08:00",
    deliveryTime: "17:00",
    rate: 2450,
    miles: 800,
    description: "General freight",
    specialInstructions: "",
    driverName: "Test Driver",
    payType: "percent",
    payRate: 80,
  });
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/test-dispatch/preview", form);
      return res.json();
    },
    onSuccess: (data: { body: string; url: string }) => {
      setPreviewBody(data.body);
      setPreviewUrl(data.url);
    },
    onError: (err: any) => {
      toast({ title: "Preview failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/test-dispatch/send", form);
      return res.json();
    },
    onSuccess: (data: { ok: boolean; error?: string; messageSid?: string; body?: string; url?: string }) => {
      if (data.ok) {
        toast({ title: "Test SMS sent", description: `SID: ${data.messageSid}` });
        setPreviewBody(data.body ?? null);
        setPreviewUrl(data.url ?? null);
      } else {
        toast({ title: "Send failed", description: data.error ?? "unknown error", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  const update = (k: keyof typeof form, v: any) => setForm({ ...form, [k]: v });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Test Dispatch SMS</h1>
        <p className="text-sm text-muted-foreground">
          Send a fully-rendered dispatch SMS to your own phone using fake load data.
          Does not touch real loads or real drivers. Goes through the same 10DLC compliance,
          STOP/opt-out check, and driver-dashboard-footer logic as production dispatch.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where to send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="phone">Phone (E.164 or 10 digits)</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+14234555007 or 4234555007"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Load (defaults to a sample if blank)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="loadNumber">Load #</Label>
              <Input id="loadNumber" value={form.loadNumber} onChange={(e) => update("loadNumber", e.target.value)} placeholder="auto-generated TEST-…" />
            </div>
            <div>
              <Label htmlFor="brokerName">Broker</Label>
              <Input id="brokerName" value={form.brokerName} onChange={(e) => update("brokerName", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3">
              <Label htmlFor="originCity">Origin city</Label>
              <Input id="originCity" value={form.originCity} onChange={(e) => update("originCity", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="originState">State</Label>
              <Input id="originState" value={form.originState} onChange={(e) => update("originState", e.target.value)} maxLength={2} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3">
              <Label htmlFor="destCity">Destination city</Label>
              <Input id="destCity" value={form.destCity} onChange={(e) => update("destCity", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="destState">State</Label>
              <Input id="destState" value={form.destState} onChange={(e) => update("destState", e.target.value)} maxLength={2} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pickupTime">Pickup time</Label>
              <Input id="pickupTime" value={form.pickupTime} onChange={(e) => update("pickupTime", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="deliveryTime">Delivery time</Label>
              <Input id="deliveryTime" value={form.deliveryTime} onChange={(e) => update("deliveryTime", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rate">Rate ($)</Label>
              <Input id="rate" type="number" value={form.rate} onChange={(e) => update("rate", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="miles">Miles</Label>
              <Input id="miles" type="number" value={form.miles} onChange={(e) => update("miles", Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="description">Commodity / description</Label>
            <Input id="description" value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="specialInstructions">Special instructions (optional)</Label>
            <Textarea id="specialInstructions" value={form.specialInstructions} onChange={(e) => update("specialInstructions", e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Driver pay (affects NET PAY in the SMS)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label htmlFor="driverName">Driver name</Label>
              <Input id="driverName" value={form.driverName} onChange={(e) => update("driverName", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="payType">Pay type</Label>
              <select
                id="payType"
                value={form.payType}
                onChange={(e) => update("payType", e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="percent">% of gross</option>
                <option value="per_mile">$ per mile</option>
                <option value="flat">Flat $</option>
              </select>
            </div>
            <div>
              <Label htmlFor="payRate">Pay rate</Label>
              <Input id="payRate" type="number" value={form.payRate} onChange={(e) => update("payRate", Number(e.target.value))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
          <Eye className="w-4 h-4 mr-2" />
          {previewMutation.isPending ? "Rendering…" : "Preview body"}
        </Button>
        <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending || !form.phone}>
          <Send className="w-4 h-4 mr-2" />
          {sendMutation.isPending ? "Sending…" : "Send to my phone"}
        </Button>
      </div>

      {previewBody && (
        <Card>
          <CardHeader>
            <CardTitle>Preview — exactly what the driver will see</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm bg-slate-50 p-4 rounded-md font-sans">
              {previewBody}
            </pre>
            {previewUrl && (
              <div className="mt-3 text-xs text-muted-foreground">
                Load detail link in body: <a href={previewUrl} className="text-blue-600 underline" target="_blank" rel="noreferrer">{previewUrl}</a>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Note: when sent for real, the driver-dashboard footer "👤 My Dashboard: …" is auto-appended
              if the destination phone matches a registered driver. The preview above is the body BEFORE that footer.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
