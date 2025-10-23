import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Maximize, 
  ChevronLeft, 
  ChevronRight, 
  Grid3x3, 
  Columns, 
  CheckCircle2, 
  XCircle,
  Edit,
  FileText,
  Upload,
  History
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { LoadDocument } from "@shared/schema";
import { DocumentAnnotations } from "./DocumentAnnotations";
import { DocumentAuditTrail } from "./DocumentAuditTrail";

interface EnhancedDocumentViewerProps {
  documents: LoadDocument[];
  initialDocIndex?: number;
  loadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnhancedDocumentViewer({
  documents,
  initialDocIndex = 0,
  loadId,
  open,
  onOpenChange,
}: EnhancedDocumentViewerProps) {
  const { toast } = useToast();
  const [currentDocIndex, setCurrentDocIndex] = useState(initialDocIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<"single" | "grid" | "compare">("single");
  const [compareDoc, setCompareDoc] = useState<number | null>(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [activeTab, setActiveTab] = useState<"viewer" | "annotations" | "audit">("viewer");
  const imageRef = useRef<HTMLDivElement>(null);

  const currentDoc = documents[currentDocIndex];

  useEffect(() => {
    setCurrentDocIndex(initialDocIndex);
  }, [initialDocIndex]);

  useEffect(() => {
    if (open) {
      resetView();
    }
  }, [open, currentDocIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      
      switch (e.key) {
        case "Escape":
          onOpenChange(false);
          break;
        case "ArrowLeft":
          handlePrevious();
          break;
        case "ArrowRight":
          handleNext();
          break;
        case "+":
        case "=":
          handleZoomIn();
          break;
        case "-":
        case "_":
          handleZoomOut();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, currentDocIndex]);

  const resetView = () => {
    setZoom(1);
    setRotation(0);
    setPanX(0);
    setPanY(0);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 5));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.25));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleFitToScreen = () => {
    resetView();
  };

  const handlePrevious = () => {
    if (currentDocIndex > 0) {
      setCurrentDocIndex((prev) => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentDocIndex < documents.length - 1) {
      setCurrentDocIndex((prev) => prev + 1);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPanX(e.clientX - dragStart.x);
      setPanY(e.clientY - dragStart.y);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/documents/${currentDoc.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          notes: approvalNotes,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Document Approved",
        description: "The document has been approved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/loads", loadId, "documents", "required"] });
      setShowApproveDialog(false);
      setApprovalNotes("");
    },
    onError: (error: Error) => {
      toast({
        title: "Approval Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/documents/${currentDoc.id}/reject`, {
        method: "POST",
        body: JSON.stringify({
          reason: rejectionReason,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Document Rejected",
        description: "The driver will be notified via SMS with the rejection reason.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/loads", loadId, "documents", "required"] });
      setShowRejectDialog(false);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Rejection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApprove = () => {
    setShowApproveDialog(true);
  };

  const handleReject = () => {
    setShowRejectDialog(true);
  };

  if (!currentDoc) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] h-[95vh] p-0 gap-0" data-testid="dialog-document-viewer">
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold" data-testid="text-viewer-title">Enhanced Document Viewer</h2>
                <Badge variant="outline" data-testid="text-document-count">
                  {currentDocIndex + 1} of {documents.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handlePrevious}
                  disabled={currentDocIndex === 0}
                  variant="outline"
                  size="sm"
                  data-testid="button-previous-document"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={currentDocIndex === documents.length - 1}
                  variant="outline"
                  size="sm"
                  data-testid="button-next-document"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  onClick={() => onOpenChange(false)}
                  variant="ghost"
                  size="sm"
                  data-testid="button-close-viewer"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as typeof activeTab)} className="flex-1 flex flex-col">
              <div className="border-b bg-white px-6">
                <TabsList>
                  <TabsTrigger value="viewer" data-testid="tab-viewer">
                    <FileText className="h-4 w-4 mr-2" />
                    Viewer
                  </TabsTrigger>
                  <TabsTrigger value="annotations" data-testid="tab-annotations">
                    <Edit className="h-4 w-4 mr-2" />
                    Annotations
                  </TabsTrigger>
                  <TabsTrigger value="audit" data-testid="tab-audit">
                    <History className="h-4 w-4 mr-2" />
                    Audit Trail
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Viewer Tab */}
              <TabsContent value="viewer" className="flex-1 flex flex-col m-0 p-0">
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-6 py-3 border-b bg-gray-50 flex-wrap">
                  <Button onClick={handleZoomIn} variant="outline" size="sm" data-testid="button-zoom-in">
                    <ZoomIn className="h-4 w-4 mr-1" />
                    Zoom In
                  </Button>
                  <Button onClick={handleZoomOut} variant="outline" size="sm" data-testid="button-zoom-out">
                    <ZoomOut className="h-4 w-4 mr-1" />
                    Zoom Out
                  </Button>
                  <Badge variant="secondary" data-testid="text-zoom-level">{Math.round(zoom * 100)}%</Badge>
                  <Button onClick={handleFitToScreen} variant="outline" size="sm" data-testid="button-fit-screen">
                    <Maximize className="h-4 w-4 mr-1" />
                    Fit
                  </Button>
                  <Button onClick={handleRotate} variant="outline" size="sm" data-testid="button-rotate">
                    <RotateCw className="h-4 w-4 mr-1" />
                    Rotate
                  </Button>
                  <div className="border-l pl-2 ml-2">
                    <Button
                      onClick={() => setViewMode("grid")}
                      variant={viewMode === "grid" ? "default" : "outline"}
                      size="sm"
                      data-testid="button-grid-view"
                    >
                      <Grid3x3 className="h-4 w-4 mr-1" />
                      Grid
                    </Button>
                  </div>
                  <Button
                    onClick={() => setViewMode(viewMode === "compare" ? "single" : "compare")}
                    variant={viewMode === "compare" ? "default" : "outline"}
                    size="sm"
                    data-testid="button-compare-mode"
                  >
                    <Columns className="h-4 w-4 mr-1" />
                    Compare
                  </Button>
                  <div className="border-l pl-2 ml-2 flex gap-2">
                    <Button
                      onClick={handleApprove}
                      variant="default"
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      disabled={currentDoc.approvalStatus === "approved"}
                      data-testid="button-approve-document"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      onClick={handleReject}
                      variant="destructive"
                      size="sm"
                      disabled={currentDoc.approvalStatus === "approved"}
                      data-testid="button-reject-document"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>

                {/* Document Display Area */}
                {viewMode === "grid" ? (
                  <div className="flex-1 overflow-auto p-6 bg-gray-100">
                    <div className="grid grid-cols-3 gap-4" data-testid="grid-thumbnails">
                      {documents.map((doc, index) => (
                        <div
                          key={doc.id}
                          onClick={() => {
                            setCurrentDocIndex(index);
                            setViewMode("single");
                          }}
                          className={`cursor-pointer rounded-lg border-2 ${
                            index === currentDocIndex ? "border-blue-500" : "border-gray-300"
                          } overflow-hidden hover:border-blue-400 transition-colors`}
                          data-testid={`thumbnail-${index}`}
                        >
                          <img
                            src={doc.fileUrl}
                            alt={doc.fileName}
                            className="w-full h-48 object-contain bg-white"
                          />
                          <div className="p-2 bg-white border-t">
                            <div className="font-medium text-sm truncate">{doc.documentType.toUpperCase()}</div>
                            <div className="text-xs text-gray-500 truncate">{doc.fileName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : viewMode === "compare" ? (
                  <div className="flex-1 overflow-auto p-6 bg-gray-100">
                    <div className="grid grid-cols-2 gap-4 h-full">
                      <div className="flex flex-col bg-white rounded-lg border p-4" data-testid="compare-document-1">
                        <h3 className="font-semibold mb-2">Document 1</h3>
                        <div className="flex-1 flex items-center justify-center overflow-hidden">
                          <img
                            src={currentDoc.fileUrl}
                            alt={currentDoc.fileName}
                            className="max-w-full max-h-full object-contain"
                            style={{
                              transform: `scale(${zoom}) rotate(${rotation}deg) translate(${panX}px, ${panY}px)`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col bg-white rounded-lg border p-4" data-testid="compare-document-2">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold">Document 2</h3>
                          <Select
                            value={compareDoc?.toString() || ""}
                            onValueChange={(val) => setCompareDoc(parseInt(val))}
                          >
                            <SelectTrigger className="w-48" data-testid="select-compare-document">
                              <SelectValue placeholder="Select document" />
                            </SelectTrigger>
                            <SelectContent>
                              {documents.map((doc, index) => (
                                index !== currentDocIndex && (
                                  <SelectItem key={doc.id} value={index.toString()}>
                                    {doc.documentType} - {doc.fileName}
                                  </SelectItem>
                                )
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex-1 flex items-center justify-center overflow-hidden">
                          {compareDoc !== null && documents[compareDoc] ? (
                            <img
                              src={documents[compareDoc].fileUrl}
                              alt={documents[compareDoc].fileName}
                              className="max-w-full max-h-full object-contain"
                              style={{
                                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                              }}
                            />
                          ) : (
                            <div className="text-gray-400">Select a document to compare</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={imageRef}
                    className="flex-1 flex items-center justify-center overflow-hidden bg-gray-100 cursor-move"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    data-testid="image-container"
                  >
                    <img
                      src={currentDoc.fileUrl}
                      alt={currentDoc.fileName}
                      className="max-w-full max-h-full object-contain"
                      style={{
                        transform: `scale(${zoom}) rotate(${rotation}deg) translate(${panX / zoom}px, ${panY / zoom}px)`,
                        transition: isDragging ? "none" : "transform 0.2s ease-out",
                      }}
                      data-testid="document-image"
                    />
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-3 border-t bg-white">
                  <div className="flex items-center gap-4" data-testid="document-info">
                    <span className="text-sm">
                      <span className="font-medium">Document:</span> {currentDoc.documentType.toUpperCase()}
                    </span>
                    {currentDoc.uploadedAt && (
                      <span className="text-sm text-gray-500">
                        <span className="font-medium">Uploaded:</span>{" "}
                        {formatDistanceToNow(new Date(currentDoc.uploadedAt), { addSuffix: true })}
                      </span>
                    )}
                    <Badge
                      variant={
                        currentDoc.approvalStatus === "approved"
                          ? "default"
                          : currentDoc.approvalStatus === "rejected"
                          ? "destructive"
                          : "secondary"
                      }
                      className={
                        currentDoc.approvalStatus === "approved"
                          ? "bg-green-600"
                          : ""
                      }
                      data-testid="badge-approval-status"
                    >
                      {currentDoc.approvalStatus.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </TabsContent>

              {/* Annotations Tab */}
              <TabsContent value="annotations" className="flex-1 m-0 p-0">
                <DocumentAnnotations
                  documentId={currentDoc.id}
                  documentUrl={currentDoc.fileUrl}
                />
              </TabsContent>

              {/* Audit Trail Tab */}
              <TabsContent value="audit" className="flex-1 m-0 p-0 overflow-auto">
                <DocumentAuditTrail documentId={currentDoc.id} />
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent data-testid="dialog-approve">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve this document? You can add optional notes below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="approval-notes">Notes (optional)</Label>
            <Textarea
              id="approval-notes"
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              placeholder="Add any notes about this approval..."
              className="mt-2"
              data-testid="textarea-approval-notes"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-approve">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-confirm-approve"
            >
              {approveMutation.isPending ? "Approving..." : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent data-testid="dialog-reject">
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Document</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this document. The driver will be notified via SMS.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="rejection-reason">Rejection Reason *</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this document is being rejected..."
              className="mt-2"
              required
              data-testid="textarea-rejection-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reject">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rejectMutation.mutate()}
              disabled={!rejectionReason.trim() || rejectMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject & Notify Driver"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
