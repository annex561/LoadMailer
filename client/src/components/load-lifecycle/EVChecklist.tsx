import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CheckCircle2, Circle, Lock, Send, Truck, MapPin, 
  FileText, ShieldCheck, Clock, DollarSign, Fuel, ThumbsUp, 
  AlertCircle, Radio
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EVChecklistProps {
  load: any;
}

// 1. CONFIG: Define the 13 Steps & Their Automation Type
const STEPS_CONFIG = [
  // STEP 1: Waiting for Driver Confirmation (Triggered by Booking)
  { key: "initialSms", label: "Driver Confirmation", icon: Send, auto: true, desc: "Booking SMS sent. Waiting for driver to reply YES..." },
  // STEP 2: Send Addresses & Tracking (The "Reaction")
  { key: "tripMessage", label: "Send Dispatch Instructions", icon: MapPin, auto: false, desc: "Send Addresses & Tracking Link" },
  { key: "puArrived", label: "Arrived at Pickup", icon: MapPin, auto: true, desc: "Monitoring GPS geofence / Driver status..." },
  { key: "annexNotified", label: "Annex Notified", icon: ShieldCheck, auto: true, desc: "System auto-alerts Annex team." },
  { key: "puDocs", label: "Pickup Docs Uploaded", icon: FileText, auto: true, desc: "Scanning for BOL upload..." },
  { key: "brokerConfirmed", label: "Broker Confirmed", icon: CheckCircle2, auto: false, desc: "VA: Call broker to confirm loaded." },
  { key: "transitMonitored", label: "In Transit Monitoring", icon: Clock, auto: true, desc: "Tracking GPS macro-point updates..." },
  { key: "delDocsRequested", label: "Request Delivery Docs", icon: FileText, auto: true, desc: "Auto-SMS sent 50 miles out." },
  { key: "driverReleased", label: "Driver Released", icon: Truck, auto: false, desc: "VA: Verify empty & clear driver." },
  { key: "docsToEinstein", label: "Docs to Einstein AI", icon: FileText, auto: true, desc: "AI analyzing POD for signature..." },
  { key: "factoringSent", label: "Factoring Submission", icon: DollarSign, auto: false, desc: "VA: Submit invoice to factoring." },
  { key: "fuelLogged", label: "Log Fuel Expenses", icon: Fuel, auto: false, desc: "VA: Enter fuel costs." },
  { key: "brokerThankYou", label: "Broker Thank You", icon: ThumbsUp, auto: false, desc: "Send automated thank you email." },
];

