/**
 * Owner-operator welcome / pre-call engagement page — Stage 1.5.
 * Route: /owner-operators/welcome/:leadId
 *
 * Shown right after the landing form is submitted. Two jobs:
 *   1. Set expectation that the owner will CALL ASAP (not text)
 *   2. Keep the lead engaged while they wait — pre-qualification quiz +
 *      company programs (Amazon Relay front and center) — so the call
 *      goes faster and the lead does not bounce out of the funnel.
 *
 * Quiz answers auto-save on each change via PATCH. The page is resilient
 * if the lead bails midway: every answered field is already in the DB.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Phone, Loader2 } from "lucide-react";

type Question =
  | { id: string; kind: "bool"; label: string }
  | { id: string; kind: "number"; label: string }
  | { id: string; kind: "text"; label: string }
  | { id: string; kind: "choice"; label: string; options: { value: string; label: string }[] };

type Section = { id: string; title: string; questions: Question[] };

type WelcomePayload = {
  ok: boolean;
  lead: { id: string; firstName: string; submittedAt: string; qualificationCompletedAt: string | null };
  programs: { id: string; icon: string; title: string; body: string }[];
  quiz: { sections: Section[] };
  answers: Record<string, unknown>;
  typedAnswers: Record<string, unknown>;
};

function isAfterHours(now: Date): boolean {
  // Owner's business hours default: Mon–Sat 7am–9pm local time (very generous).
  // Sunday = always after-hours (call tomorrow). Tweak via env later.
  const day = now.getDay(); // 0 = Sun
  const hr = now.getHours();
  if (day === 0) return true;
  if (hr < 7 || hr >= 21) return true;
  return false;
}

export default function OwnerOperatorsWelcome() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const [data, setData] = useState<WelcomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [now] = useState(new Date());
  const afterHours = isAfterHours(now);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/recruitment/leads/${leadId}/welcome`);
        if (!res.ok) throw new Error("Could not load welcome page");
        const json: WelcomePayload = await res.json();
        if (cancelled) return;
        setData(json);
        // Seed answers from typed columns (preferred) + blob fallback
        setAnswers({ ...(json.answers || {}), ...(json.typedAnswers || {}) });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  async function saveAnswer(id: string, value: unknown) {
    setSaving(id);
    setAnswers((prev) => ({ ...prev, [id]: value }));
    try {
      await fetch(`/api/recruitment/leads/${leadId}/qualification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [id]: value }),
      });
    } catch {
      // Soft-fail — UI continues, server has the previous state.
    } finally {
      setSaving(null);
    }
  }

  async function markComplete() {
    try {
      await fetch(`/api/recruitment/leads/${leadId}/qualification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true }),
      });
      setData((d) => d ? { ...d, lead: { ...d.lead, qualificationCompletedAt: new Date().toISOString() } } : d);
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full bg-zinc-900 border-zinc-800">
          <CardContent className="p-8 text-center">
            <p className="text-red-400">{error || "Could not load this page."}</p>
            <p className="text-zinc-400 text-sm mt-4">
              Do not worry — your information was saved. The owner will still call you shortly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalQs = data.quiz.sections.reduce((acc, s) => acc + s.questions.length, 0);
  const answered = data.quiz.sections.reduce((acc, s) =>
    acc + s.questions.filter(q => {
      const v = answers[q.id];
      return v !== undefined && v !== null && v !== "";
    }).length, 0);
  const pct = totalQs ? Math.round((answered / totalQs) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      {/* Hero — set expectation */}
      <section className="px-6 pt-16 pb-8 max-w-3xl mx-auto text-center">
        <Phone className="mx-auto h-12 w-12 text-emerald-400 mb-4" />
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
          {data.lead.firstName}, the owner is going to call you {afterHours ? "tomorrow morning" : "in the next 15 minutes"}.
        </h1>
        <p className="mt-4 text-lg text-zinc-300">
          {afterHours
            ? "It is after our business hours. The owner will call you between 7am and 9am tomorrow."
            : "Real human, not a phone tree. Keep your phone handy."}
        </p>
        <p className="mt-3 text-zinc-400 text-sm">
          While you wait: answer a few quick questions so the call moves faster,
          and check out the programs you get when you lease to us.
        </p>
      </section>

      {/* Programs — Amazon Relay first */}
      <section className="px-6 max-w-4xl mx-auto pb-10">
        <h2 className="text-2xl font-bold mb-4">What you get</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.programs.map((p, idx) => (
            <Card key={p.id} className={`bg-zinc-900 border-zinc-800 ${idx === 0 ? "md:col-span-2 border-emerald-500/40" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="text-2xl shrink-0">{p.icon}</div>
                  <div>
                    <h3 className="font-bold mb-1">
                      {p.title}
                      {idx === 0 && (
                        <span className="ml-2 text-xs bg-emerald-500 text-zinc-950 px-2 py-0.5 rounded font-semibold">
                          MOST POPULAR
                        </span>
                      )}
                    </h3>
                    <p className="text-zinc-300 text-sm">{p.body}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Quiz */}
      <section className="px-6 max-w-3xl mx-auto pb-20">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-bold">A few quick questions</h2>
          <span className="text-zinc-400 text-sm">{answered}/{totalQs} answered</span>
        </div>
        <div className="w-full bg-zinc-900 rounded-full h-2 mb-6 overflow-hidden">
          <div
            className="bg-emerald-500 h-full transition-all duration-300"
            style={{ width: `${pct}%` }}
            data-testid="quiz-progress"
          />
        </div>

        {data.quiz.sections.map((section) => (
          <Card key={section.id} className="bg-zinc-900 border-zinc-800 mb-4">
            <CardContent className="p-6">
              <h3 className="font-bold text-lg mb-4">{section.title}</h3>
              <div className="space-y-5">
                {section.questions.map((q) => (
                  <div key={q.id} data-testid={`question-${q.id}`}>
                    <Label className="text-zinc-200 mb-2 block">{q.label}</Label>
                    {q.kind === "bool" && (
                      <div className="flex gap-2">
                        <Button type="button" size="sm"
                          variant={answers[q.id] === true ? "default" : "outline"}
                          onClick={() => saveAnswer(q.id, true)}
                          data-testid={`${q.id}-yes`}
                          className={answers[q.id] === true ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950" : "border-zinc-700"}>
                          Yes
                        </Button>
                        <Button type="button" size="sm"
                          variant={answers[q.id] === false ? "default" : "outline"}
                          onClick={() => saveAnswer(q.id, false)}
                          data-testid={`${q.id}-no`}
                          className={answers[q.id] === false ? "bg-zinc-300 hover:bg-zinc-200 text-zinc-950" : "border-zinc-700"}>
                          No
                        </Button>
                      </div>
                    )}
                    {q.kind === "number" && (
                      <Input type="number" min={0}
                        value={(answers[q.id] as number) ?? ""}
                        onChange={(e) => saveAnswer(q.id, e.target.value ? Number(e.target.value) : null)}
                        className="bg-zinc-950 border-zinc-800 max-w-xs"
                        data-testid={`${q.id}-input`} />
                    )}
                    {q.kind === "text" && (
                      <Input type="text"
                        value={(answers[q.id] as string) ?? ""}
                        onChange={(e) => saveAnswer(q.id, e.target.value)}
                        className="bg-zinc-950 border-zinc-800"
                        data-testid={`${q.id}-input`} />
                    )}
                    {q.kind === "choice" && (
                      <div className="flex flex-wrap gap-2">
                        {q.options.map((opt) => (
                          <Button key={opt.value} type="button" size="sm"
                            variant={answers[q.id] === opt.value ? "default" : "outline"}
                            onClick={() => saveAnswer(q.id, opt.value)}
                            data-testid={`${q.id}-${opt.value}`}
                            className={answers[q.id] === opt.value ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950" : "border-zinc-700"}>
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Done CTA */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6 text-center">
            {data.lead.qualificationCompletedAt ? (
              <div>
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400 mb-2" />
                <p className="font-semibold">All set, {data.lead.firstName}.</p>
                <p className="text-zinc-400 text-sm mt-1">
                  Your answers are saved. {afterHours ? "Owner will call you tomorrow morning." : "Owner will call you any minute."}
                </p>
              </div>
            ) : (
              <>
                <p className="text-zinc-300 mb-4">
                  Done answering? Hit the button below and we'll know the call is ready to go.
                </p>
                <Button onClick={markComplete}
                  data-testid="button-quiz-complete"
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-8 py-6 text-lg">
                  I'm done — call me
                </Button>
              </>
            )}
            {saving && <p className="text-xs text-zinc-500 mt-3">Saving…</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
