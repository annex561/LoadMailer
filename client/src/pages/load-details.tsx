import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import {
  Loader2,
  MapPin,
  Truck,
  DollarSign,
  Weight,
  ArrowRight,
  Calendar,
  FileText,
  Phone,
  Building,
  Send,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface LoadDetailsPageProps {
  /** Optional explicit id, used when this page is rendered outside a wouter Route
   *  (e.g. from the loadops-dashboard renderContent switch). When omitted, the
   *  id is read from useParams and then from the location pathname as fallback. */
  id?: string;
}

export default function LoadDetailsPage({ id: idProp }: LoadDetailsPageProps = {}) {
  const params = useParams<{ id: string }>();
  const [location] = useLocation();
  // Resolve id from (1) explicit prop (2) wouter useParams (3) /loads/<id> path
  const fallbackFromPath = location.match(/^\/loads\/([^/]+)$/)?.[1];
  const id = idProp ?? params.id ?? fallbackFromPath;

  const { data: load, isLoading, error } = useQuery<any>({
    queryKey: [`/api/loads/${id}`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !load) {
    return (
      <div className="flex flex-col justify-center items-center h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400 text-lg">Load not found</p>
        <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">
          The requested load could not be loaded.
        </p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    new: "bg-gray-100 text-gray-800",
    offered: "bg-blue-100 text-blue-800",
    booked: "bg-purple-100 text-purple-800",
    scheduled: "bg-indigo-100 text-indigo-800",
    in_transit: "bg-amber-100 text-amber-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    expired: "bg-gray-100 text-gray-600",
  };

  const lifecycleStatus = load.lifecycleStatus || load.status || "unknown";

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-slate-100 dark:bg-slate-900 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start gap-4 bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Load #{load.loadNumber}
              </h1>
              <Badge className={statusColors[lifecycleStatus] || "bg-gray-100"}>
                {lifecycleStatus.replace("_", " ").toUpperCase()}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <MapPin className="w-4 h-4" />
              <span>
                {load.originCity || load.pickupAddress?.split(",")[0]},{" "}
                {load.originState || ""}
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span>
                {load.destCity || load.deliveryAddress?.split(",")[0]},{" "}
                {load.destState || ""}
              </span>
            </div>
            {load.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {load.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-600">
              ${load.rate?.toLocaleString() || "0"}
            </div>
            {load.rpm && (
              <div className="text-sm text-slate-400">Rate Per Mile: ${load.rpm.toFixed(2)}</div>
            )}
            {load.miles && (
              <div className="text-sm text-slate-400">{load.miles.toLocaleString()} miles</div>
            )}
            <TestDispatchButton loadId={load.id} loadNumber={load.loadNumber} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="w-4 h-4" /> Equipment & Weight
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Equipment:</span>
                  <span className="font-medium">{load.equipmentType || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Weight:</span>
                  <span className="font-medium">
                    {load.weight ? `${load.weight.toLocaleString()} lbs` : "N/A"}
                  </span>
                </div>
                {load.length && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Length:</span>
                    <span className="font-medium">{load.length} ft</span>
                  </div>
                )}
                {load.temperatureRequired && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Temp Range:</span>
                    <span className="font-medium">
                      {load.minTemperature}° - {load.maxTemperature}° {load.temperatureUnit}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pickup:</span>
                  <span className="font-medium">
                    {load.pickupDate
                      ? new Date(load.pickupDate).toLocaleDateString()
                      : "Not set"}
                    {load.pickupTime && ` @ ${load.pickupTime}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivery:</span>
                  <span className="font-medium">
                    {load.deliveryDate
                      ? new Date(load.deliveryDate).toLocaleDateString()
                      : "Not set"}
                    {load.deliveryTime && ` @ ${load.deliveryTime}`}
                  </span>
                </div>
                {load.bookedAt && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Booked:</span>
                    <span className="font-medium">
                      {new Date(load.bookedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Building className="w-4 h-4" /> Contact Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {load.company && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Company:</span>
                    <span className="font-medium">{load.company}</span>
                  </div>
                )}
                {load.contactPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone:</span>
                    <span className="font-medium">{load.contactPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Source:</span>
                  <span className="font-medium capitalize">{load.sourceBoard || "manual"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <DocumentCard
                title="Rate Confirmation"
                path={load.rateconPath}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Proof of Delivery"
                path={load.podPath}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Bill of Lading"
                path={null}
                icon={<FileText className="w-8 h-8" />}
              />
              <DocumentCard
                title="Lumper Receipt"
                path={null}
                icon={<FileText className="w-8 h-8" />}
              />
            </div>
          </CardContent>
        </Card>

        <AiPickupCheckCard loadId={load.id} />

        {load.specialInstructions && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Special Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                {load.specialInstructions}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="w-full md:w-[420px] lg:w-[460px] flex-shrink-0 bg-white dark:bg-slate-800 border-l dark:border-slate-700 z-10 overflow-y-auto">
        <EVChecklist load={load} />
      </div>
    </div>
  );
}

// ── AI Pickup Check Card ─────────────────────────────────────────────────────

interface DocCheckRow {
  id: string;
  phase: string;
  verdict: string;          // 'pending' | 'pass' | 'needs_review'
  score: number | null;
  securementVerdict: string | null;
  securementReason: string | null;
  fields: Array<{ field: string; rcValue: unknown; bolValue: unknown; score: number; reason: string }> | null;
  mustFieldsMissing: string[] | null;
  reasons: string[] | null;
  updatedAt: string | null;
}

/**
 * Display-only verdict card: no GO button, no driver message, no action.
 * PASS (green)  = verdict='pass' AND score >= 0.90 AND all MUST fields present
 *                 AND (pickup: securementVerdict='secured'; delivery: not required)
 * NEEDS REVIEW  = anything else when a row exists and is not 'pending'
 * Not checked   = no rows, flag off, or verdict='pending'
 */
function isRowPassing(row: DocCheckRow): boolean {
  if (row.verdict !== 'pass') return false;
  if ((row.score ?? 0) < 0.90) return false;
  if ((row.mustFieldsMissing ?? []).length > 0) return false;
  if (row.phase === 'pickup' && row.securementVerdict !== 'secured') return false;
  return true;
}

function AiPickupCheckCard({ loadId }: { loadId: string }) {
  const { data, isLoading } = useQuery<{ ok: boolean; checks: DocCheckRow[] }>({
    queryKey: [`/api/loads/${loadId}/doc-checks`],
    enabled: !!loadId,
    refetchInterval: 30_000,   // poll every 30s — the job is async
  });

  if (isLoading) return null;

  const checks: DocCheckRow[] = data?.checks ?? [];

  // One card per phase that has data; also show a combined header
  const pickup = checks.find(c => c.phase === 'pickup');
  const delivery = checks.find(c => c.phase === 'delivery');

  // Nothing to show
  if (!pickup && !delivery) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-slate-400" /> AI Pickup Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-400">Not checked — enable AI_DOC_CHECK_ENABLED to run.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">AI Pickup Check</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {[pickup, delivery].filter(Boolean).map((row) => (
          <PhaseVerdict key={row!.phase} row={row!} />
        ))}
      </CardContent>
    </Card>
  );
}

function PhaseVerdict({ row }: { row: DocCheckRow }) {
  const passing = isRowPassing(row);
  const pending = row.verdict === 'pending';
  const label = row.phase === 'pickup' ? 'Pickup' : 'Delivery';
  const checkedAt = row.updatedAt ? new Date(row.updatedAt).toLocaleString() : null;

  if (pending) {
    return (
      <div className="flex items-start gap-2">
        <HelpCircle className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-slate-500">{label}: Checking…</p>
          <p className="text-xs text-slate-400">AI check in progress</p>
        </div>
      </div>
    );
  }

  if (passing) {
    return (
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-green-700">
            {label}: PASS
            {row.score != null && (
              <span className="ml-1 font-normal text-green-600">({(row.score * 100).toFixed(0)}%)</span>
            )}
          </p>
          {row.securementVerdict === 'secured' && (
            <p className="text-xs text-green-600">Securement ✓ · BOL matches rate-con</p>
          )}
          {checkedAt && <p className="text-[10px] text-slate-400 mt-0.5">Checked {checkedAt}</p>}
        </div>
      </div>
    );
  }

  // NEEDS REVIEW
  const reasons = (row.reasons ?? []).slice(0, 3);
  const missing = row.mustFieldsMissing ?? [];
  const secNote = row.securementVerdict === 'not_secured'
    ? `Securement: ${row.securementReason || 'not secured'}`
    : row.securementVerdict === 'unreadable'
    ? 'Securement photo unreadable'
    : null;

  return (
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-amber-700">
          {label}: NEEDS REVIEW
          {row.score != null && (
            <span className="ml-1 font-normal text-amber-600">({(row.score * 100).toFixed(0)}%)</span>
          )}
        </p>
        {missing.length > 0 && (
          <p className="text-xs text-red-600 mt-0.5">Missing: {missing.join(', ')}</p>
        )}
        {secNote && <p className="text-xs text-amber-600">{secNote}</p>}
        {reasons.length > 0 && (
          <ul className="text-xs text-slate-500 mt-1 list-disc list-inside space-y-0.5">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {checkedAt && <p className="text-[10px] text-slate-400 mt-0.5">Checked {checkedAt}</p>}
      </div>
    </div>
  );
}


function DocumentCard({
  title,
  path,
  icon,
}: {
  title: string;
  path: string | null;
  icon: React.ReactNode;
}) {
  const hasDoc = !!path;

  return (
    <div
      className={`p-4 rounded-lg border text-center transition-colors ${
        hasDoc
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30"
          : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600"
      }`}
    >
      <div
        className={`mx-auto mb-2 ${
          hasDoc ? "text-green-600 dark:text-green-400" : "text-slate-300 dark:text-slate-500"
        }`}
      >
        {icon}
      </div>
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{title}</p>
      <p className={`text-[10px] mt-1 ${hasDoc ? "text-green-600" : "text-slate-400"}`}>
        {hasDoc ? "Uploaded" : "Pending"}
      </p>
    </div>
  );
}


/**
 * Admin-only "Send Test Dispatch SMS" button. Renders the same dispatch
 * SMS that real drivers receive — using THIS load's real broker, addresses,
 * dates, and confirmationToken — but redirects the message to a chosen
 * phone instead of the assigned driver. The /l/<token> link in the body
 * resolves to a real load page, so end-to-end click-through is verifiable.
 */
function TestDispatchButton({ loadId, loadNumber }: { loadId: string; loadNumber?: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [previewBody, setPreviewBody] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/test-dispatch/from-load/${loadId}`, { phone });
      return res.json();
    },
    onSuccess: (data: { ok: boolean; error?: string; messageSid?: string; body?: string; url?: string }) => {
      if (data.ok) {
        toast({ title: "Test dispatch sent", description: `SID: ${data.messageSid}` });
        setPreviewBody(data.body ?? null);
      } else {
        toast({ title: "Send failed", description: data.error ?? "unknown error", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  // Hide the button entirely for non-admins.
  if (user?.role !== "admin") return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreviewBody(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-3">
          <Send className="w-3 h-3 mr-2" />
          Send test SMS
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send test dispatch SMS</DialogTitle>
          <DialogDescription>
            Sends the dispatch SMS for load <strong>{loadNumber ?? loadId}</strong> using
            this load's real broker, addresses, dates, and confirmation token —
            but redirects the message to the phone you specify below. The actual
            assigned driver will <strong>not</strong> receive anything.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="testPhone">Test phone</Label>
            <Input
              id="testPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+14234555007 or 4234555007"
              autoFocus
            />
          </div>
          {previewBody && (
            <div>
              <Label>Sent message</Label>
              <pre className="whitespace-pre-wrap break-words text-xs bg-slate-50 p-3 rounded-md font-sans border max-h-64 overflow-y-auto">
                {previewBody}
              </pre>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={() => sendMutation.mutate()} disabled={!phone || sendMutation.isPending}>
            <Send className="w-4 h-4 mr-2" />
            {sendMutation.isPending ? "Sending…" : "Send to this phone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
