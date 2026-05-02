import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  Lock,
  Send,
  Truck,
  MapPin,
  FileText,
  ShieldCheck,
  Clock,
  DollarSign,
  Fuel,
  ThumbsUp,
  AlertCircle,
  Radio,
  Bot,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EVChecklistProps {
  load: any;
}

/**
 * 13-step lifecycle from booking → settlement. `auto: true` steps are
 * driven by the AI/automation layer (SMS keywords, GPS geofences,
 * Einstein POD parser, etc.). `auto: false` steps require a human
 * (VA / dispatcher) to confirm.
 */
const STEPS_CONFIG = [
  { key: "initialSms", label: "Driver Confirmation", icon: Send, auto: true, desc: "Booking SMS sent. Waiting for driver to reply YES.", phase: "BOOKING" },
  { key: "tripMessage", label: "Send Dispatch Instructions", icon: MapPin, auto: false, desc: "Send addresses + tracking link to driver.", phase: "BOOKING" },
  { key: "puArrived", label: "Arrived at Pickup", icon: MapPin, auto: true, desc: "AI watching GPS geofence + driver PICKED UP keyword.", phase: "PICKUP" },
  { key: "annexNotified", label: "Team Notified", icon: ShieldCheck, auto: true, desc: "System auto-alerts ops team.", phase: "PICKUP" },
  { key: "puDocs", label: "BOL Uploaded", icon: FileText, auto: true, desc: "AI scanning inbound MMS for BOL photo.", phase: "PICKUP" },
  { key: "brokerConfirmed", label: "Broker Confirmed Loaded", icon: CheckCircle2, auto: false, desc: "VA: call broker to confirm loaded.", phase: "PICKUP" },
  { key: "transitMonitored", label: "In Transit", icon: Clock, auto: true, desc: "AI monitoring GPS macro-points + driver status.", phase: "TRANSIT" },
  { key: "delDocsRequested", label: "Delivery Docs Requested", icon: FileText, auto: true, desc: "Auto-SMS sent 50 miles from receiver.", phase: "DELIVERY" },
  { key: "driverReleased", label: "Driver Released", icon: Truck, auto: false, desc: "VA: verify empty + clear driver.", phase: "DELIVERY" },
  { key: "docsToEinstein", label: "POD to Einstein AI", icon: Bot, auto: true, desc: "AI analyzing POD for signature + match.", phase: "DELIVERY" },
  { key: "factoringSent", label: "Submit to Factoring", icon: DollarSign, auto: false, desc: "VA: submit invoice to factoring company.", phase: "SETTLEMENT" },
  { key: "fuelLogged", label: "Log Fuel Expenses", icon: Fuel, auto: false, desc: "VA: enter fuel costs.", phase: "SETTLEMENT" },
  { key: "brokerThankYou", label: "Broker Thank You", icon: ThumbsUp, auto: false, desc: "Send automated thank-you email.", phase: "SETTLEMENT" },
];

