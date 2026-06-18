import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Truck, DollarSign, ShieldCheck, KeyRound, CalendarClock, Phone } from "lucide-react";

// Lease-to-own driver recruiting landing. Distinct "own your truck" angle.
// Wires into the SAME funnel as recruiting/landing.tsx: POST /api/recruiting/leads
// then redirect to /apply/:id. Served at /lease-to-own-box-truck (see App.tsx + seo-prerender.ts).
export default function OwnYourTruckLanding() {
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
          leadSource: "lease-to-own-landing",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      // Fire Meta Pixel Lead if a pixel is present (safe no-op otherwise).
      if (typeof window !== "undefined" && (window as any).fbq) {
        (window as any).fbq("track", "Lead");
      }
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
    <main
      className="force-light-theme min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900"
      style={{ colorScheme: "light" }}
    >
      {/* STICKY HEADER */}
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white font-bold text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="font-bold text-lg leading-tight text-slate-900">LAMP Logistics</div>
              <div className="text-xs text-slate-500 leading-tight">MC-1725755 · DOT 4397421</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="tel:+18333629813" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-emerald-700">
              <Phone className="h-4 w-4" /> (833) 362-9813
            </a>
            <a href="#apply" className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-white text-sm font-semibold hover:bg-emerald-700">
              Apply Now →
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="px-4 sm:px-6 pt-14 pb-12 sm:pt-20">
        <div className="mx-auto max-w-6xl grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Now hiring · Non-CDL box truck drivers
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900">
              Own your truck in
              <br />
              <span className="text-emerald-600">3 years.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-700 max-w-xl">
              $5,000 down, no credit check. Run on LAMP&apos;s authority and earn your first week.
              Build real equity every load until the truck is yours. Most loads need no CDL.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <Badge>$5,000 down · no credit check</Badge>
              <Badge>Own it in 36 months</Badge>
              <Badge>Paid every Friday</Badge>
              <Badge>Non-CDL box truck</Badge>
            </div>
          </div>

          {/* APPLY FORM */}
          <Card id="apply" className="shadow-xl">
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-bold">Claim Your Seat in 60 Seconds</h2>
              <p className="text-sm text-slate-600 mt-1">
                Tell us a bit about yourself. We&apos;ll text you the application link in 5 minutes.
              </p>
              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" type="tel" required placeholder="(555) 555-5555" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="hasCdl">CDL?</Label>
                    <Select value={form.hasCdl} onValueChange={(v) => setForm({ ...form, hasCdl: v })}>
                      <SelectTrigger id="hasCdl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no">No</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="yearsExperience">Years driving</Label>
                    <Input id="yearsExperience" type="number" min={0} max={50} value={form.yearsExperience} onChange={(e) => setForm({ ...form, yearsExperience: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <Checkbox checked={form.consentSms} onCheckedChange={(v) => setForm({ ...form, consentSms: v === true })} className="mt-0.5" />
                  <span>
                    I agree to receive SMS updates from LAMP Logistics about my application. Message and data rates may apply. Reply STOP to opt out at any time. See our{" "}
                    <a href="/privacy" className="underline">privacy policy</a>.
                  </span>
                </label>
                <Button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {submitting ? "Submitting…" : "Start My Application →"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="px-4 sm:px-6 py-16 bg-slate-50 border-y">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-sm font-bold tracking-wide text-emerald-600">The trap nobody warns you about</div>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">Going it alone is how good drivers go broke.</h2>
          <p className="mt-5 text-lg text-slate-700">
            You set up your own authority and then you sit. Brokers won&apos;t load a new MC for six
            months. The good freight goes to carriers with history. You fight for factoring and a
            dispatcher while the truck payment comes due. The truck payment doesn&apos;t sink most new
            drivers. The empty months do. We took the empty months out.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-4 sm:px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">Four steps to your own truck</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            <Step n="1" icon={<CheckCircle className="h-6 w-6" />} title="Apply & qualify">
              Valid license, clean record, ready to work. We verify fast. No credit pull.
            </Step>
            <Step n="2" icon={<DollarSign className="h-6 w-6" />} title="Put $6,500 down">
              $5,000 on the truck, $1,500 first month insurance. That holds your seat.
            </Step>
            <Step n="3" icon={<Truck className="h-6 w-6" />} title="Get seated, earn week one">
              On our authority, on a route, factored and paid that Friday. No death-valley wait.
            </Step>
            <Step n="4" icon={<KeyRound className="h-6 w-6" />} title="Own it in 3 years">
              Build equity every load. At 36 months the title is yours, free and clear.
            </Step>
          </div>
        </div>
      </section>

      {/* THE DEAL — DARK */}
      <section className="px-4 sm:px-6 py-16 bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center">The lease-to-own deal</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-800 p-6 border border-slate-700">
              <div className="text-emerald-400 text-sm font-semibold">WHAT YOU PUT IN</div>
              <div className="mt-2 text-3xl font-bold">$6,500 to start</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                <li>• $5,000 truck down payment</li>
                <li>• $1,500 first month insurance</li>
                <li>• No credit check, ever</li>
                <li>• About $185/week toward the truck</li>
              </ul>
            </div>
            <div className="rounded-2xl bg-slate-800 p-6 border border-slate-700">
              <div className="text-emerald-400 text-sm font-semibold">WHAT YOU GET</div>
              <div className="mt-2 text-3xl font-bold">A truck that becomes yours</div>
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                <li>• Run on LAMP&apos;s authority day one</li>
                <li>• Keep 80% of gross while you lease</li>
                <li>• Weekly settlements, itemized in TraqIQ</li>
                <li>• Title transfers to you in 36 months</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 rounded-2xl border border-emerald-500 bg-emerald-950 p-6 text-center">
            <div className="text-emerald-300 font-semibold">Pay it off early anytime.</div>
            <p className="mt-1 text-sm text-emerald-100">
              The day it&apos;s paid, the title is yours. Take it anywhere, run it however you want.
            </p>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="px-4 sm:px-6 py-14">
        <div className="mx-auto max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <Stat n="$5,000" label="Down to start" />
          <Stat n="$0" label="Credit check" />
          <Stat n="36 mo" label="To full ownership" />
          <Stat n="Friday" label="You get paid" />
        </div>
      </section>

      {/* PERKS */}
      <section className="px-4 sm:px-6 py-16 bg-slate-50 border-y">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">Why drivers run with LAMP</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <Perk icon={<ShieldCheck className="h-6 w-6" />} title="Our authority, day one">Run on our seasoned MC. Real freight, no six-month freeze.</Perk>
            <Perk icon={<Truck className="h-6 w-6" />} title="Steady freight">Dedicated routes dispatched to you. No load-hunting, no scammers.</Perk>
            <Perk icon={<DollarSign className="h-6 w-6" />} title="Paid weekly">Factored and itemized in TraqIQ. Every Friday.</Perk>
            <Perk icon={<ShieldCheck className="h-6 w-6" />} title="Insurance handled">On our policy, quoted weekly. No fighting for your own coverage.</Perk>
            <Perk icon={<KeyRound className="h-6 w-6" />} title="No credit check">$5,000 down puts you in the seat. Your FICO doesn&apos;t decide.</Perk>
            <Perk icon={<CalendarClock className="h-6 w-6" />} title="Real ownership">Equity every week. The title is yours in 3 years.</Perk>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 sm:px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">Questions, answered</h2>
          <div className="mt-10 space-y-3">
            <Faq q="Do I need a CDL?">No, for most loads. Our box trucks are under 26,001 GVWR, so a regular driver&apos;s license works. You still need a current DOT physical and a clean record.</Faq>
            <Faq q="Do you check credit?">No. The $5,000 down payment secures the truck, so your credit score does not decide whether you get in.</Faq>
            <Faq q="How much do I need to start?">$6,500. That is $5,000 toward the truck and $1,500 for your first month of insurance.</Faq>
            <Faq q="How long until I own it?">36 months on the standard schedule, and you can pay it off early anytime for the remaining balance.</Faq>
            <Faq q="What if I want to leave?">Once the truck is paid off, the title is yours and you can take it anywhere. While you are still leasing, it runs on LAMP&apos;s authority and insurance.</Faq>
            <Faq q="How fast can I start driving?">Most drivers go from application to first load in 10 to 21 days, depending on how fast your background check, MVR, drug test, and DOT physical clear.</Faq>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-4 sm:px-6 py-20 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white text-center">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold">Own your truck. Start today.</h2>
          <p className="mt-4 text-lg text-emerald-50">$5,000 down, no credit check, earning week one. Seats are limited.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#apply" className="inline-flex rounded-lg bg-white px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-50">Apply Now →</a>
            <a href="tel:+18333629813" className="inline-flex items-center gap-2 rounded-lg border border-white/70 px-6 py-3 font-semibold text-white hover:bg-white/10">
              <Phone className="h-4 w-4" /> (833) 362-9813
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-4 sm:px-6 py-12 bg-white border-t">
        <div className="mx-auto max-w-6xl grid gap-8 sm:grid-cols-4 text-sm">
          <div>
            <div className="font-bold text-slate-900">LAMP Logistics LLC</div>
            <div className="mt-2 text-slate-500">Box truck freight. Own your truck in 3 years.</div>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Drive</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li><a href="#apply" className="hover:text-emerald-700">Apply</a></li>
              <li><a href="/owner-operator-jobs" className="hover:text-emerald-700">Owner-operator jobs</a></li>
              <li><a href="/non-cdl-truck-driver-jobs" className="hover:text-emerald-700">Non-CDL jobs</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Contact</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li><a href="tel:+18333629813" className="hover:text-emerald-700">(833) 362-9813</a></li>
              <li>MC-1725755 · DOT 4397421</li>
            </ul>
          </div>
          <div className="text-slate-500">
            LAMP Logistics is an equal opportunity contractor. Income depends on the loads you run and is not guaranteed.
          </div>
        </div>
      </footer>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
      <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
      {children}
    </span>
  );
}

function Step({ n, icon, title, children }: { n: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">{icon}</div>
          <span className="text-2xl font-bold text-emerald-600">{n}</span>
        </div>
        <h3 className="mt-4 text-lg font-bold">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{children}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="text-3xl font-bold text-emerald-600">{n}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function Perk({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">{icon}</div>
        <h3 className="mt-4 text-lg font-bold">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{children}</p>
      </CardContent>
    </Card>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer list-none font-semibold text-slate-900 flex items-center justify-between">
        {q}
        <span className="ml-4 text-emerald-600 group-open:rotate-45 transition-transform">+</span>
      </summary>
      <p className="mt-3 text-sm text-slate-600">{children}</p>
    </details>
  );
}
