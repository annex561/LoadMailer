/**
 * Documents / Signatures admin hub.
 * Route: /admin/documents
 *
 * Lists every signature envelope (driver onboarding, OO lease packets, NDAs,
 * one-off sends). Admin can:
 *   - See status at a glance (sent / viewed / completed / declined / failed)
 *   - Send a new document from any DocuSeal template to any signer
 *   - Copy the signer URL to share manually
 *   - Void an outstanding envelope
 *
 * Templates are managed in DocuSeal itself (admin UI at your DocuSeal URL).
 * This page sends from a templateId; create the template in DocuSeal,
 * grab its ID, paste it here.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileSignature, ExternalLink, Send, X, RefreshCw, Copy } from "lucide-react";

type Envelope = {
  id: string;
  signerKind: string;
  signerName: string;
  signerEmail: string | null;
  signerPhone: string | null;
  documentName: string;
  templateRef: string | null;
  status: string;
  sentAt: string | null;
  completedAt: string | null;
  providerSignerUrl: string | null;
  signedPdfPath: string | null;
  createdAt: string;
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  sent: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  viewed: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  partially_signed: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  declined: "bg-red-500/10 text-red-300 border-red-500/30",
  expired: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  voided: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  failed: "bg-red-700/20 text-red-200 border-red-700/40",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  partially_signed: "Partial",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
  failed: "Failed",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DocumentsAdmin() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm, setSendForm] = useState({
    templateId: "",
    documentName: "",
    signerName: "",
    signerEmail: "",
    signerPhone: "",
  });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setEnvelopes(data.envelopes || []);
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function sendDocument(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/documents/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: sendForm.templateId,
          documentName: sendForm.documentName,
          signerKind: "external",
          signerName: sendForm.signerName,
          signerEmail: sendForm.signerEmail || undefined,
          signerPhone: sendForm.signerPhone || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSendResult({ ok: false, message: data.error || "Send failed" });
      } else {
        setSendResult({
          ok: true,
          message: "Sent. DocuSeal emailed the signer; you can also copy the link below to text it.",
          url: data.signerUrl,
        });
        setSendForm({ templateId: "", documentName: "", signerName: "", signerEmail: "", signerPhone: "" });
        refresh();
      }
    } catch (err: any) {
      setSendResult({ ok: false, message: err?.message || "Network error" });
    } finally {
      setSending(false);
    }
  }

  async function voidEnvelope(id: string) {
    if (!confirm("Void this envelope? The signer link will stop working.")) return;
    try {
      await fetch(`/api/documents/${id}/void`, { method: "POST" });
      refresh();
    } catch {}
  }

  useEffect(() => { refresh(); }, []);

  const byStatus = envelopes.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <FileSignature className="h-8 w-8 text-emerald-400" />
              Documents
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Signature envelopes powered by DocuSeal. Use for driver onboarding,
              owner-operator lease packets, NDAs — anything that needs a signature.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={refresh} variant="outline" data-testid="button-refresh"
              className="border-zinc-800 hover:bg-zinc-900">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={sendOpen} onOpenChange={setSendOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-send-new"
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold">
                  <Send className="h-4 w-4 mr-2" />
                  Send document
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-50 max-w-lg">
                <DialogHeader>
                  <DialogTitle>Send a document for signature</DialogTitle>
                </DialogHeader>
                <form onSubmit={sendDocument} className="space-y-4 mt-2">
                  <div>
                    <Label htmlFor="templateId">DocuSeal Template ID *</Label>
                    <Input id="templateId" data-testid="input-template-id" required
                      value={sendForm.templateId}
                      onChange={(e) => setSendForm({ ...sendForm, templateId: e.target.value })}
                      placeholder="e.g. 42"
                      className="bg-zinc-950 border-zinc-800" />
                    <p className="text-xs text-zinc-500 mt-1">
                      Find this in your DocuSeal admin → Templates → click a template → URL ends in /templates/[ID]
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="documentName">Document name (for your records) *</Label>
                    <Input id="documentName" data-testid="input-document-name" required
                      value={sendForm.documentName}
                      onChange={(e) => setSendForm({ ...sendForm, documentName: e.target.value })}
                      placeholder="e.g. OO Lease Packet — Tony Hauler"
                      className="bg-zinc-950 border-zinc-800" />
                  </div>
                  <div>
                    <Label htmlFor="signerName">Signer full name *</Label>
                    <Input id="signerName" data-testid="input-signer-name" required
                      value={sendForm.signerName}
                      onChange={(e) => setSendForm({ ...sendForm, signerName: e.target.value })}
                      className="bg-zinc-950 border-zinc-800" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="signerEmail">Email</Label>
                      <Input id="signerEmail" data-testid="input-signer-email" type="email"
                        value={sendForm.signerEmail}
                        onChange={(e) => setSendForm({ ...sendForm, signerEmail: e.target.value })}
                        className="bg-zinc-950 border-zinc-800" />
                    </div>
                    <div>
                      <Label htmlFor="signerPhone">Phone</Label>
                      <Input id="signerPhone" data-testid="input-signer-phone" type="tel"
                        value={sendForm.signerPhone}
                        onChange={(e) => setSendForm({ ...sendForm, signerPhone: e.target.value })}
                        className="bg-zinc-950 border-zinc-800" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">Provide at least one of email or phone.</p>
                  {sendResult && (
                    <div className={`p-3 rounded text-sm ${sendResult.ok ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-300" : "bg-red-500/10 border border-red-500/40 text-red-300"}`}>
                      {sendResult.message}
                      {sendResult.url && (
                        <div className="mt-2">
                          <code className="block bg-zinc-950 p-2 rounded text-xs break-all">{sendResult.url}</code>
                          <Button type="button" size="sm" variant="outline"
                            className="mt-2 border-zinc-700"
                            onClick={() => navigator.clipboard?.writeText(sendResult.url!)}>
                            <Copy className="h-3 w-3 mr-1" />
                            Copy link
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <Button type="submit" disabled={sending} data-testid="button-submit-send"
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold">
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          {["sent", "viewed", "completed", "declined", "failed"].filter(s => byStatus[s] > 0).map((s) => (
            <Card key={s} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-3">
                <div className="text-xs text-zinc-400">{STATUS_LABEL[s] || s}</div>
                <div className="text-2xl font-bold">{byStatus[s]}</div>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-3">
              <div className="text-xs text-zinc-400">Total</div>
              <div className="text-2xl font-bold">{envelopes.length}</div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle>All envelopes</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && envelopes.length === 0 ? (
              <p className="text-zinc-400 text-sm">Loading…</p>
            ) : envelopes.length === 0 ? (
              <p className="text-zinc-400 text-sm">
                No envelopes yet. Tap <strong>Send document</strong> above to send your first one.
              </p>
            ) : (
              <div className="space-y-2">
                {envelopes.map((env) => (
                  <div key={env.id} data-testid={`envelope-${env.id}`}
                    className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 p-3 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{env.documentName}</span>
                        <Badge variant="outline" className={STATUS_COLOR[env.status] || ""}>
                          {STATUS_LABEL[env.status] || env.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-zinc-300 mt-1">
                        To: {env.signerName}
                        {env.signerEmail ? ` · ${env.signerEmail}` : ""}
                        {env.signerPhone ? ` · ${env.signerPhone}` : ""}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
                        Sent {fmtDate(env.sentAt)}
                        {env.completedAt && ` · Completed ${fmtDate(env.completedAt)}`}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      {env.providerSignerUrl && env.status !== "completed" && env.status !== "voided" && (
                        <Button size="sm" variant="outline" asChild
                          className="border-zinc-700 hover:bg-zinc-800">
                          <a href={env.providerSignerUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" /> Sign link
                          </a>
                        </Button>
                      )}
                      {env.providerSignerUrl && (
                        <Button size="sm" variant="outline"
                          onClick={() => navigator.clipboard?.writeText(env.providerSignerUrl!)}
                          data-testid={`copy-${env.id}`}
                          className="border-zinc-700 hover:bg-zinc-800">
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      {env.signedPdfPath && (
                        <Button size="sm" variant="outline" asChild
                          className="border-zinc-700 hover:bg-zinc-800">
                          <a href={env.signedPdfPath} target="_blank" rel="noopener noreferrer">
                            <FileSignature className="h-4 w-4 mr-1" /> Signed PDF
                          </a>
                        </Button>
                      )}
                      {["draft", "sent", "viewed", "partially_signed"].includes(env.status) && (
                        <Button size="sm" variant="outline"
                          onClick={() => voidEnvelope(env.id)}
                          data-testid={`void-${env.id}`}
                          className="border-red-500/40 text-red-300 hover:bg-red-500/10">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
