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
    <main className="force-light-theme min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900" style={{ colorScheme: "light" }}>
      {/* STICKY HEADER */}
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3">
          <a href="#top" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white font-bold text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="font-bold text-lg leading-tight text-slate-900">LAMP Logistics</div>
              <div className="text-xs text-slate-500 leading-tight">MC-1725755 · DOT 4397421</div>
            </div>
          </a>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium">
            <a href="#how" className="text-slate-700 hover:text-emerald-700 transition-colors">How It Works</a>
            <a href="#pay" className="text-slate-700 hover:text-emerald-700 transition-colors">Pay</a>
            <a href="#why" className="text-slate-700 hover:text-emerald-700 transition-colors">Why LAMP</a>
            <a href="tel:+14234214111" className="text-slate-700 hover:text-emerald-700 transition-colors">
              📞 (423) 421-4111
            </a>
            <a
              href="#apply"
              className="inline-flex rounded-lg bg-emerald-600 hover:bg-emerald-700 px-5 py-2.5 text-white text-sm font-semibold shadow-sm transition-colors"
            >
              Apply Now →
            </a>
          </div>
          <a
            href="#apply"
            className="md:hidden inline-flex rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-white text-sm font-semibold"
          >
            Apply →
          </a>
        </div>
      </nav>
      <div id="top" />
      {/* Section anchor: Why LAMP fallback to How (no separate section yet) */}
      <a id="why" />
      {/* Apply form anchor sits inside the hero below */}

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

      {/* PAY (forced dark even on light page — high contrast money section) */}
      <section id="pay" className="px-6 py-20" style={{ backgroundColor: "#0f172a", color: "#ffffff" }}>
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center" style={{ color: "#ffffff" }}>
            Pay At A Glance
          </h2>
          <p className="mt-3 text-center" style={{ color: "#cbd5e1" }}>
            Real numbers, not promises. Average box truck driver income with LAMP.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl p-6 border" style={{ backgroundColor: "#1e293b", borderColor: "#334155" }}>
              <div className="text-sm font-bold tracking-wide" style={{ color: "#34d399" }}>OWNER-OPERATOR</div>
              <div className="mt-2 text-4xl font-bold" style={{ color: "#ffffff" }}>$3,800/wk avg</div>
              <ul className="mt-5 space-y-2.5 text-sm" style={{ color: "#cbd5e1" }}>
                <li>✓ $5,000 average gross revenue per week</li>
                <li>✓ You keep 80% = $4,000</li>
                <li>✓ Less driver-paid fuel (~$1,200)</li>
                <li>✓ <strong style={{ color: "#ffffff" }}>~$2,800 take-home every Friday</strong></li>
                <li>✓ Use LAMP authority, dispatcher, and TraqIQ platform</li>
              </ul>
            </div>
            <div className="rounded-2xl p-6 border" style={{ backgroundColor: "#1e293b", borderColor: "#334155" }}>
              <div className="text-sm font-bold tracking-wide" style={{ color: "#34d399" }}>COMPANY DRIVER (W-2)</div>
              <div className="mt-2 text-4xl font-bold" style={{ color: "#ffffff" }}>$1,200/wk base</div>
              <ul className="mt-5 space-y-2.5 text-sm" style={{ color: "#cbd5e1" }}>
                <li>✓ Mileage bonus over base loads</li>
                <li>✓ No fuel out of pocket</li>
                <li>✓ No truck maintenance — we handle it</li>
                <li>✓ <strong style={{ color: "#ffffff" }}>Direct deposit every Friday</strong></li>
                <li>✓ Eligible for performance bonuses after 90 days</li>
              </ul>
            </div>
          </div>

          {/* SIGN-ON BONUS BANNER */}
          <div className="mt-10 rounded-2xl border-2 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: "#34d399", backgroundColor: "#064e3b" }}>
            <div>
              <div className="text-sm font-bold tracking-wide" style={{ color: "#34d399" }}>
                LIMITED-TIME SIGN-ON BONUS
              </div>
              <div className="text-2xl sm:text-3xl font-bold mt-1" style={{ color: "#ffffff" }}>
                Get $500 in your first 30 days
              </div>
              <div className="text-sm mt-2" style={{ color: "#a7f3d0" }}>
                Complete orientation, deliver your first 5 loads, $500 bonus on your next settlement.
              </div>
            </div>
            <a href="#apply" className="inline-flex rounded-lg px-6 py-3 font-bold text-base whitespace-nowrap" style={{ backgroundColor: "#34d399", color: "#064e3b" }}>
              Claim My Bonus →
            </a>
          </div>
        </div>
      </section>

      {/* TRUST STATS */}
      <section className="px-6 py-16 bg-white border-y border-slate-200">
        <div className="mx-auto max-w-6xl grid gap-8 grid-cols-2 md:grid-cols-4 text-center">
          <Stat number="MC-1725755" label="Our own authority — no middle layer" />
          <Stat number="100%" label="On-time settlements" sub="Every Friday, every driver" />
          <Stat number="7-10 days" label="Avg app-to-driving time" sub="Most drivers complete in under 2 weeks" />
          <Stat number="2019+" label="Modern equipment" sub="ELD + dashcam included" />
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="px-6 py-20 bg-slate-50">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">What You Get With LAMP</h2>
          <p className="mt-3 text-center text-slate-600 max-w-2xl mx-auto">
            We treat drivers like the operators they are. No runaround, no chasing settlements, no missing pay.
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Perk title="Real Pay, On Time">
              Settlement Tuesday for the prior week, direct deposit hits Friday. No exceptions, no excuses.
            </Perk>
            <Perk title="Exclusive Dispatcher">
              One dispatcher dedicated to LAMP drivers only. Knows your truck, your lanes, your preferences.
            </Perk>
            <Perk title="Real Authority">
              LAMP holds its own MC (MC-1725755). You're not subleased through three layers of middlemen.
            </Perk>
            <Perk title="Modern Equipment">
              2019+ box trucks. ELD already installed. Dashcam coverage. Maintenance handled.
            </Perk>
            <Perk title="TraqIQ Platform">
              Load board, BOL upload, settlements, document storage, dispatcher chat — all in your pocket.
            </Perk>
            <Perk title="No CDL Required">
              Most of our loads are under 26,001 GVWR. Regular driver's license + DOT physical is enough.
            </Perk>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="px-6 py-20 bg-white">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">What Our Drivers Say</h2>
          <p className="mt-3 text-center text-slate-600">Real drivers. Real loads. Real settlements.</p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <Testimonial
              quote="Other carriers held my pay for 2-3 weeks. LAMP pays Friday, every Friday. First time in years I can budget my mortgage."
              name="Marcus T."
              role="Owner-Operator · Atlanta, GA"
              years="2 years with LAMP"
            />
            <Testimonial
              quote="The dispatcher knows me by name. He's not juggling 50 carriers. He just works for us. Loads come in early so I can plan my week."
              name="James R."
              role="Owner-Operator · Chattanooga, TN"
              years="14 months with LAMP"
            />
            <Testimonial
              quote="No CDL, no problem. I was driving box trucks for Amazon before. LAMP got me paying 3x more in 2 weeks. TraqIQ app makes everything easy."
              name="Antoine W."
              role="Company Driver · Birmingham, AL"
              years="8 months with LAMP"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-20 bg-slate-50">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">Driver Questions</h2>
          <p className="mt-3 text-center text-slate-600">The stuff every driver asks before signing on.</p>
          <div className="mt-12 space-y-3">
            <Faq q="Do I need a CDL to drive for LAMP?" a="For most LAMP loads, no. Our box trucks are under 26,001 GVWR which doesn't require a CDL — just a regular driver's license. You still need a current DOT physical and a clean driving record." />
            <Faq q="How fast can I start driving?" a="Most drivers go from application to first load in 10–21 days. The timeline depends on how fast your background check, MVR, drug test, and DOT physical come back." />
            <Faq q="Do I have to own my own truck?" a="No. We offer both options. Owner-operators get an 80/20 split (you keep 80% of gross). Company drivers get $1,200/week W-2 base plus mileage bonuses — no truck payment, no fuel out of pocket." />
            <Faq q="When and how do I get paid?" a="Every Friday. Settlements process Tuesday for the prior week, deposit hits your account Friday. You see a full settlement statement in TraqIQ — no guessing, no missing line items." />
            <Faq q="What disqualifies me from driving with LAMP?" a="Recent license suspension/revocation, DUI in the last 5 years, failed DOT drug or alcohol test, more than 2 moving violations in the past 3 years. Felony convictions are reviewed case-by-case." />
            <Faq q="What lanes do you run?" a="Regional and OTR mix — primarily Southeast (TN, GA, AL, FL, NC, SC, KY) with some Midwest runs. Home time depends on your lane preference. Tell your dispatcher what works." />
            <Faq q="Who's my dispatcher and how do they communicate?" a="LAMP has an exclusive dispatcher dedicated only to our drivers. You'll meet them during orientation. Communication is through TraqIQ messaging — fast, clear, and tracked." />
            <Faq q="Is the $500 sign-on bonus real?" a="Yes. Complete orientation, deliver your first 5 loads on time, and $500 hits your settlement on day 30. No fine print, no clawbacks." />
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-6 py-20" style={{ background: "linear-gradient(135deg, #064e3b 0%, #047857 100%)" }}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold" style={{ color: "#ffffff" }}>
            Ready to drive with LAMP?
          </h2>
          <p className="mt-4 text-lg" style={{ color: "#d1fae5" }}>
            Application takes 60 seconds. We text you next steps within 5 minutes.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#apply"
              className="inline-flex justify-center rounded-lg px-8 py-4 font-bold text-base shadow-lg"
              style={{ backgroundColor: "#ffffff", color: "#064e3b" }}
            >
              Start My Application →
            </a>
            <a
              href="tel:+14234214111"
              className="inline-flex justify-center items-center rounded-lg border-2 px-8 py-4 font-bold text-base"
              style={{ borderColor: "#ffffff", color: "#ffffff" }}
            >
              📞 Call Us: (423) 421-4111
            </a>
          </div>
          <p className="mt-6 text-sm" style={{ color: "#a7f3d0" }}>
            $500 sign-on bonus · Weekly pay · Modern equipment · Real authority
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white font-bold shadow-sm">
                  L
                </div>
                <div className="font-bold text-lg text-slate-900">LAMP Logistics</div>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Box truck carrier built by drivers, for drivers. Weekly pay. No runaround.
              </p>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-900">Drive With Us</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li><a href="#apply" className="hover:text-emerald-700">Apply Now</a></li>
                <li><a href="#pay" className="hover:text-emerald-700">Pay Details</a></li>
                <li><a href="#how" className="hover:text-emerald-700">How It Works</a></li>
                <li><a href="tel:+14234214111" className="hover:text-emerald-700">📞 (423) 421-4111</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-900">Compliance</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>MC-1725755</li>
                <li>DOT 4397421</li>
                <li><a href="/privacy" className="hover:text-emerald-700">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-emerald-700">Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-900">Equal Opportunity</div>
              <p className="mt-3 text-sm text-slate-600">
                LAMP Logistics LLC is an equal opportunity employer. We hire qualified drivers regardless of race, color, religion, sex, national origin, age, disability, or veteran status.
              </p>
            </div>
          </div>
          <div className="mt-10 pt-6 border-t border-slate-200 text-center text-sm text-slate-500">
            © {new Date().getFullYear()} LAMP Logistics LLC. All rights reserved. · MC-1725755 · DOT 4397421
          </div>
        </div>
      </footer>
    </main>
  );
}

function Stat({ number, label, sub }: { number: string; label: string; sub?: string }) {
  return (
    <div>
      <div className="text-3xl sm:text-4xl font-bold text-emerald-700">{number}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{label}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Perk({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 hover:border-emerald-300 hover:shadow-md transition-all">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-emerald-600" />
        <h3 className="font-bold text-slate-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}

function Testimonial({ quote, name, role, years }: { quote: string; name: string; role: string; years: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
      <div className="text-3xl text-emerald-600 leading-none">&ldquo;</div>
      <p className="mt-2 text-slate-700 leading-relaxed text-[15px]">{quote}</p>
      <div className="mt-5 pt-4 border-t border-slate-200">
        <div className="font-bold text-slate-900">{name}</div>
        <div className="text-xs text-slate-500">{role}</div>
        <div className="text-xs text-emerald-700 font-medium mt-0.5">{years}</div>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-5 open:shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between font-semibold text-slate-900 list-none">
        <span className="pr-4">{q}</span>
        <span className="text-2xl text-slate-400 group-open:rotate-45 transition-transform shrink-0">+</span>
      </summary>
      <p className="mt-4 text-slate-700 text-sm leading-relaxed">{a}</p>
    </details>
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
