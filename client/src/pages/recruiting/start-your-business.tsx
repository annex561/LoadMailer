import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  Truck,
  FileCheck,
  Headset,
  Wallet,
  ClipboardList,
  Phone,
} from "lucide-react";

// "Start your own box truck business" landing — the à-la-carte / bundled
// services offer (authority formation, dispatch, truck sourcing).
//
// Distinct from own-your-truck.tsx: THAT page puts a driver on LAMP's
// authority. THIS page sets the customer up with their OWN authority and
// dispatches it, so the new-MC dead months never happen. The two pages must
// stay consistent on that point — see the "Why a new authority sits" section.
//
// Wires into the same funnel as the other landings: POST /api/recruiting/leads
// then redirect to /apply/:id. Served at /start-your-box-truck-business
// (see App.tsx + seo-prerender.ts).

// ---------------------------------------------------------------------------
// PRICING — set these, THEN flip SHOW_PRICING to true.
// While SHOW_PRICING is false every price slot renders "Get a quote" instead,
// so this page is safe to publish before the numbers are final.
//
// NOTE on the bundle: dispatch is a recurring % of gross, so it cannot be
// folded into a one-time figure. The $30,000 covers the truck and the
// authority filing; dispatch continues at 10% once the customer is running.
// The bundle is therefore NOT cheaper than à la carte at the bottom of the
// truck range ($25,000 truck + $2,500 authority = $27,500), which is why the
// card claims "complete package" rather than "best value".
// ---------------------------------------------------------------------------
const SHOW_PRICING = true;

const PRICING = {
  bundle: "$30,000", // truck + authority filing; dispatch billed separately
  authority: "$2,500", // one-time authority formation package
  dispatch: "10%", // of gross, ongoing
  truckLow: "$25,000", // low end of the box trucks you source
  truckHigh: "$45,000", // high end
};

function price(value: string) {
  return SHOW_PRICING ? value : "Get a quote";
}

const SERVICES = [
  { key: "authority", label: "Authority — MC + DOT in my name" },
  { key: "dispatch", label: "Dispatch — find and book my loads" },
  { key: "truck", label: "Truck — help me buy a box truck" },
] as const;

type ServiceKey = (typeof SERVICES)[number]["key"];

