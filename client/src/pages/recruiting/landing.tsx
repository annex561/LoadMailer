import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Truck, DollarSign, Calendar, Shield, MessageSquare } from "lucide-react";

export default function RecruitingLanding() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    hasCdl: "no",
    yearsExperience: 1,
    consentSms: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consentSms) {
      toast({
        title: "SMS consent required",
        description: "We need permission to text you about your application",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/recruiting/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          email: form.email,
          hasCdl: form.hasCdl === "yes",
          yearsExperience: form.yearsExperience,
          consentSms: true,
          leadSource: "landing-page",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setLocation(`/apply/${data.id}`);
    } catch (err) {
      toast({
        title: "Could not submit",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* NAV */}
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white font-bold">
              L
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">LAMP Logistics</div>
              <div className="text-xs text-slate-500">MC-1725755 · DOT 4397421</div>
            </div>
          </div>
          <a href="#apply" className="hidden sm:inline-flex rounded-lg bg-slate-900 px-4 py-2 text-white text-sm font-semibold hover:bg-slate-800">
            Apply Now
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="px-6 pt-16 pb-12 sm:pt-24">
        <div className="mx-auto max-w-6xl grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Now hiring · Box truck drivers
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900">
              Earn $4,000–$6,000 a week.
              <br />
              <span className="text-emerald-600">Paid every Friday.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-700 max-w-xl">
              LAMP gives box truck drivers steady freight, weekly settlements, an exclusive
              dispatcher, and zero runaround. Most loads do not require a CDL.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <Badge>80/20 split for owner-operators</Badge>
              <Badge>$1,200/wk W-2 base for company drivers</Badge>
              <Badge>Weekly pay every Friday</Badge>
              <Badge>Dedicated dispatcher</Badge>
            </div>
          </div>

          {/* APPLY FORM */}
          <Card id="apply" className="shadow-xl">
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-bold">Get Started in 60 Seconds</h2>
              <p className="text-sm text-slate-600 mt-1">
                Tell us a bit about yourself. We&apos;ll text you the application link in 5 minutes.
              </p>
              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      required
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      required
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    placeholder="(555) 555-5555"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="hasCdl">CDL?</Label>
                    <Select
                      value={form.hasCdl}
                      onValueChange={(v) => setForm({ ...form, hasCdl: v })}
                    >
                      <SelectTrigger id="hasCdl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="yearsExperience">Years driving</Label>
                    <Input
                      id="yearsExperience"
                      type="number"
                      min={0}
                      max={50}
                      value={form.yearsExperience}
                      onChange={(e) =>
                        setForm({ ...form, yearsExperience: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <Checkbox
                    checked={form.consentSms}
                    onCheckedChange={(v) => setForm({ ...form, consentSms: v === true })}
                    className="mt-0.5"
                  />
                  <span>
                    I agree to receive SMS updates from LAMP Logistics about my application.
                    Message and data rates may apply. Reply STOP to opt out at any time. See our{" "}
                    <a href="/privacy" className="underline">privacy policy</a>.
                  </span>
                </label>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting ? "Submitting…" : "Start My Application →"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-6 py-16 bg-slate-50">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-bold text-center text-slate-900">How LAMP Works</h2>
          <p className="mt-3 text-center text-slate-600 max-w-xl mx-auto">
            Application to first load in under 21 days. No paperwork chasing. No payment games.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <Step icon={<Truck className="h-6 w-6" />} title="You Apply">
              Quick application, then DOT-compliant forms on your phone. We text you status updates
              at every step.
            </Step>
            <Step icon={<Shield className="h-6 w-6" />} title="We Verify">
              Background, MVR, DOT physical, drug test. Most drivers complete in 7-10 business
              days.
            </Step>
            <Step icon={<DollarSign className="h-6 w-6" />} title="You Drive">
              Truck assigned, dispatcher loads your route, first settlement hits Friday.
            </Step>
          </div>
        </div>
      </section>

      {/* PAY */}
      <section className="px-6 py-16 bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold text-center">Pay At A Glance</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-800 p-6">
              <div className="text-emerald-400 text-sm font-semibold">OWNER-OPERATOR</div>
              <div className="mt-2 text-3xl font-bold">$3,800/wk avg</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                <li>• $5,000 avg gross revenue</li>
                <li>• You keep 80% = $4,000</li>
                <li>• Less driver-paid fuel (~$1,200)</li>
                <li>• Net ~$2,800 take-home weekly</li>
              </ul>
            </div>
            <div className="rounded-2xl bg-slate-800 p-6">
              <div className="text-emerald-400 text-sm font-semibold">COMPANY DRIVER (W-2)</div>
              <div className="mt-2 text-3xl font-bold">$1,200/wk base</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                <li>• Plus mileage bonus over base loads</li>
                <li>• No fuel out of pocket</li>
                <li>• No truck maintenance</li>
                <li>• Direct deposit Friday</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t px-6 py-10 text-center text-sm text-slate-500">
        LAMP Logistics LLC · MC-1725755 · DOT 4397421
      </footer>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
      <CheckCircle className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

function Step({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-bold">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{children}</p>
      </CardContent>
    </Card>
  );
}
