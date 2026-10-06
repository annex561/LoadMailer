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
  Headset,
  Wallet,
  ClipboardList,
  Phone,
  ShieldCheck,
} from "lucide-react";

// "New MC, no loads" landing — for owner-operators who already have (or are
// filing) their own authority and need freight.
//
// Two doors, keyed to how old the MC is, because dispatch alone cannot solve a
// brand-new authority: brokers screen the MC, not the dispatcher. An unseasoned
// MC goes on LAMP's authority at 80/20 and keeps aging; a seasoned one keeps its
// own authority and buys dispatch at 10%. Selling dispatch to a 30-day-old MC
// would be selling something the broker side will decline.
//
// Distinct from the other three recruiting landings:
//   /drive-with-lamp              — drive LAMP's truck on LAMP's authority
//   /lease-to-own-box-truck       — no capital, wants to own a truck
//   /start-your-box-truck-business— buying authority / dispatch / truck services
// THIS page — already a carrier (or about to be) and the truck is empty.
//
// Leads POST to /api/recruiting/leads and do NOT redirect to /apply/:id (that
// is the DOT driver application — wrong audience). See seo-prerender.ts for the
// crawler copy, which must stay in sync with the FAQ below.

// ---------------------------------------------------------------------------
// TERMS — every number this page claims lives here, so the copy, the FAQ and
// the SEO entry cannot drift apart. Sourced from the existing owner-operator
// offer; do not change one without changing server/seo-prerender.ts to match.
//
// NOTE on "90 days": this is the figure the rest of the site uses for how long
// brokers screen out a new authority. It is a floor and broker-by-broker in
// practice, never a promise — the copy says so wherever it appears.
// ---------------------------------------------------------------------------
const TERMS = {
  ownerKeeps: "80%",
  split: "80/20",
  dispatchRate: "10%",
  seasoning: "90 days",
  cargoAsk: "$100,000",
  onboarding: "10 to 21 days",
  grossLow: "$4,000",
  grossHigh: "$6,000",
  gvwr: "26,001",
  phone: "(833) 362-9813",
};

// The one field that routes the lead. "new" and "none" belong in Door 1
// (run on LAMP's authority while yours seasons); "seasoned" belongs in Door 2
// (keep your authority, buy dispatch). Encoded into leadSource — see
// buildLeadSource — so the dispatcher knows which call to make before dialing.
const MC_AGE_OPTIONS = [
  { key: "none", label: "Not filed yet — still setting up" },
  { key: "new", label: `Active, under ${TERMS.seasoning}` },
  { key: "seasoned", label: `Active ${TERMS.seasoning} or longer` },
] as const;

type McAge = (typeof MC_AGE_OPTIONS)[number]["key"];

