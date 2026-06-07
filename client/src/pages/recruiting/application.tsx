import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

type Employment = {
  employer: string;
  position: string;
  fromDate: string;
  toDate: string;
  reasonForLeaving: string;
  wasDOT: boolean;
  supervisor: string;
  supervisorPhone: string;
};

const blankEmployment = (): Employment => ({
  employer: "",
  position: "",
  fromDate: "",
  toDate: "",
  reasonForLeaving: "",
  wasDOT: true,
  supervisor: "",
  supervisorPhone: "",
});

export default function RecruitingApplication() {
  const [, params] = useRoute<{ id: string }>("/apply/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [applicantName, setApplicantName] = useState("");

  const [form, setForm] = useState({
    dob: "",
    ssn: "",
    currentAddress: "",
    currentCity: "",
    currentState: "",
    currentZip: "",
    driverLicenseNumber: "",
    driverLicenseState: "",
    driverLicenseClass: "",
    driverLicenseExpiration: "",
    licenseSuspensionRevocation: "no",
    licenseDenialEver: "no",
    felonyConviction: "no",
    felonyExplanation: "",
    failedDotDrugTestEver: "no",
    failedDotAlcoholTestEver: "no",
    authorizedToWorkInUs: "yes",
    isOwnerOperator: "no",
    consentMvr: false,
    consentDrugTest: false,
    consentBackground: false,
    consentClearinghouse: false,
    consentPriorEmployerContact: false,
    applicantSignature: "",
  });
  const [employment, setEmployment] = useState<Employment[]>([blankEmployment()]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/recruiting/applications/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.application) {
          setApplicantName(`${data.application.firstName} ${data.application.lastName}`);
          // Redirect if past the application stage
          const stage = data.application.currentStage;
          if (stage && stage !== "LEAD" && stage !== "APPLIED") {
            setLocation(`/apply/${id}/status`);
          }
        }
      })
      .catch(() => {});
  }, [id, setLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (
      !form.consentMvr ||
      !form.consentDrugTest ||
      !form.consentBackground ||
      !form.consentClearinghouse ||
      !form.consentPriorEmployerContact
    ) {
      toast({ title: "All consents required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        dob: form.dob,
        ssn: form.ssn,
        currentAddress: form.currentAddress,
        currentCity: form.currentCity,
        currentState: form.currentState,
        currentZip: form.currentZip,
        driverLicenseNumber: form.driverLicenseNumber,
        driverLicenseState: form.driverLicenseState,
        driverLicenseClass: form.driverLicenseClass,
        driverLicenseExpiration: form.driverLicenseExpiration,
        employmentHistory: employment,
        accidents3yr: [],
        violations3yr: [],
        licenseSuspensionRevocation: form.licenseSuspensionRevocation === "yes",
        licenseDenialEver: form.licenseDenialEver === "yes",
        felonyConviction: form.felonyConviction === "yes",
        felonyExplanation: form.felonyExplanation || undefined,
        failedDotDrugTestEver: form.failedDotDrugTestEver === "yes",
        failedDotAlcoholTestEver: form.failedDotAlcoholTestEver === "yes",
        authorizedToWorkInUs: form.authorizedToWorkInUs === "yes",
        isOwnerOperator: form.isOwnerOperator === "yes",
        consentMvr: true as const,
        consentDrugTest: true as const,
        consentBackground: true as const,
        consentClearinghouse: true as const,
        consentPriorEmployerContact: true as const,
        applicantSignature: form.applicantSignature,
      };
      const res = await fetch(`/api/recruiting/applications/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setLocation(`/apply/${id}/status`);
    } catch (err) {
      toast({
        title: "Could not submit",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  if (!id) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-slate-600">Invalid application link.</p>
      </main>
    );
  }

  const updateEmp = (i: number, key: keyof Employment, val: string | boolean) => {
    const copy = [...employment];
    (copy[i] as any)[key] = val;
    setEmployment(copy);
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <nav className="border-b bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white font-bold text-sm">L</div>
          <div className="font-bold">LAMP Driver Application</div>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <Card>
          <CardContent className="p-8">
            <h1 className="text-2xl font-bold">
              {applicantName ? `Welcome, ${applicantName.split(" ")[0]} — ` : ""}
              let&apos;s finish your application
            </h1>
            <p className="mt-2 text-slate-600 text-sm">
              DOT-required driver application. 10-15 minutes. Your progress is saved.
            </p>
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
              <strong>FMCSA notice:</strong> This application is subject to 49 CFR § 391.21.
              Material misrepresentation is grounds for disqualification at any time.
            </div>

            {/* Progress */}
            <div className="mt-6 flex gap-2 text-xs font-medium text-slate-500">
              {["Personal", "License", "Employment", "Self-Disclosure", "Sign"].map((l, i) => (
                <span key={l} className={page >= i + 1 ? "text-slate-900" : ""}>
                  {i + 1}. {l}
                </span>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              {page === 1 && (
                <>
                  <h2 className="font-bold border-b pb-2">Personal Information</h2>
                  <Row>
                    <Field id="dob" label="Date of Birth" type="date" required
                      value={form.dob} onChange={(v) => setForm({ ...form, dob: v })} />
                    <Field id="ssn" label="Social Security Number" required placeholder="123-45-6789"
                      value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} />
                  </Row>
                  <Field id="currentAddress" label="Current Street Address" required
                    value={form.currentAddress} onChange={(v) => setForm({ ...form, currentAddress: v })} />
                  <Row3>
                    <Field id="currentCity" label="City" required
                      value={form.currentCity} onChange={(v) => setForm({ ...form, currentCity: v })} />
                    <StateSelect id="currentState" label="State"
                      value={form.currentState} onChange={(v) => setForm({ ...form, currentState: v })} />
                    <Field id="currentZip" label="ZIP" required
                      value={form.currentZip} onChange={(v) => setForm({ ...form, currentZip: v })} />
                  </Row3>
                </>
              )}

              {page === 2 && (
                <>
                  <h2 className="font-bold border-b pb-2">Driver License</h2>
                  <Field id="driverLicenseNumber" label="License Number" required
                    value={form.driverLicenseNumber} onChange={(v) => setForm({ ...form, driverLicenseNumber: v })} />
                  <Row3>
                    <StateSelect id="driverLicenseState" label="State"
                      value={form.driverLicenseState} onChange={(v) => setForm({ ...form, driverLicenseState: v })} />
                    <div>
                      <Label htmlFor="driverLicenseClass">Class</Label>
                      <Select value={form.driverLicenseClass} onValueChange={(v) => setForm({ ...form, driverLicenseClass: v })}>
                        <SelectTrigger id="driverLicenseClass"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          {["D", "CDL-A", "CDL-B", "CDL-C", "Other"].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Field id="driverLicenseExpiration" label="Expiration" type="date" required
                      value={form.driverLicenseExpiration} onChange={(v) => setForm({ ...form, driverLicenseExpiration: v })} />
                  </Row3>
                </>
              )}

              {page === 3 && (
                <>
                  <h2 className="font-bold border-b pb-2">Employment History (Past 3 Years — FMCSA Required)</h2>
                  {employment.map((emp, i) => (
                    <div key={i} className="rounded-lg border p-4 bg-slate-50 space-y-3">
                      <div className="flex items-center justify-between">
                        <strong className="text-sm">Employer #{i + 1}</strong>
                        {employment.length > 1 && (
                          <button type="button" className="text-xs text-red-600"
                            onClick={() => setEmployment(employment.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        )}
                      </div>
                      <Row>
                        <Field id={`emp_${i}_employer`} label="Employer" required
                          value={emp.employer} onChange={(v) => updateEmp(i, "employer", v)} />
                        <Field id={`emp_${i}_position`} label="Position" required
                          value={emp.position} onChange={(v) => updateEmp(i, "position", v)} />
                      </Row>
                      <Row>
                        <Field id={`emp_${i}_from`} label="From" type="date" required
                          value={emp.fromDate} onChange={(v) => updateEmp(i, "fromDate", v)} />
                        <Field id={`emp_${i}_to`} label="To" type="date" required
                          value={emp.toDate} onChange={(v) => updateEmp(i, "toDate", v)} />
                      </Row>
                      <Field id={`emp_${i}_reason`} label="Reason for Leaving" required
                        value={emp.reasonForLeaving} onChange={(v) => updateEmp(i, "reasonForLeaving", v)} />
                      <Row>
                        <Field id={`emp_${i}_sup`} label="Supervisor"
                          value={emp.supervisor} onChange={(v) => updateEmp(i, "supervisor", v)} />
                        <Field id={`emp_${i}_supphone`} label="Supervisor Phone"
                          value={emp.supervisorPhone} onChange={(v) => updateEmp(i, "supervisorPhone", v)} />
                      </Row>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={emp.wasDOT}
                          onCheckedChange={(v) => updateEmp(i, "wasDOT", v === true)} />
                        <span>This was a DOT-regulated commercial driving position</span>
                      </label>
                    </div>
                  ))}
                  <button type="button" className="text-sm text-slate-700 underline"
                    onClick={() => setEmployment([...employment, blankEmployment()])}>
                    + Add another employer
                  </button>
                </>
              )}

              {page === 4 && (
                <>
                  <h2 className="font-bold border-b pb-2">Self-Disclosure (FMCSA Required)</h2>
                  <YesNo label="Has your driver's license ever been suspended or revoked?"
                    value={form.licenseSuspensionRevocation}
                    onChange={(v) => setForm({ ...form, licenseSuspensionRevocation: v })} />
                  <YesNo label="Has any state ever denied your driver's license?"
                    value={form.licenseDenialEver}
                    onChange={(v) => setForm({ ...form, licenseDenialEver: v })} />
                  <YesNo label="Have you ever been convicted of a felony?"
                    value={form.felonyConviction}
                    onChange={(v) => setForm({ ...form, felonyConviction: v })} />
                  {form.felonyConviction === "yes" && (
                    <Field id="felonyExplanation" label="Please explain" required
                      value={form.felonyExplanation}
                      onChange={(v) => setForm({ ...form, felonyExplanation: v })} />
                  )}
                  <YesNo label="Have you ever failed a DOT drug test?"
                    value={form.failedDotDrugTestEver}
                    onChange={(v) => setForm({ ...form, failedDotDrugTestEver: v })} />
                  <YesNo label="Have you ever failed a DOT alcohol test?"
                    value={form.failedDotAlcoholTestEver}
                    onChange={(v) => setForm({ ...form, failedDotAlcoholTestEver: v })} />
                  <YesNo label="Are you authorized to work in the United States?"
                    value={form.authorizedToWorkInUs}
                    onChange={(v) => setForm({ ...form, authorizedToWorkInUs: v })} />
                  <YesNo label="Will you be driving your own truck (owner-operator)?"
                    value={form.isOwnerOperator}
                    onChange={(v) => setForm({ ...form, isOwnerOperator: v })} />
                </>
              )}

              {page === 5 && (
                <>
                  <h2 className="font-bold border-b pb-2">Consents &amp; Signature</h2>
                  <Consent checked={form.consentMvr}
                    onChange={(v) => setForm({ ...form, consentMvr: v })}
                    text="I authorize LAMP Logistics LLC to pull my Motor Vehicle Record (MVR) from any state where I hold or have held a driver license." />
                  <Consent checked={form.consentDrugTest}
                    onChange={(v) => setForm({ ...form, consentDrugTest: v })}
                    text="I consent to pre-employment, random, post-accident, and reasonable-suspicion drug and alcohol testing under 49 CFR Part 382." />
                  <Consent checked={form.consentBackground}
                    onChange={(v) => setForm({ ...form, consentBackground: v })}
                    text="I authorize a criminal background investigation, including a consumer report and investigative consumer report per the Fair Credit Reporting Act." />
                  <Consent checked={form.consentClearinghouse}
                    onChange={(v) => setForm({ ...form, consentClearinghouse: v })}
                    text="I authorize LAMP Logistics to query the FMCSA Drug & Alcohol Clearinghouse for any drug or alcohol violations." />
                  <Consent checked={form.consentPriorEmployerContact}
                    onChange={(v) => setForm({ ...form, consentPriorEmployerContact: v })}
                    text="I authorize LAMP Logistics to contact prior employers for safety performance history and employment verification per 49 CFR § 391.23." />
                  <Field id="applicantSignature" label="Type your full legal name to sign" required
                    placeholder="e.g. John A Smith"
                    value={form.applicantSignature}
                    onChange={(v) => setForm({ ...form, applicantSignature: v })} />
                  <p className="text-xs text-slate-500">
                    By signing above I certify that the information provided is true, complete, and
                    correct.
                  </p>
                </>
              )}

              <div className="flex justify-between gap-3 pt-4 border-t">
                {page > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setPage(page - 1)}>
                    ← Back
                  </Button>
                ) : (
                  <span />
                )}
                {page < 5 ? (
                  <Button type="button" onClick={() => setPage(page + 1)}>Continue →</Button>
                ) : (
                  <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700">
                    {submitting ? "Submitting…" : "Submit Application"}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
function Row3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}
function Field({
  id, label, value, onChange, type = "text", required, placeholder,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} required={required} placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function StateSelect({
  id, label, value, onChange,
}: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          {STATES.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function YesNo({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium">{label}</div>
      <RadioGroup value={value} onValueChange={onChange} className="mt-2 flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="yes" id={`${label}-yes`} />
          <span>Yes</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="no" id={`${label}-no`} />
          <span>No</span>
        </label>
      </RadioGroup>
    </div>
  );
}
function Consent({
  checked, onChange, text,
}: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-slate-50">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-1" />
      <span className="text-sm text-slate-700">{text}</span>
    </label>
  );
}
