import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Upload, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DOC_LABELS: Record<string, string> = {
  DRIVER_LICENSE_FRONT: "Driver's License — Front",
  DRIVER_LICENSE_BACK: "Driver's License — Back",
  SSN_CARD: "Social Security Card (or W-2)",
  VOIDED_CHECK: "Voided Check (for direct deposit)",
  INSURANCE_CARD: "Truck Insurance Card",
  TRUCK_REGISTRATION: "Truck Registration",
  MEDICAL_CARD: "DOT Medical Card (if current)",
};

export default function DriverDocuments() {
  const [, params] = useRoute<{ id: string }>("/apply/:id/documents");
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const [firstName, setFirstName] = useState<string>("");
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const fetchState = async () => {
    if (!id) return;
    try {
      const [docsRes, appRes] = await Promise.all([
        fetch(`/api/recruiting/applications/${id}/documents`),
        fetch(`/api/recruiting/applications/${id}`),
      ]);
      const docsData = await docsRes.json();
      const appData = await appRes.json();
      if (docsData.required) setRequired(docsData.required);
      if (docsData.documents) setUploaded(new Set(docsData.documents.map((d: any) => d.type)));
      if (appData.application?.firstName) setFirstName(appData.application.firstName);
      // Redirect if past docs stage
      const stage = appData.application?.currentStage;
      if (stage && stage !== "DOCS_REQUESTED" && stage !== "DOCS_RECEIVED" && stage !== "PRESCREENED_PASS") {
        setLocation(`/apply/${id}/status`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [id]);

  async function handleFile(docType: string, file: File) {
    if (!id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 10 MB", variant: "destructive" });
      return;
    }
    setUploadingType(docType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", docType);
      const res = await fetch(`/api/recruiting/applications/${id}/documents`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast({ title: "Uploaded", description: DOC_LABELS[docType] || docType });
      setUploaded((prev) => new Set([...Array.from(prev), docType]));
      if (data.allReceived) {
        // Brief delay then redirect to status
        setTimeout(() => setLocation(`/apply/${id}/status`), 800);
      }
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setUploadingType(null);
    }
  }

  if (!id) {
    return (
      <main className="force-light-theme min-h-screen flex items-center justify-center bg-white" style={{ colorScheme: "light" }}>
        <p className="text-slate-600">Invalid application link.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="force-light-theme min-h-screen flex items-center justify-center bg-slate-50" style={{ colorScheme: "light" }}>
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  const remaining = required.filter((r) => !uploaded.has(r)).length;

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
              <div className="text-xs text-slate-500 leading-tight">Document Upload · MC-1725755</div>
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
              {firstName ? `${firstName}, ` : ""}upload your documents
            </h1>
            <p className="mt-2 text-slate-600">
              Use your phone&apos;s camera to snap each one. Accepts JPG, PNG, or PDF up to 10 MB.
            </p>
            <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
              <strong>{uploaded.size}/{required.length}</strong> documents uploaded.
              {remaining === 0 ? " You're all set — redirecting." : ` ${remaining} more needed.`}
            </div>

            <div className="mt-6 space-y-3">
              {required.map((docType) => {
                const isUploaded = uploaded.has(docType);
                const isUploading = uploadingType === docType;
                return (
                  <div
                    key={docType}
                    className={`rounded-lg border p-4 ${
                      isUploaded
                        ? "bg-emerald-50 border-emerald-300"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {isUploaded ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                        ) : (
                          <FileText className="h-5 w-5 text-slate-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {DOC_LABELS[docType] || docType}
                          </div>
                          {isUploaded && (
                            <div className="text-xs text-emerald-700 mt-0.5">
                              Received. You can replace it if needed.
                            </div>
                          )}
                        </div>
                      </div>
                      <label
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer shrink-0 ${
                          isUploaded
                            ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        } ${isUploading ? "opacity-50 cursor-wait" : ""}`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {isUploading ? "Uploading…" : isUploaded ? "Replace" : "Upload"}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          capture="environment"
                          disabled={isUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFile(docType, f);
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            {remaining === 0 && (
              <div className="mt-6 rounded-lg bg-emerald-100 border border-emerald-300 p-4 text-emerald-900">
                <strong>All documents received.</strong> We&apos;ll text you when your background
                check completes — usually 24-72 hours.
              </div>
            )}

            <div className="mt-8 text-center">
              <a
                href={`/apply/${id}/status`}
                className="text-sm text-slate-600 underline hover:text-slate-900"
              >
                Check application status
              </a>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-slate-500">
          Questions? Email recruit@lamplogistics.com or call (833) 362-9813
        </div>
      </div>
    </main>
  );
}