export default function NewMcNoLoadsLanding() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [mcAge, setMcAge] = useState<McAge | "">("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    consentSms: false,
  });

  // Encodes the MC age and the inbound channel into the free-form leadSource
  // column rather than adding a schema field. routes.ts reads the `mc=` segment
  // to pick the lead-capture copy and to label the lead for the dispatcher.
  function buildLeadSource() {
    const src =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("src")
        : null;
    return `new-mc-no-loads|mc=${mcAge || "unspecified"}${src ? `|src=${src}` : ""}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mcAge) {
      toast({
        title: "Tell us about your authority",
        description: "Which door you're in depends on how old your MC is",
        variant: "destructive",
      });
      return;
    }
    if (!form.consentSms) {
      toast({
        title: "SMS consent required",
        description: "We need permission to text you about your freight",
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
      // Deliberately NOT redirecting to /apply/:id. These people are carriers
      // already — the DOT driver application is the wrong next step. A
      // dispatcher calls them.
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
              <Phone className="h-4 w-4" /> {TERMS.phone}
            </a>
            <a
              href="#start"
              className="inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-white text-sm font-semibold hover:bg-emerald-700"
            >
              Get Loaded →
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
              Taking new carriers this week
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900">
              Your MC is active.
              <br />
              <span className="text-emerald-600">Your truck is empty.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-700 max-w-xl">
              That is not your fault and it is not a mystery. Brokers screen the MC, not the
              driver — and yours has no history for their insurance desk to point at. So the
              packets go in and nobody calls back.
            </p>
            <p className="mt-4 text-lg font-semibold text-slate-900 max-w-xl">
              You do not have to wait that out parked. Run alongside us while yours seasons.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <Badge>Loaded in {TERMS.onboarding}</Badge>
              <Badge>No forced dispatch</Badge>
              <Badge>Keep your own MC</Badge>
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
                  A dispatcher will call {form.phone} — usually same day — and tell you straight
                  which door you are in, even if the answer is wait a few more weeks.
                </p>
                <p className="mt-4 text-sm text-slate-500">
                  Rather talk now?{" "}
                  <a href="tel:+18333629813" className="font-semibold text-emerald-700">
                    {TERMS.phone}
                  </a>
                </p>
              </CardContent>
            ) : (
              <CardContent className="p-6 sm:p-8">
                <h2 className="text-xl font-bold">Tell us about your authority</h2>
                <p className="text-sm text-slate-600 mt-1">
                  How old your MC is decides which option actually works for you. We will tell
                  you on the first call.
                </p>
                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-slate-900 mb-2">
                      Your MC authority
                    </legend>
                    {MC_AGE_OPTIONS.map((o) => (
                      <label
                        key={o.key}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40"
                      >
                        <input
                          type="radio"
                          name="mcAge"
                          value={o.key}
                          checked={mcAge === o.key}
                          onChange={() => setMcAge(o.key)}
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <span className="text-slate-800">{o.label}</span>
                      </label>
                    ))}
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
                      I agree to receive SMS updates from LAMP Logistics about freight and
                      onboarding. Message and data rates may apply. Reply STOP to opt out at any
                      time. See our{" "}
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
                    {submitting ? "Submitting…" : "Get Loaded →"}
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
            Nobody warns you about this part
          </div>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">
            Getting the MC is the easy part.
          </h2>
          <p className="mt-5 text-lg text-slate-700">
            You did it right. Filed the authority, got the truck, bought the insurance, built
            the packet. Then you found out what everybody finds out: a new authority waits
            around {TERMS.seasoning} before most brokers will touch it, and plenty of them want
            to see {TERMS.cargoAsk} in cargo coverage before they will even open your packet.
            Factoring prices you like a stranger. The board shows you the freight nobody else
            took.
          </p>
          <p className="mt-5 text-lg text-slate-700">
            That is {TERMS.seasoning} of truck payments, insurance and plates on a truck that
            legally can work and practically cannot.
          </p>
          <p className="mt-5 text-lg font-semibold text-slate-900">
            The truck payment is not what breaks new carriers. The empty weeks are.
          </p>
        </div>
      </section>

      {/* THE TURN */}
      <section className="px-4 sm:px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
            So stop waiting on brokers to change their minds.
          </h2>
          <p className="mt-5 text-lg text-slate-700">
            They will not — not for {TERMS.seasoning}, and not because you asked nicely. What
            you can change is whose authority the freight moves under while yours gets older.
            Your MC keeps aging either way, parked or loaded. We would rather you were loaded.
          </p>
        </div>
      </section>

      {/* TWO DOORS */}
      <section className="px-4 sm:px-6 pb-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-slate-900">
            Two ways in. Your MC decides which.
          </h2>
          <p className="mt-3 text-center text-slate-600 max-w-2xl mx-auto">
            Not sure? Call. If your MC is too new for the second one we will tell you that
            instead of selling you dispatch the brokers will decline.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Door
              icon={<ShieldCheck className="h-6 w-6" />}
              eyebrow={`MC under ${TERMS.seasoning}, or not filed yet`}
              title="Run alongside us"
              headline={`You keep ${TERMS.ownerKeeps} of gross`}
              note={`${TERMS.split} split on our authority`}
            >
              <li>Your truck, your title, your MC — still yours, still aging</li>
              <li>Our authority, our insurance, our factoring, our broker relationships</li>
              <li>Loaded in {TERMS.onboarding} from paperwork, not next quarter</li>
              <li>No forced dispatch — you take the loads you take</li>
              <li>Settlements every Friday, every load itemized in TraqIQ</li>
              <li>Leave when yours is seasoned and take your own book with you</li>
            </Door>

            <Door
              icon={<Headset className="h-6 w-6" />}
              eyebrow={`MC ${TERMS.seasoning} or older`}
              title="Keep your authority"
              headline={`${TERMS.dispatchRate} of gross`}
              note="dispatch only"
            >
              <li>You stay the carrier — your MC, your insurance, your customers</li>
              <li>We source and book your loads and negotiate every rate</li>
              <li>Rate cons and broker paperwork handled</li>
              <li>Factoring set up so you are paid weekly</li>
              <li>Every load itemized in TraqIQ — the rate we got, not a number we made up</li>
              <li>Freight from brokers, direct shippers and our own contracts</li>
            </Door>
          </div>

          <div className="mt-8 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-6 sm:p-8">
            <h3 className="text-xl font-bold text-slate-900">Why the first one beats waiting</h3>
            <p className="mt-2 text-slate-700 max-w-3xl">
              {TERMS.seasoning} parked is {TERMS.seasoning} of payments against zero revenue.{" "}
              {TERMS.seasoning} at {TERMS.ownerKeeps} of gross is {TERMS.seasoning} of payments
              against freight — same truck, same MC quietly getting older in the background.
              When brokers stop screening you out, switch to dispatch and keep your own
              authority. Moving you from 20% to {TERMS.dispatchRate} means we make less per
              load, so you will hear it from us when it is real.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-4 sm:px-6 py-16 bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center">How it runs</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            <DarkStep n="1" icon={<Phone className="h-6 w-6" />} title="One call">
              Your MC number, your truck, your lanes, how fast you need to move. We tell you
              which door you are in.
            </DarkStep>
            <DarkStep n="2" icon={<ClipboardList className="h-6 w-6" />} title="Paperwork">
              Title or lease, current commercial insurance, last inspection, MVR, DOT physical.
              If the truck needs an inspection first, you hear it before you spend money.
            </DarkStep>
            <DarkStep n="3" icon={<Truck className="h-6 w-6" />} title="You clear">
              {TERMS.onboarding} once your paperwork is in. Your dispatcher is a person with a
              name and a direct line, not a queue.
            </DarkStep>
            <DarkStep n="4" icon={<Wallet className="h-6 w-6" />} title="You get paid">
              First load, then first Friday. Factored and itemized in TraqIQ so you can check
              our math.
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
            <Faq q="I just paid for my own MC. Why would I run under yours?">
              You keep yours — nothing here cancels it, and it keeps seasoning while you run.
              The question is not whose authority is better. It is whether you would rather
              spend the next {TERMS.seasoning} loaded under ours or parked under yours. When
              brokers stop screening you out, switch to dispatch and keep your own authority.
            </Faq>
            <Faq q={`What's the catch on the ${TERMS.split} split?`}>
              There is not a hidden one. We take 20% of gross, and out of it comes the
              authority, the insurance, the factoring, the broker relationships and the
              dispatcher. You take {TERMS.ownerKeeps} and your truck&apos;s costs — fuel,
              maintenance, your own insurance where it applies. Your dispatcher walks the whole
              settlement with you on the first call, before you sign anything.
            </Faq>
            <Faq q="Can I leave?">
              Yes, with your book. We are not going to pretend otherwise — if we have to trap
              you to keep you, we already lost you.
            </Faq>
            <Faq q="Do you guarantee what I'll make?">
              No, and be careful with anybody who does. Owner-operators here run in the{" "}
              {TERMS.grossLow}–{TERMS.grossHigh} per week gross range, and what you actually
              clear depends on your lanes, your uptime and the loads you accept. On the first
              call we will show you real recent rates on your lanes instead of a billboard
              number.
            </Faq>
            <Faq q="My insurance limits are lower than what brokers are asking.">
              Common, and one of the main reasons new MCs get declined. On our authority that is
              our problem, not yours — the freight moves under our coverage. On dispatch we will
              tell you exactly what the brokers on your lanes require before you spend a dollar
              changing your policy.
            </Faq>
            <Faq q="Is this Amazon Relay freight?">
              No, and that is the point. Keep your Relay account and run it. But one miss can
              zero an acceptance score and take weeks to climb back, and we would rather you
              were not betting your month on one platform&apos;s opinion of you.
            </Faq>
            <Faq q="Do I need a CDL?">
              Not for most box truck freight. Under {TERMS.gvwr} lbs GVWR runs on a regular
              driver&apos;s license. You still need a current DOT physical and a clean MVR.
            </Faq>
            <Faq q="How long before dispatch-only works for my MC?">
              Around {TERMS.seasoning} is the usual floor, but it is broker-by-broker, not a
              switch that flips on a date. We watch it on your behalf and tell you when you are
              clearing their screens.
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
          <h2 className="text-3xl sm:text-4xl font-bold">
            The MC is not the asset. A loaded truck is.
          </h2>
          <p className="mt-4 text-lg text-emerald-50">
            Tell us your authority and your truck. We will tell you which door you are in on the
            first call, free, even if the answer is wait a few more weeks.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#start"
              className="inline-flex rounded-lg bg-white px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Get Loaded →
            </a>
            <a
              href="tel:+18333629813"
              className="inline-flex items-center gap-2 rounded-lg border border-white/70 px-6 py-3 font-semibold text-white hover:bg-white/10"
            >
              <Phone className="h-4 w-4" /> {TERMS.phone}
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
              Freight and dispatch for independent box truck carriers.
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Other ways in</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>
                <a href="#start" className="hover:text-emerald-700">
                  Get loaded
                </a>
              </li>
              <li>
                <a href="/start-your-box-truck-business" className="hover:text-emerald-700">
                  Need the authority filed?
                </a>
              </li>
              <li>
                <a href="/lease-to-own-box-truck" className="hover:text-emerald-700">
                  Need a truck first?
                </a>
              </li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-900">Contact</div>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>
                <a href="tel:+18333629813" className="hover:text-emerald-700">
                  {TERMS.phone}
                </a>
              </li>
              <li>MC-1725755 · DOT 4397421</li>
            </ul>
          </div>
          <div className="text-slate-500">
            Earnings depend on the loads you run and are not guaranteed. Whether a broker accepts
            a new authority is the broker&apos;s decision, not LAMP&apos;s.
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

function Door({
  icon,
  eyebrow,
  title,
  headline,
  note,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  headline: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="p-6 sm:p-8 flex flex-col h-full">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          {icon}
        </div>
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-emerald-700">
          {eyebrow}
        </div>
        <h3 className="mt-1 text-2xl font-bold text-slate-900">{title}</h3>
        <div className="mt-3">
          <div className="text-3xl font-bold text-emerald-600">{headline}</div>
          <div className="text-xs text-slate-500">{note}</div>
        </div>
        <ul className="mt-5 space-y-2 text-sm text-slate-600 flex-1">{children}</ul>
        <a
          href="#start"
          className="mt-6 inline-flex justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-white text-sm font-semibold hover:bg-emerald-700"
        >
          Start here →
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
