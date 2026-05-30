/**
 * Public landing page for owner-operator / driver recruitment.
 * Route: /owner-operators
 *
 * Stage 1: form posts to /api/recruitment/leads. No automated SMS — admin
 * follows up manually via /admin/recruitment. SMS consent checkbox is REQUIRED
 * (A2P 10DLC) and stored with timestamp + IP via the server.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  currentCarrier: string;
  smsConsent: boolean;
};

const EMPTY: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  currentCarrier: "",
  smsConsent: false,
};

export default function OwnerOperatorsLanding() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.smsConsent) {
      setError("You must agree to receive text messages to continue.");
      return;
    }
    if (!form.firstName.trim() || !form.phone.trim()) {
      setError("First name and mobile number are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/recruitment/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          phone: form.phone,
          email: form.email || undefined,
          currentCarrier: form.currentCarrier || undefined,
          kind: "owner_operator",
          source: "landing_page",
          smsConsent: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong. Please try again.");
      }
      const data = await res.json().catch(() => ({} as any));
      // Stage 1.5: redirect to the welcome / engagement page if the server
      // returned one. Falls back to the inline thank-you screen if not (so
      // older deploys / failed payloads still confirm the submission).
      if (data && typeof data.welcomeUrl === "string" && data.welcomeUrl) {
        setLocation(data.welcomeUrl);
        return;
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full bg-zinc-900 border-zinc-800">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400 mb-4" />
            <h1 className="text-2xl font-bold mb-2">You're in.</h1>
            <p className="text-zinc-300">
              Watch your phone — a real human will text you shortly with last
              week's top owner-operator settlement so you can compare against
              what you're getting now.
            </p>
            <p className="text-zinc-500 text-sm mt-6">
              Reply STOP at any time to opt out. No automated spam — every text
              comes from a person on our team.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      {/* Hero */}
      <section className="px-6 pt-16 pb-12 max-w-3xl mx-auto text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
          Eighty-Eight Percent.
          <br />
          Weekly Pay.
          <br />
          <span className="text-emerald-400">A Real Human On The Hotline.</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-300">
          We're a motor carrier with our own authority and a small fleet of
          owner-operators who run because we treat them like partners, not load
          numbers. Eighty-eight percent of line haul, one hundred percent of
          fuel surcharge passed through, weekly direct deposit every Friday, and
          a published hotline that connects to a real dispatcher — not a phone
          tree.
        </p>
      </section>

      {/* Offer */}
      <section className="px-6 max-w-3xl mx-auto pb-12">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">What you get</h2>
            <ul className="space-y-3 text-zinc-200">
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>Eighty-eight percent of line haul, paid every Friday by direct deposit. No reserve, no escrow.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>One hundred percent of fuel surcharge passed through. We keep zero.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>Detention pay at fifty dollars an hour, starting at hour two.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>Fuel card with at least thirty cents off retail. Comdata or EFS.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>A real dispatcher on the Owner-Op Hotline, 24/7. Escalates to ownership for anything serious.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>No forced dispatch. Daily load board, pick what you want.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>Thirty-day mutual walk. If we're not the right fit, no penalty either way.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>$500 at day 30 + $500 at day 90. Paid out of revenue you generated.</li>
              <li className="flex gap-3"><span className="text-emerald-400">✓</span>Plate program: we front, you reimburse from settlements over 12 months.</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Form */}
      <section id="apply" className="px-6 max-w-2xl mx-auto pb-20">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-1">Text me last week's settlements</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Three fields. We don't need your life story.
            </p>
            <form onSubmit={onSubmit} className="space-y-4" data-testid="oo-lead-form">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First name *</Label>
                  <Input id="firstName" data-testid="input-first-name" value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="bg-zinc-950 border-zinc-800" required maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" data-testid="input-last-name" value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="bg-zinc-950 border-zinc-800" maxLength={80} />
                </div>
              </div>
              <div>
                <Label htmlFor="phone">Mobile number *</Label>
                <Input id="phone" data-testid="input-phone" type="tel" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="bg-zinc-950 border-zinc-800" required maxLength={32}
                  placeholder="(555) 555-5555" />
              </div>
              <div>
                <Label htmlFor="email">Email (optional)</Label>
                <Input id="email" data-testid="input-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="bg-zinc-950 border-zinc-800" />
              </div>
              <div>
                <Label htmlFor="currentCarrier">Currently leased to / Carrier you run for</Label>
                <Input id="currentCarrier" data-testid="input-current-carrier" value={form.currentCarrier}
                  onChange={(e) => setForm({ ...form, currentCarrier: e.target.value })}
                  className="bg-zinc-950 border-zinc-800" maxLength={200}
                  placeholder="e.g. Schneider, Landstar, independent" />
              </div>

              <div className="flex items-start gap-3 pt-2">
                <Checkbox id="smsConsent" data-testid="checkbox-sms-consent"
                  checked={form.smsConsent}
                  onCheckedChange={(c) => setForm({ ...form, smsConsent: !!c })}
                />
                <Label htmlFor="smsConsent" className="text-sm text-zinc-300 leading-relaxed font-normal">
                  I agree to receive text messages about owner-operator opportunities.
                  Reply STOP at any time to opt out. Maximum 3 messages per week.
                  Message and data rates may apply.
                </Label>
              </div>

              {error && (
                <p className="text-red-400 text-sm" data-testid="form-error">{error}</p>
              )}

              <Button type="submit" disabled={submitting} data-testid="button-submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-6 text-lg">
                {submitting ? "Sending…" : "Get last week's settlements"}
              </Button>

              <p className="text-zinc-500 text-xs text-center">
                We won't sell your info. We won't auto-spam you. One real human on our team will text you.
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