export function EVChecklist({ load }: EVChecklistProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Load State - merge driverConfirmedAt into SOP progress
  const [steps, setSteps] = useState(() => {
    const baseProgress = load.sopProgress || {};
    // Auto-complete "initialSms" step if driver confirmed the load via SMS
    if (load.driverConfirmedAt) {
      return { ...baseProgress, initialSms: true };
    }
    return baseProgress;
  });
  
  // Update steps when load.driverConfirmedAt changes
  useEffect(() => {
    if (load.driverConfirmedAt && !steps.initialSms) {
      setSteps((prev: any) => ({ ...prev, initialSms: true }));
    }
  }, [load.driverConfirmedAt]);

  // Find Active Step
  const activeIndex = STEPS_CONFIG.findIndex(s => !steps[s.key]);
  const currentStep = activeIndex === -1 ? null : STEPS_CONFIG[activeIndex];

  // Auto-Scroll to Active Step
  useEffect(() => {
    if (scrollRef.current) {
      const activeElement = scrollRef.current.querySelector('[data-active="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeIndex]);

  // DB Sync
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
    toast({ title: "Updated", description: "SOP progress synced." });
  };

  // Automated Action Handler
  const triggerAction = async (type: string, stepKey: string) => {
    try {
      toast({ title: "System Working...", description: "Executing automated command." });
      await apiRequest("POST", `/api/sms/send-template`, { loadId: load.id, type });
      toggleStep(stepKey, true); // Auto-advance on success
    } catch (e) {
      toast({ title: "Error", variant: "destructive", description: "Command failed." });
    }
  };

  return (
    <Card className="h-full bg-slate-950 border-slate-800 text-slate-100 flex flex-col shadow-none">
      
      {/* HEADER */}
      <CardHeader className="py-3 border-b border-slate-900 bg-slate-900/50">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-sm">Victory Protocol</h3>
          </div>
          <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono text-xs">
            {activeIndex === -1 ? "COMPLETED" : `STEP ${activeIndex + 1}/13`}
          </Badge>
        </div>
      </CardHeader>

      {/* SCROLLABLE STEPPER */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-1">
          
          {STEPS_CONFIG.map((step, index) => {
            const isCompleted = steps[step.key];
            const isActive = index === activeIndex;
            const isLocked = index > activeIndex;

            return (
              <div 
                key={step.key} 
                data-active={isActive}
                className={cn(
                  "relative border rounded-lg transition-all duration-500 overflow-hidden",
                  isActive 
                    ? "bg-slate-900/80 border-blue-500/50 shadow-[0_0_20px_-5px_rgba(59,130,246,0.15)] py-4 px-4 my-4 scale-105 z-10" 
                    : isCompleted 
                      ? "bg-slate-950 border-emerald-900/20 py-2 px-3 opacity-60 hover:opacity-100" 
                      : "bg-slate-950 border-slate-800 py-2 px-3 opacity-30"
                )}
              >
                {/* CONNECTING LINE */}
                {index !== STEPS_CONFIG.length - 1 && (
                  <div className={cn(
                    "absolute left-[19px] top-10 bottom-0 w-[2px] z-0",
                    isCompleted ? "bg-emerald-900" : "bg-slate-800",
                    isActive && "hidden" // Hide line for active expanded card
                  )} />
                )}

                <div className="flex items-center gap-3 relative z-10">
                  
                  {/* ICON INDICATOR */}
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
                    isActive 
                      ? "bg-blue-600 text-white border-blue-400" 
                      : isCompleted 
                        ? "bg-emerald-900/20 text-emerald-500 border-emerald-500/20" 
                        : "bg-slate-900 text-slate-600 border-slate-700"
                  )}>
                    {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : 
                     isActive ? <step.icon className="w-4 h-4 animate-pulse" /> :
                     <Lock className="w-3 h-3" />}
                  </div>

                  {/* CONTENT */}
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <h4 className={cn(
                        "text-sm font-medium",
                        isActive ? "text-white text-base" : isCompleted ? "text-emerald-500 line-through" : "text-slate-500"
                      )}>
                        {step.label}
                      </h4>
                      
                      {/* STATUS BADGE FOR ACTIVE */}
                      {isActive && (
                        <Badge className={cn(
                          "text-[10px] px-2",
                          step.auto ? "bg-blue-900/50 text-blue-300 animate-pulse border-blue-500/30" : "bg-amber-900/50 text-amber-300 border-amber-500/30"
                        )}>
                          {step.auto ? "🤖 MONITORING" : "👤 MANUAL ACTION"}
                        </Badge>
                      )}
                    </div>

                    {/* EXPANDED DETAILS (Only for Active Step) */}
                    {isActive && (
                      <div className="mt-3 pl-1 animate-in slide-in-from-top-2">
                        <p className="text-xs text-slate-400 mb-3 flex items-center gap-2">
                          {step.auto ? <Radio className="w-3 h-3 text-blue-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                          {step.desc}
                        </p>

                        <div className="flex gap-2">
                          {/* PRIMARY ACTION */}
                          {step.key === "tripMessage" ? (
                             <Button className="w-full bg-blue-600 font-bold" onClick={() => triggerAction("DISPATCH_INSTRUCTIONS", step.key)}>
                               <MapPin className="w-4 h-4 mr-2" /> Send Addresses & Tracking
                             </Button>
                          ) : (
                             <Button 
                               size="sm" 
                               variant={step.auto ? "secondary" : "default"}
                               className={cn(
                                 "w-full text-xs font-bold border",
                                 step.auto 
                                   ? "bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white" 
                                   : "bg-blue-600 border-blue-500 text-white hover:bg-blue-500"
                               )} 
                               onClick={() => toggleStep(step.key, true)}
                             >
                               {step.auto ? "⚠ MANUAL OVERRIDE (Confirm)" : "MARK COMPLETED"}
                             </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* SUCCESS MESSAGE */}
          {activeIndex === -1 && (
            <div className="p-8 text-center bg-emerald-900/10 border border-emerald-900/30 rounded-xl mt-4">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <ThumbsUp className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-emerald-400 font-bold text-lg">Mission Accomplished</h3>
              <p className="text-slate-500 text-xs mt-1">Load #17 Completed Successfully.</p>
            </div>
          )}

        </div>
      </ScrollArea>
    </Card>
  );
}
