import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { 
  Upload, 
  CheckCircle2, 
  XCircle, 
  Edit, 
  FileText,
  User,
  Clock,
  History
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { DocumentAuditLog } from "@shared/schema";

interface DocumentAuditTrailProps {
  documentId: string;
}

const actionIcons: Record<string, typeof Upload> = {
  uploaded: Upload,
  approved: CheckCircle2,
  rejected: XCircle,
  recategorized: Edit,
  resubmitted: Upload,
  annotated: Edit,
  deleted: XCircle,
};

const actionColors: Record<string, string> = {
  uploaded: "text-gray-600",
  approved: "text-green-600",
  rejected: "text-red-600",
  recategorized: "text-blue-600",
  resubmitted: "text-gray-600",
  annotated: "text-purple-600",
  deleted: "text-red-600",
};

const actionLabels: Record<string, string> = {
  uploaded: "Uploaded",
  approved: "Approved",
  rejected: "Rejected",
  recategorized: "Recategorized",
  resubmitted: "Resubmitted",
  annotated: "Annotated",
  deleted: "Deleted",
};

export function DocumentAuditTrail({ documentId }: DocumentAuditTrailProps) {
  const { data: auditLogs = [], isLoading, error } = useQuery<DocumentAuditLog[]>({
    queryKey: ["/api/documents", documentId, "audit-log"],
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground">Loading audit trail...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-destructive">Failed to load audit trail</div>
      </div>
    );
  }

  if (auditLogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center text-muted-foreground">
          <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No audit history available for this document</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4" data-testid="text-audit-trail-title">
          Document History
        </h3>

        <div className="space-y-4">
          {auditLogs.map((log, index) => {
            const Icon = actionIcons[log.action] || FileText;
            const colorClass = actionColors[log.action] || "text-gray-600";
            const actionLabel = actionLabels[log.action] || log.action;
            
            return (
              <div key={log.id} className="relative" data-testid={`audit-entry-${index}`}>
                {/* Timeline line */}
                {index < auditLogs.length - 1 && (
                  <div className="absolute left-4 top-10 w-0.5 h-full bg-gray-200" />
                )}

                <Card className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 ${colorClass}`}>
                      <div className="w-8 h-8 rounded-full bg-white border-2 flex items-center justify-center">
                        <Icon className="w-4 h-4" data-testid={`icon-${log.action}`} />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h4 className={`font-semibold ${colorClass}`} data-testid={`text-action-${index}`}>
                            {actionLabel}
                            {log.documentVersion && log.documentVersion > 1 && (
                              <Badge variant="outline" className="ml-2">
                                v{log.documentVersion}
                              </Badge>
                            )}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                            <User className="w-3 h-3" />
                            <span data-testid={`text-performer-${index}`}>{log.performedByName}</span>
                            <span>•</span>
                            <span className="capitalize">{log.performedByRole}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Clock className="w-3 h-3" />
                          <span data-testid={`text-timestamp-${index}`}>
                            {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      {/* Action Details */}
                      <div className="space-y-1 text-sm">
                        {log.action === "recategorized" && log.previousValue && log.newValue && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Changed from:</span>
                            <Badge variant="outline">{log.previousValue}</Badge>
                            <span>→</span>
                            <Badge variant="outline">{log.newValue}</Badge>
                          </div>
                        )}

                        {log.action === "rejected" && log.reason && (
                          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                            <div className="font-medium text-red-900 mb-1">Rejection Reason:</div>
                            <div className="text-red-700" data-testid={`text-reason-${index}`}>{log.reason}</div>
                            <div className="text-xs text-red-600 mt-2">
                              📱 Driver notified via SMS
                            </div>
                          </div>
                        )}

                        {log.action === "approved" && log.notes && (
                          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                            <div className="font-medium text-green-900 mb-1">Approval Notes:</div>
                            <div className="text-green-700" data-testid={`text-notes-${index}`}>{log.notes}</div>
                          </div>
                        )}

                        {log.action === "uploaded" && log.metadata && (
                          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-md text-muted-foreground">
                            {typeof log.metadata === 'object' && 'source' in log.metadata && (
                              <div>
                                <span className="font-medium">Source:</span>{" "}
                                {log.metadata.source === 'mms' ? '📱 MMS Upload' : 
                                 log.metadata.source === 'web' ? '💻 Web Upload' : 
                                 '📲 Mobile App'}
                              </div>
                            )}
                            {typeof log.metadata === 'object' && 'category' in log.metadata && (
                              <div>
                                <span className="font-medium">Category:</span>{" "}
                                <Badge variant="outline">{String(log.metadata.category).toUpperCase()}</Badge>
                                {typeof log.metadata === 'object' && 'autoDetected' in log.metadata && log.metadata.autoDetected && (
                                  <span className="text-xs ml-2">(auto-detected)</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {log.action === "resubmitted" && (
                          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700">
                            Higher quality document submitted
                          </div>
                        )}

                        {log.notes && !["approved", "rejected"].includes(log.action) && (
                          <div className="mt-2 text-muted-foreground italic">
                            Note: {log.notes}
                          </div>
                        )}
                      </div>

                      {/* Timestamp detail */}
                      <div className="mt-2 text-xs text-muted-foreground">
                        {format(new Date(log.createdAt), "PPpp")}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
