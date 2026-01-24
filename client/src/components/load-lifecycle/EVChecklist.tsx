import { useState, useEffect } from "react";
import { Check, Clock, Send, DollarSign, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

interface SopProgressState {
  initialSms: boolean;
  tripMessage: boolean;
  puArrived: boolean;
  annexNotified: boolean;
  puDocs: boolean;
  brokerConfirmed: boolean;
  transitMonitored: boolean;
  delDocsRequested: boolean;
  driverReleased: boolean;
  docsToEinstein: boolean;
  factoringSent: boolean;
  fuelLogged: boolean;
  brokerThankYou: boolean;
}

const defaultSopProgress: SopProgressState = {
  initialSms: false,
  tripMessage: false,
  puArrived: false,
  annexNotified: false,
  puDocs: false,
  brokerConfirmed: false,
  transitMonitored: false,
  delDocsRequested: false,
  driverReleased: false,
  docsToEinstein: false,
  factoringSent: false,
  fuelLogged: false,
  brokerThankYou: false,
};

interface EVChecklistProps {
  load: any;
}

export function EVChecklist({ load }: EVChecklistProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fuelAmount, setFuelAmount] = useState(load.fuelCost?.toString() || "");

  const [steps, setSteps] = useState<SopProgressState>(() => ({
    ...defaultSopProgress,
    ...(load.sopProgress || {}),
  }));

  useEffect(() => {
    if (load.sopProgress) {
      setSteps({ ...defaultSopProgress, ...load.sopProgress });
    }
    if (load.fuelCost) {
      setFuelAmount(load.fuelCost.toString());
    }
  }, [load.sopProgress, load.fuelCost]);

  const updateProgress = useMutation({
    mutationFn: async (newSteps: SopProgressState) => {
      await apiRequest("PATCH", `/api/loads/${load.id}`, {
        sopProgress: newSteps,
        fuelCost: newSteps.fuelLogged ? parseFloat(fuelAmount) || undefined : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads", load.id] });
      toast({ title: "SOP Updated", description: "Workflow progress saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save progress", variant: "destructive" });
    },
  });

  const toggleStep = (key: keyof SopProgressState) => {
    if (key === "fuelLogged" && !steps.fuelLogged && !fuelAmount) {
      toast({ title: "Enter Fuel Cost", description: "Please enter fuel cost before marking as logged", variant: "destructive" });
      return;
    }
    const newSteps = { ...steps, [key]: !steps[key] };
    setSteps(newSteps);
    updateProgress.mutate(newSteps);
  };

  const handleSmsTrigger = async (type: string) => {
    try {
      await apiRequest("POST", `/api/sms/send-template`, { loadId: load.id, type });
      toast({ title: "SMS Sent", description: `${type} message sent to driver.` });
      const stepKey = type === "INITIAL" ? "initialSms" : "tripMessage";
      const newSteps = { ...steps, [stepKey]: true };
      setSteps(newSteps);
      updateProgress.mutate(newSteps);
    } catch {
      toast({ title: "Error", description: "Failed to send SMS", variant: "destructive" });
    }
  };

  const handleBrokerEmail = async () => {
    try {
      await apiRequest("POST", `/api/email/broker-thank-you`, { loadId: load.id });
      toast({ title: "Email Sent", description: "POD sent to broker." });
      const newSteps = { ...steps, brokerThankYou: true };
      setSteps(newSteps);
      updateProgress.mutate(newSteps);
    } catch {
      toast({ title: "Error", description: "Failed to send email", variant: "destructive" });
    }
  };

  const isBeforeNoon = new Date().getHours() < 12;

  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalSteps = Object.keys(steps).length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  return (
    <Card className="h-full border-l-4 border-l-blue-600 shadow-md">
      <CardHeader className="bg-slate-50 dark:bg-slate-800 pb-2">
        <CardTitle className="flex justify-between items-center text-lg font-bold text-slate-800 dark:text-slate-100">
          EV SOP Checklist
          <Badge variant={load.lifecycleStatus === "delivered" ? "default" : "outline"}>
            {(load.lifecycleStatus || load.status || "unknown").toUpperCase()}
          </Badge>
        </CardTitle>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          Load #{load.loadNumber} • {load.driverName || "Unassigned"}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {completedCount}/{totalSteps}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4 overflow-y-auto max-h-[80vh]">
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Phase 1: Dispatch
          </h4>

          <div className="flex items-start gap-3">
            <Checkbox checked={steps.initialSms} disabled className="mt-1" />
            <div className="grid gap-1.5 leading-none flex-1">
              <label className="text-sm font-medium leading-none">1. Send Load Details</label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs w-full"
                onClick={() => handleSmsTrigger("INITIAL")}
                disabled={steps.initialSms}
              >
                <Send className="w-3 h-3 mr-1" /> Send SMS Trigger
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3 pt-2">
            <Checkbox checked={steps.tripMessage} disabled className="mt-1" />
            <div className="grid gap-1.5 leading-none flex-1">
              <label className="text-sm font-medium leading-none">2. Trip Message (On-Site)</label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs w-full"
                onClick={() => handleSmsTrigger("TRIP")}
                disabled={steps.tripMessage}
              >
                <Send className="w-3 h-3 mr-1" /> Send Trip Link
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Phase 2: Transit
          </h4>

          <SopItem
            label="3. Pickup Arrived"
            checked={steps.puArrived}
            onChange={() => toggleStep("puArrived")}
          />
          <SopItem
            label="4. Annex Notified"
            checked={steps.annexNotified}
            onChange={() => toggleStep("annexNotified")}
          />

          <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800">
            <SopItem
              label="5. Pickup Docs (BOL/Photo)"
              checked={steps.puDocs}
              onChange={() => toggleStep("puDocs")}
            />
            <p className="text-[10px] text-blue-600 dark:text-blue-400 ml-6 mt-1">
              *Verify Printed Name & Signature visible
            </p>
          </div>

          <SopItem
            label="6. Broker Confirmed"
            checked={steps.brokerConfirmed}
            onChange={() => toggleStep("brokerConfirmed")}
          />
          <SopItem
            label="7. Transit Monitored (3-5hr)"
            checked={steps.transitMonitored}
            onChange={() => toggleStep("transitMonitored")}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Phase 3: Completion
          </h4>

          <SopItem
            label="8. Delivery Docs Requested"
            checked={steps.delDocsRequested}
            onChange={() => toggleStep("delDocsRequested")}
          />
          <SopItem
            label="9. Driver Released"
            checked={steps.driverReleased}
            onChange={() => toggleStep("driverReleased")}
          />
          <SopItem
            label="10. Docs to Einstein"
            checked={steps.docsToEinstein}
            onChange={() => toggleStep("docsToEinstein")}
          />

          <div
            className={`p-2 rounded border ${
              isBeforeNoon
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
            }`}
          >
            <SopItem
              label="11. Factoring Sent"
              checked={steps.factoringSent}
              onChange={() => toggleStep("factoringSent")}
            />
            <div className="flex items-center gap-2 ml-6 mt-1">
              <Clock className="w-3 h-3" />
              <span className="text-[10px] font-bold">
                {isBeforeNoon ? "ON TIME (Same Day)" : "NEXT DAY PROCESSING"}
              </span>
            </div>
          </div>

          <div className="pt-2">
            <div className="flex items-center gap-2 mb-1">
              <Checkbox
                checked={steps.fuelLogged}
                onCheckedChange={() => toggleStep("fuelLogged")}
              />
              <label className="text-sm font-medium">12. Fuel Logged</label>
            </div>
            {steps.fuelLogged && (
              <div className="ml-6 flex items-center gap-2">
                <DollarSign className="w-3 h-3 text-slate-400" />
                <Input
                  type="number"
                  placeholder="0.00"
                  value={fuelAmount}
                  onChange={(e) => setFuelAmount(e.target.value)}
                  className="h-7 text-xs w-24"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => updateProgress.mutate(steps)}
                  disabled={updateProgress.isPending}
                >
                  {updateProgress.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
              </div>
            )}
          </div>

          <div className="pt-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={steps.brokerThankYou} disabled />
              <label className="text-sm font-medium">13. Broker Thank You</label>
            </div>
            <Button
              size="sm"
              className="w-full mt-2 bg-slate-800 dark:bg-slate-700 text-xs"
              disabled={!steps.driverReleased || steps.brokerThankYou}
              onClick={handleBrokerEmail}
            >
              {steps.brokerThankYou ? (
                <>
                  <Check className="w-3 h-3 mr-1" /> Email Sent
                </>
              ) : (
                "Send POD Email"
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SopItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <label className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
        {label}
      </label>
    </div>
  );
}
