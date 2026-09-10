// Owner-operator insurance certificates. Shows which split-authority drivers can be
// tendered a Trip Lease Addendum and which are blocked under Master Section 10.4.
//
// Blocked drivers sort to the top on purpose — this screen exists to be glanced at, not
// read. If nothing is red, there is nothing to do here.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Plus, Trash2, Truck } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  coi_auto_liability: "Auto liability",
  coi_cargo: "Cargo",
  coi_physical_damage: "Physical damage",
  coi_bobtail: "Bobtail / NTL",
  coi_occ_acc: "Occupational accident",
};

function daysLeft(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

function ExpiryBadge({ iso }: { iso: string }) {
  const d = daysLeft(iso);
  const when = new Date(iso).toLocaleDateString();
  if (d <= 0) return <Badge variant="destructive">Expired {when}</Badge>;
  if (d <= 30) return <Badge className="bg-amber-500 hover:bg-amber-500">{d}d left · {when}</Badge>;
  return <Badge variant="secondary">{when}</Badge>;
}

export default function DriverCoverage() {
  const { toast } = useToast();
  const [addFor, setAddFor] = useState<any>(null);
  const [form, setForm] = useState({ type: "coi_auto_liability", expiryDate: "" });

  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/coverage/drivers"] });
  const drivers: any[] = data?.drivers ?? [];
  const requiredTypes: string[] = data?.requiredTypes ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/coverage/drivers"] });

  const addDoc = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", "/api/coverage/documents", body),
    onSuccess: () => {
      refresh();
      setAddFor(null);
      setForm({ type: "coi_auto_liability", expiryDate: "" });
      toast({ title: "Certificate added" });
    },
    onError: (e: any) => toast({ title: e?.message || "Failed to add", variant: "destructive" }),
  });

  const delDoc = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/coverage/documents/${id}`),
    onSuccess: () => { refresh(); toast({ title: "Certificate removed" }); },
  });

  const setSplit = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      apiRequest("PATCH", `/api/coverage/drivers/${id}`, { splitAuthorityEnabled: on }),
    onSuccess: refresh,
  });

  // Blocked first, then split-authority, then everyone else.
  const sorted = [...drivers].sort((a, b) => {
    const rank = (x: any) => (x.splitAuthorityEnabled && !x.coverage?.ok ? 0 : x.splitAuthorityEnabled ? 1 : 2);
    return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
  });
  const blocked = sorted.filter((d) => d.splitAuthorityEnabled && !d.coverage?.ok).length;

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading coverage…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Owner-operator coverage</h1>
          <p className="text-sm text-muted-foreground">
            Certificates for split-authority drivers on the Master Trip Lease. A driver
            missing any required coverage cannot be tendered a Trip Addendum.
          </p>
        </div>
        {blocked > 0 ? (
          <Badge variant="destructive" className="text-sm">{blocked} blocked</Badge>
        ) : (
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-sm">All clear</Badge>
        )}
      </div>

      {sorted.map((d) => {
        const ok = d.coverage?.ok;
        const onLease = d.splitAuthorityEnabled;
        return (
          <Card key={d.id} className={onLease && !ok ? "border-destructive" : undefined}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle className="flex items-center gap-2 text-base">
                  {onLease ? (
                    ok ? <ShieldCheck className="h-4 w-4 text-emerald-600" />
                       : <ShieldAlert className="h-4 w-4 text-destructive" />
                  ) : <Truck className="h-4 w-4 text-muted-foreground" />}
                  {d.name || "Unnamed driver"}
                  {d.ownMcNumber ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {d.ownMcNumber} · {d.powerUnitType === "tractor" ? "tractor" : "box truck"}
                    </span>
                  ) : null}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <Label htmlFor={`split-${d.id}`} className="text-xs text-muted-foreground">
                    Split authority
                  </Label>
                  <Switch
                    id={`split-${d.id}`}
                    checked={onLease}
                    onCheckedChange={(on) => setSplit.mutate({ id: d.id, on })}
                  />
                  <Dialog
                    open={addFor?.id === d.id}
                    onOpenChange={(o) => setAddFor(o ? d : null)}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Plus className="h-4 w-4 mr-1" /> Certificate
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add certificate for {d.name}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Coverage</Label>
                          <Select
                            value={form.type}
                            onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {requiredTypes.map((t) => (
                                <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Expiration date</Label>
                          <Input
                            type="date"
                            value={form.expiryDate}
                            onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                          />
                        </div>
                        <Button
                          className="w-full"
                          disabled={!form.expiryDate || addDoc.isPending}
                          onClick={() => addDoc.mutate({ driverId: d.id, ...form })}
                        >
                          Add certificate
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Take the date off the endorsement, not the certificate holder line.
                        </p>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {onLease && !ok && d.coverage?.reason ? (
                <p className="text-sm text-destructive mb-3">{d.coverage.reason}</p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {requiredTypes.map((t) => {
                  const doc = (d.documents ?? []).find((x: any) => x.type === t);
                  return (
                    <div
                      key={t}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span className="text-sm">{TYPE_LABELS[t] ?? t}</span>
                      {doc ? (
                        <span className="flex items-center gap-2">
                          <ExpiryBadge iso={doc.expiryDate} />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => delDoc.mutate(doc.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">None</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
