import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Clock, XCircle, Circle, FileText, Package, Scale, Receipt, Fuel, Camera, File } from 'lucide-react';
import { EnhancedDocumentViewer } from './EnhancedDocumentViewer';
import type { LoadDocument } from '@shared/schema';

interface DocumentStatus {
  documentType: string;
  fileName?: string;
  approvalStatus: 'approved' | 'pending' | 'rejected' | 'missing';
  rejectionReason?: string;
  approvedBy?: string;
  isRequired: boolean;
  fileUrl?: string;
  uploadedAt?: string;
}

interface RequiredDocumentsResponse {
  required: DocumentStatus[];
  optional: DocumentStatus[];
  completionPercentage: number;
  totalRequired: number;
  approvedRequired: number;
}

interface RequiredDocumentsChecklistProps {
  loadId: string;
}

const documentTypeIcons: Record<string, typeof FileText> = {
  bol: FileText,
  pod: Package,
  weight_ticket: Scale,
  scale_ticket: Scale,
  receipt: Receipt,
  fuel_receipt: Fuel,
  freight_photo: Camera,
  inspection: FileText,
  other: File,
};

const documentTypeLabels: Record<string, string> = {
  bol: 'BOL (Bill of Lading)',
  pod: 'POD (Proof of Delivery)',
  weight_ticket: 'Weight Ticket',
  scale_ticket: 'Scale Ticket',
  receipt: 'Receipt',
  fuel_receipt: 'Fuel Receipt',
  freight_photo: 'Freight Photo',
  inspection: 'Inspection Report',
  other: 'Other Document',
};

function getStatusIcon(status: string) {
  switch (status) {
    case 'approved':
      return <CheckCircle2 className="h-5 w-5 text-green-600" data-testid={`icon-approved`} />;
    case 'pending':
      return <Clock className="h-5 w-5 text-yellow-600" data-testid={`icon-pending`} />;
    case 'rejected':
      return <XCircle className="h-5 w-5 text-red-600" data-testid={`icon-rejected`} />;
    case 'missing':
      return <Circle className="h-5 w-5 text-gray-400" data-testid={`icon-missing`} />;
    default:
      return <Circle className="h-5 w-5 text-gray-400" data-testid={`icon-unknown`} />;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'approved':
      return <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid={`badge-approved`}>Approved</Badge>;
    case 'pending':
      return <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700" data-testid={`badge-pending`}>Pending Review</Badge>;
    case 'rejected':
      return <Badge variant="destructive" data-testid={`badge-rejected`}>Rejected</Badge>;
    case 'missing':
      return <Badge variant="outline" className="text-gray-500" data-testid={`badge-missing`}>Not Uploaded</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-unknown`}>Unknown</Badge>;
  }
}

export function RequiredDocumentsChecklist({ loadId }: RequiredDocumentsChecklistProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedDocIndex, setSelectedDocIndex] = useState(0);

  const { data, isLoading, error, refetch } = useQuery<RequiredDocumentsResponse>({
    queryKey: ['/api/loads', loadId, 'documents', 'required'],
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // Poll every 30 seconds for real-time updates
  });

  // Fetch all documents for the load (for the viewer)
  const { data: allDocuments = [] } = useQuery<LoadDocument[]>({
    queryKey: ['/api/loads', loadId, 'documents'],
    refetchOnWindowFocus: true,
  });

  const handleDocumentClick = (documentType: string, isRequired: boolean) => {
    // Find the document in the allDocuments array
    const docIndex = allDocuments.findIndex(doc => 
      doc.documentType === documentType && doc.isRequired === isRequired
    );
    if (docIndex !== -1) {
      setSelectedDocIndex(docIndex);
      setViewerOpen(true);
    }
  };

  if (isLoading) {
    return (
      <Card data-testid="documents-checklist-loading">
        <CardHeader>
          <CardTitle>Document Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading documents...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="documents-checklist-error">
        <CardHeader>
          <CardTitle>Document Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-destructive">Failed to load documents. Please try again.</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { required, optional, completionPercentage, totalRequired, approvedRequired } = data;

  return (
    <div className="space-y-4" data-testid="documents-checklist">
      {/* Required Documents Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle data-testid="text-required-title">
              Required Documents ({approvedRequired}/{totalRequired} Approved)
            </CardTitle>
            <span className="text-sm font-medium text-muted-foreground" data-testid="text-completion-percentage">
              {completionPercentage}% Complete
            </span>
          </div>
          <Progress value={completionPercentage} className="mt-2" data-testid="progress-completion" />
        </CardHeader>
        <CardContent>
          {required.length === 0 ? (
            <div className="text-muted-foreground text-sm" data-testid="text-no-required-documents">
              No required documents for this load
            </div>
          ) : (
            <div className="space-y-3">
              {required.map((doc, index) => {
                const Icon = documentTypeIcons[doc.documentType] || File;
                const label = documentTypeLabels[doc.documentType] || doc.documentType;
                
                return (
                  <div
                    key={`required-${doc.documentType}-${index}`}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => handleDocumentClick(doc.documentType, true)}
                    data-testid={`document-item-${doc.documentType}`}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      {getStatusIcon(doc.approvalStatus)}
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="font-medium" data-testid={`text-document-label-${doc.documentType}`}>
                          {label}
                        </div>
                        {doc.fileName && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-filename-${doc.documentType}`}>
                            {doc.fileName}
                          </div>
                        )}
                        {doc.approvalStatus === 'rejected' && doc.rejectionReason && (
                          <div className="text-xs text-red-600 mt-1" data-testid={`text-rejection-reason-${doc.documentType}`}>
                            Reason: {doc.rejectionReason}
                          </div>
                        )}
                        {doc.approvalStatus === 'approved' && doc.approvedBy && (
                          <div className="text-xs text-green-600 mt-1" data-testid={`text-approved-by-${doc.documentType}`}>
                            Approved by {doc.approvedBy}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>{getStatusBadge(doc.approvalStatus)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Optional Documents Section */}
      {optional.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-optional-title">
              Optional Documents ({optional.filter(d => d.approvalStatus === 'approved').length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {optional.map((doc, index) => {
                const Icon = documentTypeIcons[doc.documentType] || File;
                const label = documentTypeLabels[doc.documentType] || doc.documentType;
                
                return (
                  <div
                    key={`optional-${doc.documentType}-${index}`}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => handleDocumentClick(doc.documentType, false)}
                    data-testid={`document-item-optional-${doc.documentType}`}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      {getStatusIcon(doc.approvalStatus)}
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="font-medium" data-testid={`text-optional-document-label-${doc.documentType}`}>
                          {label}
                        </div>
                        {doc.fileName && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-optional-filename-${doc.documentType}`}>
                            {doc.fileName}
                          </div>
                        )}
                        {doc.approvalStatus === 'rejected' && doc.rejectionReason && (
                          <div className="text-xs text-red-600 mt-1" data-testid={`text-optional-rejection-reason-${doc.documentType}`}>
                            Reason: {doc.rejectionReason}
                          </div>
                        )}
                      </div>
                    </div>
                    <div>{getStatusBadge(doc.approvalStatus)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enhanced Document Viewer */}
      {allDocuments.length > 0 && (
        <EnhancedDocumentViewer
          documents={allDocuments}
          initialDocIndex={selectedDocIndex}
          loadId={loadId}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}
    </div>
  );
}