const PHASE_COLORS: Record<string, string> = {
  BOOKING: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  PICKUP: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  TRANSIT: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  DELIVERY: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  SETTLEMENT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export function EVChecklist({ load }: EVChecklistProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge driverConfirmedAt into SOP progress so step 1 auto-completes when driver replies YES.
  const [steps, setSteps] = useState(() => {
    const baseProgress = load.sopProgress || {};
    if (load.driverConfirmedAt) return { ...baseProgress, initialSms: true };
    return baseProgress;
  });

  useEffect(() => {
    if (load.driverConfirmedAt && !steps.initialSms) {
      setSteps((prev: any) => ({ ...prev, initialSms: true }));
    }
  }, [load.driverConfirmedAt]);

  const activeIndex = STEPS_CONFIG.findIndex((s) => !steps[s.key]);
  const currentStep = activeIndex === -1 ? null : STEPS_CONFIG[activeIndex];
  const completedCount = STEPS_CONFIG.filter((s) => steps[s.key]).length;
  const progressPct = Math.round((completedCount / STEPS_CONFIG.length) * 100);

  // Auto-scroll to active step.
  useEffect(() => {
    if (scrollRef.current) {
      const activeElement = scrollRef.current.querySelector('[data-active="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeIndex]);

  const updateProgress = useMutation({
    mutationFn: async (newSteps: any) => {
      await apiRequest("PATCH", `/api/loads/${load.id}`, { sopProgress: newSteps });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/loads/${load.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
    },
  });

  const toggleStep = (key: string, value: boolean) => {
    const newSteps = { ...steps, [key]: value };
    setSteps(newSteps);
    updateProgress.mutate(newSteps);
    toast({ title: "Updated", description: "Lifecycle progress synced." });
  };

  const triggerAction = async (type: string, stepKey: string) => {
    try {
      toast({ title: "AI working…", description: "Executing automated action." });
      await apiRequest("POST", `/api/sms/send-template`, { loadId: load.id, type });
      toggleStep(stepKey, true);
    } catch (e: any) {
      const errorMessage = e?.message || e?.error || "Command failed.";
      toast({ title: "Error", variant: "destructive", description: errorMessage });
    }
  };

  return (
    <Card className="h-full bg-slate-950 border-slate-800 text-slate-100 flex flex-col shadow-none">
      {/* HEADER */}
      <CardHeader className="py-3 border-b border-slate-900 bg-slate-900/50">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <CardTitle className="text-sm font-bold">Lifecycle Tracking</CardTitle>
          </div>
          <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono text-xs">
            {activeIndex === -1 ? "✓ COMPLETE" : `${completedCount}/${STEPS_CONFIG.length}`}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* AI status banner */}
        {currentStep && (
          <div
            className={cn(
              "mt-3 p-2.5 rounded-md border flex items-start gap-2.5",
              currentStep.auto
                ? "bg-blue-500/10 border-blue-500/30"
                : "bg-amber-500/10 border-amber-500/30",
            )}
          >
            {currentStep.auto ? (
              <Bot className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="text-xs leading-relaxed flex-1 min-w-0">
              <div className={cn("font-semibold", currentStep.auto ? "text-blue-300" : "text-amber-300")}>
                {currentStep.auto ? "🤖 AI is monitoring" : "👤 Human action needed"}
              </div>
              <div className="text-slate-400 mt-0.5 break-words">{currentStep.desc}</div>
            </div>
          </div>
        )}
      </CardHeader>

      {/* SCROLLABLE STEPPER */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-3">
          {STEPS_CONFIG.map((step, index) => {
            const isCompleted = !!steps[step.key];
            const isActive = index === activeIndex;
            const StepIcon = step.icon;

            return (
              <div key={step.key} data-active={isActive} className="relative">
                {/* Vertical connector line */}
                {index !== STEPS_CONFIG.length - 1 && (
                  <div
                    className={cn(
                      "absolute left-[15px] top-8 w-[2px] h-[calc(100%-12px)]",
                      isCompleted ? "bg-emerald-600/50" : "bg-slate-800",
                    )}
                  />
                )}

                <div
                  className={cn(
                    "relative flex items-start gap-3 py-2.5 px-2 rounded-md transition-colors",
                    isActive && "bg-blue-500/5 border border-blue-500/30 my-1",
                  )}
                >
                  {/* Step indicator */}
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 z-10",
                      isActive && "bg-blue-600 border-blue-400 ring-4 ring-blue-500/20",
                      isCompleted && !isActive && "bg-emerald-600/20 border-emerald-500",
                      !isActive && !isCompleted && "bg-slate-900 border-slate-700",
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : isActive ? (
                      <StepIcon className="w-4 h-4 text-white" />
                    ) : (
                      <Lock className="w-3 h-3 text-slate-600" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4
                        className={cn(
                          "text-sm font-medium leading-tight",
                          isActive && "text-white",
                          isCompleted && !isActive && "text-slate-300",
                          !isActive && !isCompleted && "text-slate-500",
                        )}
                      >
                        {step.label}
                      </h4>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-1.5 py-0 font-mono", PHASE_COLORS[step.phase])}
                      >
                        {step.phase}
                      </Badge>
                    </div>

                    {/* Active-step expanded details + action buttons */}
                    {isActive && (
                      <div className="mt-2.5 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <p className="text-xs text-slate-400 flex items-start gap-1.5 break-words">
                          {step.auto ? (
                            <Radio className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                          )}
                          <span className="min-w-0">{step.desc}</span>
                        </p>

                        {step.key === "tripMessage" ? (
                          <Button
                            size="sm"
                            className="w-full bg-blue-600 hover:bg-blue-500 font-semibold"
                            onClick={() => triggerAction("DISPATCH_INSTRUCTIONS", step.key)}
                          >
                            <MapPin className="w-3.5 h-3.5 mr-2" />
                            Send Addresses + Tracking
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant={step.auto ? "outline" : "default"}
                            className={cn(
                              "w-full text-xs font-semibold",
                              step.auto
                                ? "border-slate-700 bg-slate-900 hover:bg-slate-800"
                                : "bg-blue-600 hover:bg-blue-500",
                            )}
                            onClick={() => toggleStep(step.key, true)}
                          >
                            {step.auto ? "Manual override" : "Mark complete"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Completion banner */}
          {activeIndex === -1 && (
            <div className="mt-4 p-5 text-center bg-emerald-900/10 border border-emerald-700/40 rounded-lg">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <ThumbsUp className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-emerald-300 font-bold text-sm">Load Complete</h3>
              <p className="text-slate-500 text-xs mt-1">All 13 lifecycle steps done.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}

/**
 * Public helper: derive the current lifecycle phase + active step name
 * from a load row. Used by the Live Tracking page to show what each
 * active load is currently doing without rendering the whole panel.
 */
export function getLifecycleStatus(load: any): {
  completedCount: number;
  totalCount: number;
  progressPct: number;
  activeStepKey: string | null;
  activeStepLabel: string | null;
  activePhase: string | null;
  activeIsAi: boolean;
  isComplete: boolean;
} {
  const sop = load?.sopProgress || {};
  const merged = load?.driverConfirmedAt ? { ...sop, initialSms: true } : sop;
  const activeIndex = STEPS_CONFIG.findIndex((s) => !merged[s.key]);
  const completedCount = STEPS_CONFIG.filter((s) => merged[s.key]).length;
  const totalCount = STEPS_CONFIG.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);
  if (activeIndex === -1) {
    return {
      completedCount,
      totalCount,
      progressPct: 100,
      activeStepKey: null,
      activeStepLabel: null,
      activePhase: null,
      activeIsAi: false,
      isComplete: true,
    };
  }
  const step = STEPS_CONFIG[activeIndex];
  return {
    completedCount,
    totalCount,
    progressPct,
    activeStepKey: step.key,
    activeStepLabel: step.label,
    activePhase: step.phase,
    activeIsAi: step.auto,
    isComplete: false,
  };
}

export const PHASE_COLOR_MAP = PHASE_COLORS;