export default function StartYourBusinessLanding() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [services, setServices] = useState<ServiceKey[]>([]);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    consentSms: false,
  });

  function toggleService(key: ServiceKey, on: boolean) {
    setServices((prev) => (on ? [...prev, key] : prev.filter((s) => s !== key)));
  }

  // leadSource carries both what they want and where they came from, so the
  // recruiting dashboard can segment without a schema change. The Marketplace
  // listing links here with ?src=fb-marketplace.
  function buildLeadSource() {
    const wanted = services.length === SERVICES.length ? "bundle" : services.join(",") || "unspecified";
    const src =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("src")
        : null;
    return `start-your-business|services=${wanted}${src ? `|src=${src}` : ""}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consentSms) {
      toast({
        title: "SMS consent required",
        description: "We need permission to text you about your setup",
        variant: "destructive",
      });
      return;
    }
    if (services.length === 0) {
      toast({
        title: "Pick at least one service",
        description: "Tell us what you need so we can quote it",
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
          consentSms: true,
          leadSource: buildLeadSource(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      if (typeof window !== "undefined" && (window as any).fbq) {
        (window as any).fbq("track", "Lead");
      }
      // Deliberately NOT redirecting to /apply/:id. That is the DOT driver
      // application — wrong next step for someone buying business services.
      // The lead is in the CRM; a human follows up with the quote.
      setSubmitted(true);
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
            <a
              href="tel:+18333629813"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-emerald-700"
            >
              <Phone className="h-4 w-4" /> (833) 362-9813
            </a>
            <a
              href="#start"
              className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              Get Started →
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
              Now onboarding new carriers
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900">
              Your own authority.
              <br />
              <span className="text-emerald-600">Loaded from day one.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-700 max-w-xl">
              We file your MC and DOT, put you in a road-ready box truck, and dispatch you
              ourselves — so the months most new carriers spend sitting never happen. You own
              the business. You own the truck. We keep it loaded.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <Badge>Authority in your name</Badge>
              <Badge>Dispatch from week one</Badge>
              <Badge>Take one service or all three</Badge>
            </div>
          </div>

          {/* START FORM */}
          <Card id="start" className="shadow-xl">
            {submitted ? (
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-xl font-bold">Got it, {form.firstName}.</h2>
                <p className="mt-2 text-slate-600">
                  We have what you need and we&apos;re putting your quote together. Expect a text
                  at {form.phone} — usually same day.
                </p>
                <p className="mt-4 text-sm text-slate-500">
                  Want to talk it through now?{" "}
                  <a href="tel:+18333629813" className="font-semibold text-emerald-700">
                    (833) 362-9813
                  </a>
                </p>
              </CardContent>
            ) : (
            <CardContent className="p-6 sm:p-8">
              <h2 className="text-xl font-bold">Tell us what you need</h2>
              <p className="text-sm text-slate-600 mt-1">
                Pick the pieces you want. We&apos;ll text you a quote — usually same day.
              </p>
              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-900 mb-2">
                    What do you need?
                  </legend>
                  {SERVICES.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40"
                    >
                      <Checkbox
                        checked={services.includes(s.key)}
                        onCheckedChange={(v) => toggleService(s.key, v === true)}
                      />
                      <span className="text-slate-800">{s.label}</span>
                    </label>
                  ))}
                  <p className="text-xs text-slate-500 pt-1">
                    Need all three? Check all three and we&apos;ll quote the full package.
                  </p>
                </fieldset>

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
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <Checkbox
                    checked={form.consentSms}
                    onCheckedChange={(v) => setForm({ ...form, consentSms: v === true })}
                    className="mt-0.5"
                  />
                  <span>
                    I agree to receive SMS updates from LAMP Logistics about my setup. Message
                    and data rates may apply. Reply STOP to opt out at any time. See our{" "}
                    <a href="/privacy" className="underline">
                      privacy policy
                    </a>
                    .
                  </span>
                </label>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting ? "Submitting…" : "Get My Quote →"}
                </Button>
              </form>
            </CardContent>
            )}
          </Card>
        </div>
      </section>

      {/* THE PROBLEM */}
      <section className="px-4 sm:px-6 py-16 bg-slate-50 border-y">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-sm font-bold tracking-wide text-emerald-600">
            Why most new authorities fail
          </div>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">
            Getting the MC is the easy part.
          </h2>
          <p className="mt-5 text-lg text-slate-700">
            Anyone can file for authority. The problem starts the day it activates. Brokers
            won&apos;t hand good freight to an MC with no history, so a brand-new carrier sits
            for months bidding on whatever is left — while the truck payment, the insurance,
            and the plates all come due on schedule. That gap is what kills new carriers, and
            it is the whole reason people are told to just drive for someone else instead.
          </p>
          <p className="mt-5 text-lg font-semibold text-slate-900">
            A new authority sits because nobody is feeding it. We feed it.
          </p>
        </div>
      </section>

      {/* SERVICES */}
      <section className="px-4 sm:px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">
            Take one piece, or the whole thing
          </h2>
          <p className="mt-3 text-center text-slate-600 max-w-2xl mx-auto">
            Already own a truck? Take dispatch only. Already have your authority? Skip it.
            Nothing here is bundled against your will.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <Service
              icon={<FileCheck className="h-6 w-6" />}
              title="Authority Formation"
              priceLabel={price(PRICING.authority)}
              priceNote="one-time"
            >
              <li>MC operating authority + USDOT number</li>
              <li>BOC-3 blanket process agent filing</li>
              <li>UCR registration for your state</li>
              <li>Insurance filings submitted to FMCSA</li>
              <li>Filed in your name — you own the authority</li>
            </Service>

            <Service
              icon={<Headset className="h-6 w-6" />}
              title="Dispatch"
              priceLabel={price(PRICING.dispatch)}
              priceNote="of gross"
            >
              <li>We source and book your freight</li>
              <li>Rate negotiation on every load</li>
              <li>Rate cons and broker paperwork handled</li>
              <li>Factoring set up so you are paid weekly</li>
              <li>Every load itemized in the TraqIQ portal</li>
            </Service>

            <Service
              icon={<Truck className="h-6 w-6" />}
              title="Truck Sourcing"
              priceLabel={
                SHOW_PRICING ? `${PRICING.truckLow}–${PRICING.truckHigh}` : "Get a quote"
              }
              priceNote="typical range"
            >
              <li>Road-ready box trucks, inspected before you buy</li>
              <li>Financing options available</li>
              <li>Most units under 26,001 GVWR — no CDL needed</li>
              <li>We tell you what it actually needs, not what sells it</li>
            </Service>
          </div>

          {/* BUNDLE */}
          <div className="mt-8 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                  COMPLETE PACKAGE
                </div>
                <h3 className="mt-3 text-2xl font-bold text-slate-900">
                  The full startup package
                </h3>
                <p className="mt-2 text-slate-700 max-w-2xl">
                  All three, sequenced so nothing sits idle: we source the truck while your
                  authority is in the FMCSA queue, and dispatch is live the day it activates.
                </p>
                {SHOW_PRICING && (
                  <p className="mt-3 text-sm text-slate-600 max-w-2xl">
                    Covers the truck and your authority filing. Dispatch runs at{" "}
                    {PRICING.dispatch} of gross once you are hauling, same as it does on its
                    own.
                  </p>
                )}
              </div>
              <div className="text-center sm:text-right shrink-0">
                <div className="text-3xl font-bold text-emerald-700">
                  {price(PRICING.bundle)}
                </div>
                {SHOW_PRICING && (
                  <div className="text-xs text-slate-500">truck + authority</div>
                )}
                <a
                  href="#start"
                  className="mt-3 inline-flex rounded-lg bg-emerald-600 px-5 py-2.5 text-white text-sm font-semibold hover:bg-emerald-700"
                >
                  Start here →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-4 sm:px-6 py-16 bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center">How the full package runs</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            <DarkStep n="1" icon={<ClipboardList className="h-6 w-6" />} title="We file">
              MC, DOT, BOC-3, UCR and your insurance filings go in. FMCSA runs its own clock
              from there — usually 4 to 6 weeks to active authority.
            </DarkStep>
            <DarkStep n="2" icon={<Truck className="h-6 w-6" />} title="You get the truck">
              We source and inspect while the filing is pending, so the truck is ready before
              the authority is.
            </DarkStep>
            <DarkStep n="3" icon={<Headset className="h-6 w-6" />} title="Dispatch goes live">
              The day your authority activates, our desk starts booking. No cold-start months.
            </DarkStep>
            <DarkStep n="4" icon={<Wallet className="h-6 w-6" />} title="You get paid">
              Factored and itemized in TraqIQ. You are running your own carrier, on your own
              numbers.
            </DarkStep>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 sm:px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">
            Straight answers
          </h2>
          <div className="mt-10 space-y-3">
            <Faq q="Do I own the authority, or do you?">
              You do. The MC and DOT are filed in your business name and stay yours whether or
              not you keep using our dispatch. That is the difference between this and running
              on someone else&apos;s authority.
            </Faq>
            <Faq q="How long until I can haul?">
              FMCSA controls that timeline, not us. Filing to active authority usually runs 4
              to 6 weeks, including the mandatory public protest period. We use those weeks to
              get the truck and your insurance in place so nothing waits afterward.
            </Faq>
            <Faq q="Do I need a CDL?">
              Not for most box truck freight. Trucks under 26,001 lbs GVWR run on a regular
              driver&apos;s license. You still need a current DOT physical and a clean record.
            </Faq>
            <Faq q="Who pays for maintenance and repairs?">
              You do — it is your truck. We do not run a repair shop, and we would rather tell
              you that up front than surprise you later. What we do is inspect before you buy,
              so you are not starting out with someone else&apos;s problem, and budget
              maintenance into the numbers we quote you.
            </Faq>
            <Faq q="Can I just take dispatch?">
              Yes. If you already have a truck and active authority, dispatch stands alone.
              Same for authority formation if you only need the filings.
            </Faq>
            <Faq q="What if I already tried and my authority is sitting?">
              That is the most common call we get. If your MC is active and you have a truck,
              dispatch is the only piece you are missing — that one can start immediately.
            </Faq>
            <Faq q="Am I an employee?">
              No. You are an independent carrier running your own business. We are a service
              provider to you, not your employer.
            </Faq>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-4 sm:px-6 py-20 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white text-center">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold">Own the business, not just the truck.</h2>
          <p className="mt-4 text-lg text-emerald-50">
            Tell us which pieces you need and we&apos;ll quote it today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#start"
              className="inline-flex rounded-lg bg-white px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Get My Quote →
            </a>
            <a
              href="tel:+18333629813"
              className="inline-flex items-center gap-2 rounded-lg border border-white/70 px-6 py-3 font-semibold text-white hover:bg-white/10"
            >
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
            <div className="mt-2 text-slate-500">
              Authority, dispatch, and trucks for new box truck carriers.
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Services</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>
                <a href="#start" className="hover:text-emerald-700">
                  Get a quote
                </a>
              </li>
              <li>
                <a href="/lease-to-own-box-truck" className="hover:text-emerald-700">
                  Lease-to-own instead
                </a>
              </li>
              <li>
                <a href="/owner-operator-jobs" className="hover:text-emerald-700">
                  Owner-operator jobs
                </a>
              </li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Contact</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>
                <a href="tel:+18333629813" className="hover:text-emerald-700">
                  (833) 362-9813
                </a>
              </li>
              <li>MC-1725755 · DOT 4397421</li>
            </ul>
          </div>
          <div className="text-slate-500">
            LAMP Logistics provides business services to independent carriers. Authority
            approval timelines are set by FMCSA. Earnings depend on the loads you run and are
            not guaranteed.
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

function Service({
  icon,
  title,
  priceLabel,
  priceNote,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  priceLabel: string;
  priceNote: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="p-6 flex flex-col h-full">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-bold">{title}</h3>
        <div className="mt-2">
          <div className="text-2xl font-bold text-emerald-600">{priceLabel}</div>
          {SHOW_PRICING && <div className="text-xs text-slate-500">{priceNote}</div>}
        </div>
        <ul className="mt-4 space-y-2 text-sm text-slate-600 flex-1">{children}</ul>
        <a
          href="#start"
          className="mt-6 inline-flex justify-center rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          Select this →
        </a>
      </CardContent>
    </Card>
  );
}

function DarkStep({
  n,
  icon,
  title,
  children,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-slate-800 p-6 border border-slate-700">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-900 text-emerald-300">
          {icon}
        </div>
        <span className="text-2xl font-bold text-emerald-400">{n}</span>
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm text-slate-300">{children}</p>
    </div>
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
