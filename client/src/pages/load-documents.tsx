/**
 * Staff-only load documents page — /loads/:id/documents
 *
 * Shows all driver-uploaded documents for a load, grouped by type.
 * Staff can approve or reject each document.  No monetary figures are
 * displayed here (document metadata only — no financial load fields).
 *
 * Auth: staff session required (isAuthenticated on the backend).
 * The driver upload token does NOT grant access here.
 */
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Download,
  FileText,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalStatus = "pending" | "approved" | "rejected";

interface LoadDocument {
  id: string;
  loadId: string;
  driverId: string | null;
  documentType: string;
  fileName: string | null;
  fileUrl: string | null;
  approvalStatus: ApprovalStatus | null;
  dispatcherNotes: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
}

interface PhotosResponse {
  ok: boolean;
  docs: LoadDocument[];
  byStage: Record<string, LoadDocument[]>;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  pickup_bol: "Pickup BOL",
  pickup_securement: "Securement / Tie-Down",
  delivery_pod: "Delivery POD",
  delivery_signed_bol: "Signed BOL",
  lumper_receipt: "Lumper Receipt",
  scale_ticket: "Scale Ticket",
  other: "Other Document",
};

const STAGE_ORDER = [
  "pickup_bol",
  "pickup_securement",
  "delivery_pod",
  "delivery_signed_bol",
  "lumper_receipt",
  "scale_ticket",
  "other",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: ApprovalStatus | null) {
  switch (status) {
    case "approved":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle className="w-3 h-3 mr-1" /> Approved
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          <XCircle className="w-3 h-3 mr-1" /> Rejected
        </Badge>
      );
    default:
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Clock className="w-3 h-3 mr-1" /> Pending
        </Badge>
      );
  }
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i.test(url);
}

// ─── Document Card ────────────────────────────────────────────────────────────

function DocCard({
  doc,
  loadId,
}: {
  doc: LoadDocument;
  loadId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const patch = useMutation({
    mutationFn: (body: { approvalStatus: ApprovalStatus; notes?: string }) =>
      apiRequest("PATCH", `/api/loads/${loadId}/photos/${doc.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/loads/${loadId}/photos`] });
      setShowRejectInput(false);
      setRejectReason("");
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err?.message ?? "Could not update document status.",
        variant: "destructive",
      });
    },
  });

  function approve() {
    patch.mutate({ approvalStatus: "approved" });
  }

  function startReject() {
    setShowRejectInput(true);
  }

  function confirmReject() {
    patch.mutate({
      approvalStatus: "rejected",
      ...(rejectReason.trim() ? { notes: rejectReason.trim() } : {}),
    });
  }

  const url = doc.fileUrl ?? "";
  const isImg = url ? isImageUrl(url) : false;

  return (
    <div className="rounded-lg border bg-white dark:bg-slate-800 dark:border-slate-700 overflow-hidden flex flex-col">
      {/* Thumbnail */}
      <div className="h-40 bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
        {isImg && url ? (
          <img
            src={url}
            alt={doc.fileName ?? "document"}
            className="h-full w-full object-contain"
          />
        ) : url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 text-slate-400 hover:text-blue-600 transition-colors"
          >
            <FileText className="w-10 h-10" />
            <span className="text-xs">View file</span>
          </a>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-300">
            <FileText className="w-10 h-10" />
            <span className="text-xs">No file</span>
          </div>
        )}
      </div>

      {/* Info + controls */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight break-all">
            {doc.fileName ?? "Unnamed"}
          </p>
          {statusBadge(doc.approvalStatus)}
        </div>

        {doc.dispatcherNotes && (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            {doc.dispatcherNotes}
          </p>
        )}

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download={doc.fileName ?? undefined}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <Download className="w-3 h-3" /> Download
          </a>
        )}

        {/* Reject reason input */}
        {showRejectInput && (
          <div className="flex flex-col gap-1 mt-1">
            <Label className="text-xs">Reason (optional)</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. image blurry"
              className="h-7 text-xs"
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-auto pt-1">
          {!showRejectInput ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                disabled={doc.approvalStatus === "approved" || patch.isPending}
                onClick={approve}
              >
                {patch.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "Approve"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                disabled={doc.approvalStatus === "rejected" || patch.isPending}
                onClick={startReject}
              >
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                disabled={patch.isPending}
                onClick={confirmReject}
              >
                {patch.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm Reject"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setShowRejectInput(false);
                  setRejectReason("");
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoadDocumentsPage() {
  const params = useParams<{ id: string }>();
  const [location] = useLocation();
  // Resolve id from (1) wouter useParams (2) /loads/<id>/documents path fallback
  const fallbackFromPath = location.match(/^\/loads\/([^/]+)\/documents/)?.[1];
  const id = params.id ?? fallbackFromPath;

  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<PhotosResponse>({
    queryKey: [`/api/loads/${id}/photos`],
    enabled: !!id && !!user,
    retry: false,
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────
  if (!authLoading && !user) {
    navigate("/auth");
    return null;
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (authLoading || isLoading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-4rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ── Error (includes 401 when session missing) ────────────────────────────────
  if (error || !data?.ok) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-3 text-slate-500">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-lg font-medium">Could not load documents</p>
        <p className="text-sm">{data?.error ?? (error as any)?.message ?? "Unknown error"}</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/loads/${id}`)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to load
        </Button>
      </div>
    );
  }

  // ── Group docs into ordered stages ──────────────────────────────────────────
  const byStage = data.byStage ?? {};
  const presentStages = STAGE_ORDER.filter(
    (s) => (byStage[s] ?? []).length > 0,
  );
  const totalDocs = data.docs?.length ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/loads/${id}`)}
          className="text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Load details
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Documents
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {totalDocs} document{totalDocs !== 1 ? "s" : ""} uploaded for load {id.slice(0, 8)}
          </p>
        </div>
      </div>

      {totalDocs === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-slate-400">
            <FileText className="w-12 h-12" />
            <p className="text-base">No documents uploaded yet</p>
          </CardContent>
        </Card>
      )}

      {/* One card per document type */}
      {presentStages.map((stage) => {
        const docs = byStage[stage] ?? [];
        return (
          <Card key={stage}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                {STAGE_LABELS[stage] ?? stage}
                <span className="ml-auto text-xs font-normal text-slate-400">
                  {docs.length} file{docs.length !== 1 ? "s" : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {docs.map((doc) => (
                  <DocCard key={doc.id} doc={doc} loadId={id!} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
