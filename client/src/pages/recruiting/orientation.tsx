import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, BookOpen, ShieldCheck, Truck, Phone, AlertTriangle, DollarSign, Eye } from "lucide-react";

const MODULES = [
  {
    key: "welcome",
    icon: <BookOpen className="h-5 w-5" />,
    title: "Welcome to LAMP",
    summary:
      "Who we are: box-truck carrier built by drivers, for drivers. MC-1725755. Pay weekly. Dispatcher exclusive to LAMP drivers. Modern equipment. No payment games.",
  },
  {
    key: "traqiq",
    icon: <Eye className="h-5 w-5" />,
    title: "TraqIQ Platform",
    summary:
      "Your phone is your office. Load board, BOL upload, settlements, document storage, dispatcher messaging — all in TraqIQ. Login = your phone number.",
  },
  {
    key: "eld_hos",
    icon: <Truck className="h-5 w-5" />,
    title: "ELD + Hours of Service",
    summary:
      "Per 49 CFR Part 395: 11-hour driving limit, 14-hour shift, 30-min break by hour 8, 60/70-hour week. ELD installed. Always on-duty when in the truck.",
  },
  {
    key: "dvir",
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Pre-Trip Inspection (DVIR)",
    summary:
      "Required pre-trip + post-trip per 49 CFR 396.11. Tires, brakes, lights, mirrors, glass, wipers, horn, seatbelt, emergency equipment. Write up any defect in TraqIQ before driving.",
  },
  {
    key: "accident",
    icon: <AlertTriangle className="h-5 w-5" />,
    title: "Accident / Incident Response",
    summary:
      "Stop. Check for injuries. Call 911 if needed. Call dispatcher. Take photos. Get a police report. Post-accident drug + alcohol testing required per 49 CFR 382.303.",
  },
  {
    key: "drug_alcohol",
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Drug & Alcohol Policy",
    summary:
      "Pre-employment, random pool (≈25% annual rate), post-accident, reasonable-suspicion testing per 49 CFR Part 382. Refusal = positive. Zero tolerance.",
  },
  {
    key: "pay",
    icon: <DollarSign className="h-5 w-5" />,
    title: "Pay & Settlement",
    summary:
      "Settlement Tuesday for the prior week. Direct deposit Friday. Owner-operators: 80/20 of gross. Company drivers: $1,200/wk base + mileage. Settlement statement in TraqIQ.",
  },
  {
    key: "conduct",
    icon: <Phone className="h-5 w-5" />,
    title: "Conduct & Customers",
    summary:
      "Clean clothes (LAMP shirt provided). Be polite at pickup/delivery. No social media posts about loads. Customer issue → dispatcher first, never the customer back.",
  },
];

export default function DriverOrientation() {
  const [, params] = useRoute<{ id: string }>("/apply/:id/orientation");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [firstName, setFirstName] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/recruiting/applications/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.application?.firstName) setFirstName(data.application.firstName);
        const stage = data.application?.currentStage;
        // Redirect if past orientation or before
        if (
          stage &&
          stage !== "ORIENTATION" &&
          stage !== "AGREEMENT_SIGNED" &&
          stage !== "ORIENTATION_DONE"
        ) {
          setLocation(`/apply/${id}/status`);
        }
      })
      .catch(() => {});
  }, [id, setLocation]);

  const allAcknowledged = MODULES.every((m) => acknowledged[m.key]);
  const completedCount = MODULES.filter((m) => acknowledged[m.key]).length;

  async function handleComplete() {
    if (!id || !allAcknowledged) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recruiting/applications/${id}/orientation/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to mark complete");
      toast({ title: "Orientation complete", description: "Truck assignment is next." });
      setTimeout(() => setLocation(`/apply/${id}/status`), 1200);
    } catch (err) {
      toast({
        title: "Could not complete",
        description: "Try again or contact recruit@lamplogistics.com",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  if (!id) {
    return (
      <main className="force-light-theme min-h-screen flex items-center justify-center bg-white" style={{ colorScheme: "light" }}>
        <p className="text-slate-600">Invalid orientation link.</p>
      </main>
    );
  }

  return (
    <main className="force-light-theme min-h-screen bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a href="/drive-with-lamp" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white font-bold text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="font-bold text-lg leading-tight text-slate-900">LAMP Logistics</div>
              <div className="text-xs text-slate-500 leading-tight">Driver Orientation</div>
            </div>
          </a>
          <a href="tel:+18333629813" className="hidden sm:inline-flex text-sm text-slate-700 hover:text-emerald-700 font-medium">
            📞 (833) 362-9813
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
        <Card>
          <CardContent className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold">
              {firstName ? `${firstName}, ` : ""}driver orientation
            </h1>
            <p className="mt-2 text-slate-600">
              Read each section. Check the box to acknowledge. Once all 8 are acknowledged you&apos;re cleared for truck assignment.
            </p>
            <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
              <strong>{completedCount}/{MODULES.length}</strong> modules acknowledged
              {allAcknowledged ? " — ready to complete." : "."}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {MODULES.map((m, i) => (
            <Card key={m.key}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                      acknowledged[m.key]
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {acknowledged[m.key] ? <CheckCircle2 className="h-5 w-5" /> : m.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">{i + 1}/{MODULES.length}</span>
                      <h3 className="font-bold text-slate-900">{m.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-700 leading-relaxed">{m.summary}</p>
                    <label className="mt-3 flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!acknowledged[m.key]}
                        onCheckedChange={(v) =>
                          setAcknowledged((prev) => ({ ...prev, [m.key]: v === true }))
                        }
                      />
                      <span className="text-sm font-medium text-slate-800">
                        I read this and I acknowledge it
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="p-6 text-center">
            <Button
              disabled={!allAcknowledged || submitting}
              onClick={handleComplete}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
              size="lg"
            >
              {submitting ? "Completing…" : allAcknowledged ? "Mark Orientation Complete →" : `Acknowledge all ${MODULES.length} modules to continue`}
            </Button>
            <p className="mt-3 text-xs text-slate-500">
              By submitting, you confirm you understand LAMP&apos;s policies. Full handbook and DOT regulations are available in TraqIQ once you&apos;re active.
            </p>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-slate-500">
          Questions? Email recruit@lamplogistics.com or call (833) 362-9813
        </div>
      </div>
    </main>
  );
}
