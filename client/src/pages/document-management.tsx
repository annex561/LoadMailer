import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Upload, 
  FileText, 
  Filter, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Grid3x3, 
  List,
  Search,
  RefreshCw,
  Eye,
  AlertCircle,
  Sparkles,
  Loader2,
  CheckCheck,
  Brain,
  Zap,
  FileCheck
} from 'lucide-react';
import { EnhancedDocumentViewer } from '@/components/EnhancedDocumentViewer';

interface Load {
  id: string;
  loadNumber: string;
  pickupLocation: string;
  deliveryLocation: string;
  status: string;
}

interface DocumentExtraction {
  id: string;
  documentId: string;
  documentType: 'bol' | 'recon' | 'driver_sheet' | 'unknown';
  extractedData: any;
  confidence: number;
  isVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface LoadDocument {
  id: string;
  loadId: string;
  documentType: string;
  imageUrl: string;
  uploadedAt: string;
  uploadedBy: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  rejectedBy: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  approvalNotes: string | null;
  rejectionReason: string | null;
  qualityScore: number | null;
  resolution: string | null;
  fileSize: number | null;
  version: number;
  isLatestVersion: boolean;
  load?: Load;
  processingStatus?: 'uploaded' | 'processing' | 'processed' | 'verified';
  extraction?: DocumentExtraction;
}

const DOCUMENT_TYPES = [
  { value: 'bol', label: 'Bill of Lading (BOL)' },
  { value: 'pod', label: 'Proof of Delivery (POD)' },
  { value: 'weight_ticket', label: 'Weight Ticket' },
  { value: 'inspection', label: 'Inspection Report' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'fuel_receipt', label: 'Fuel Receipt' },
  { value: 'scale_ticket', label: 'Scale Ticket' },
  { value: 'other', label: 'Other' }
];

const APPROVAL_STATUSES = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

const PROCESSING_STATUSES = [
  { value: 'all', label: 'All Processing Statuses' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'processing', label: 'Processing' },
  { value: 'processed', label: 'Processed' },
  { value: 'verified', label: 'Verified' }
];

export default function DocumentManagement() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoad, setSelectedLoad] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedProcessingStatus, setSelectedProcessingStatus] = useState<string>('all');
  const [uploadLoadId, setUploadLoadId] = useState<string>('');
  const [uploadDocType, setUploadDocType] = useState<string>('bol');
  const [viewerDocument, setViewerDocument] = useState<LoadDocument | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [autoProcessEnabled, setAutoProcessEnabled] = useState(true);
  
  const [verificationModal, setVerificationModal] = useState<{
    open: boolean;
    document: LoadDocument | null;
    extraction: DocumentExtraction | null;
    editedData: any;
    corrections: Array<{ field: string; originalValue: string; correctedValue: string }>;
    notes: string;
  }>({
    open: false,
    document: null,
    extraction: null,
    editedData: {},
    corrections: [],
    notes: ''
  });

  const [extractionResultsModal, setExtractionResultsModal] = useState<{
    open: boolean;
    document: LoadDocument | null;
    extraction: DocumentExtraction | null;
  }>({
    open: false,
    document: null,
    extraction: null
  });

  // Fetch all loads for dropdown
  const { data: loads = [] } = useQuery<Load[]>({
    queryKey: ['/api/loads']
  });

  // Fetch all documents with extractions
  const { data: allDocuments = [], isLoading: documentsLoading } = useQuery<LoadDocument[]>({
    queryKey: ['/api/documents/all'],
    refetchInterval: 5000
  });

  // Enhance documents with extraction data and processing status
  const documentsWithExtractions = allDocuments.map(doc => {
    let processingStatus: LoadDocument['processingStatus'] = 'uploaded';
    
    if (doc.extraction) {
      if (doc.extraction.isVerified) {
        processingStatus = 'verified';
      } else {
        processingStatus = 'processed';
      }
    }
    
    return {
      ...doc,
      processingStatus
    };
  });

  // Filter documents based on search and filters
  const filteredDocuments = documentsWithExtractions.filter(doc => {
    if (selectedLoad !== 'all' && doc.loadId !== selectedLoad) return false;
    if (selectedType !== 'all' && doc.documentType !== selectedType) return false;
    if (selectedStatus !== 'all' && doc.approvalStatus !== selectedStatus) return false;
    if (selectedProcessingStatus !== 'all' && doc.processingStatus !== selectedProcessingStatus) return false;
    if (searchQuery) {
      const loadNumber = doc.load?.loadNumber ?? '';
      if (!loadNumber.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    }
    return true;
  });

  // Calculate stats
  const stats = {
    total: allDocuments.length,
    pending: allDocuments.filter(d => d.approvalStatus === 'pending').length,
    approved: allDocuments.filter(d => d.approvalStatus === 'approved').length,
    rejected: allDocuments.filter(d => d.approvalStatus === 'rejected').length,
    avgQuality: allDocuments.filter(d => d.qualityScore).reduce((acc, d) => acc + (d.qualityScore || 0), 0) / allDocuments.filter(d => d.qualityScore).length || 0,
    processed: documentsWithExtractions.filter(d => d.processingStatus === 'processed' || d.processingStatus === 'verified').length,
    verified: documentsWithExtractions.filter(d => d.processingStatus === 'verified').length,
  };

  // AI Processing mutation
  const processDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest('POST', `/api/documents/${documentId}/process`);
      return response.json();
    },
    onSuccess: (data, documentId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      
      if (data.alreadyProcessed) {
        toast({
          title: 'Already Processed',
          description: 'This document has already been processed'
        });
      } else {
        toast({
          title: 'AI Processing Complete',
          description: `Document classified as ${data.documentType.toUpperCase()}`
        });
        
        const document = allDocuments.find(d => d.id === documentId);
        if (document) {
          setExtractionResultsModal({
            open: true,
            document,
            extraction: {
              id: data.extractionId,
              documentId,
              documentType: data.documentType,
              extractedData: data.extractedData,
              confidence: data.confidence,
              isVerified: false,
              verifiedBy: null,
              verifiedAt: null,
              createdAt: new Date().toISOString()
            }
          });
        }
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Processing Failed',
        description: error.message || 'Failed to process document',
        variant: 'destructive'
      });
    }
  });

  // Batch processing mutation
  const batchProcessMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const results = await Promise.allSettled(
        documentIds.map(id => 
          apiRequest('POST', `/api/documents/${id}/process`).then(r => r.json())
        )
      );
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      toast({
        title: 'Batch Processing Complete',
        description: `${successful} processed successfully, ${failed} failed`
      });
      setSelectedDocuments(new Set());
    }
  });

  // Verification mutation
  const verifyExtractionMutation = useMutation({
    mutationFn: async ({ 
      documentId, 
      extractedData, 
      corrections, 
      notes 
    }: { 
      documentId: string; 
      extractedData: any; 
      corrections: Array<{ field: string; originalValue: string; correctedValue: string }>;
      notes: string;
    }) => {
      const response = await apiRequest('POST', `/api/documents/${documentId}/verify`, {
        extractedData,
        verifiedBy: 'dispatcher',
        corrections
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      setVerificationModal({
        open: false,
        document: null,
        extraction: null,
        editedData: {},
        corrections: [],
        notes: ''
      });
      
      toast({
        title: 'Verification Complete',
        description: data.workflowMessage || 'Document verified successfully'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Verification Failed',
        description: error.message || 'Failed to verify document',
        variant: 'destructive'
      });
    }
  });

  // Toggle document selection
  const toggleDocumentSelection = (docId: string) => {
    setSelectedDocuments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(docId)) {
        newSet.delete(docId);
      } else {
        newSet.add(docId);
      }
      return newSet;
    });
  };

  // Select all filtered documents
  const selectAll = () => {
    if (selectedDocuments.size === filteredDocuments.length) {
      setSelectedDocuments(new Set());
    } else {
      setSelectedDocuments(new Set(filteredDocuments.map(d => d.id)));
    }
  };

  // File upload handler with auto-processing
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!uploadLoadId) {
      toast({
        title: 'Load Required',
        description: 'Please select a load before uploading documents',
        variant: 'destructive'
      });
      return;
    }

    setIsUploading(true);

    try {
      const uploadedDocIds: string[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        const response = await apiRequest('POST', '/api/documents/upload-url');
        const { uploadUrl } = await response.json();

        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type
          }
        });

        const publicUrl = uploadUrl.split('?')[0];

        const docResponse = await apiRequest('POST', '/api/documents', {
          loadId: uploadLoadId,
          documentType: uploadDocType,
          imageUrl: publicUrl,
          uploadedBy: 'dispatcher'
        });
        
        const doc = await docResponse.json();
        
        uploadedDocIds.push(doc.id);
      }

      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      
      toast({
        title: 'Upload Successful',
        description: `${files.length} document(s) uploaded successfully`
      });

      if (autoProcessEnabled && uploadedDocIds.length > 0) {
        toast({
          title: 'Auto-Processing Started',
          description: 'AI is processing your documents...'
        });
        
        for (const docId of uploadedDocIds) {
          processDocumentMutation.mutate(docId);
        }
      }

      setUploadLoadId('');
      setUploadDocType('bol');
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: 'Failed to upload documents. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Bulk approve mutation
  const bulkApproveMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const promises = documentIds.map(id => 
        apiRequest('POST', `/api/documents/${id}/approve`, {
          approvedBy: 'dispatcher',
          notes: 'Bulk approved'
        })
      );
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      setSelectedDocuments(new Set());
      toast({
        title: 'Bulk Approval Complete',
        description: `${selectedDocuments.size} document(s) approved`
      });
    }
  });

  // Bulk reject mutation
  const bulkRejectMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const promises = documentIds.map(id => 
        apiRequest('POST', `/api/documents/${id}/reject`, {
          rejectedBy: 'dispatcher', 
          reason: 'Bulk rejected - please resubmit'
        })
      );
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      setSelectedDocuments(new Set());
      toast({
        title: 'Bulk Rejection Complete',
        description: `${selectedDocuments.size} document(s) rejected`
      });
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500" data-testid={`badge-approved`}><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500" data-testid={`badge-rejected`}><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge className="bg-yellow-500" data-testid={`badge-pending`}><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const getProcessingStatusBadge = (status: LoadDocument['processingStatus']) => {
    switch (status) {
      case 'verified':
        return <Badge className="bg-green-600" data-testid="badge-verified"><CheckCheck className="w-3 h-3 mr-1" />Verified</Badge>;
      case 'processed':
        return <Badge className="bg-yellow-600" data-testid="badge-processed"><Brain className="w-3 h-3 mr-1" />Processed</Badge>;
      case 'processing':
        return <Badge className="bg-blue-600" data-testid="badge-processing"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      default:
        return <Badge className="bg-gray-500" data-testid="badge-uploaded"><Upload className="w-3 h-3 mr-1" />Uploaded</Badge>;
    }
  };

  const getDocumentTypeBadge = (type: string, confidence?: number) => {
    const colors = {
      bol: 'bg-blue-500',
      recon: 'bg-purple-500',
      driver_sheet: 'bg-orange-500',
      unknown: 'bg-gray-500'
    };
    
    const color = colors[type as keyof typeof colors] || 'bg-gray-500';
    
    return (
      <Badge className={color} data-testid={`badge-doctype-${type}`}>
        {type.toUpperCase()}
        {confidence !== undefined && ` (${Math.round(confidence * 100)}%)`}
      </Badge>
    );
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const openVerificationModal = (document: LoadDocument, extraction: DocumentExtraction) => {
    setVerificationModal({
      open: true,
      document,
      extraction,
      editedData: { ...extraction.extractedData },
      corrections: [],
      notes: ''
    });
  };

  const handleFieldEdit = (field: string, newValue: string) => {
    const originalValue = verificationModal.extraction?.extractedData[field];
    
    setVerificationModal(prev => {
      const editedData = { ...prev.editedData, [field]: newValue };
      
      const corrections = [...prev.corrections.filter(c => c.field !== field)];
      if (originalValue !== newValue) {
        corrections.push({
          field,
          originalValue: String(originalValue || ''),
          correctedValue: newValue
        });
      }
      
      return { ...prev, editedData, corrections };
    });
  };

  const submitVerification = () => {
    if (!verificationModal.document) return;
    
    verifyExtractionMutation.mutate({
      documentId: verificationModal.document.id,
      extractedData: verificationModal.editedData,
      corrections: verificationModal.corrections,
      notes: verificationModal.notes
    });
  };

  const renderExtractionFields = (data: any, documentType: string, confidence: number) => {
    const fields: { [key: string]: string } = {};
    
    if (documentType === 'bol') {
      fields['Load Number'] = data.loadNumber || '';
      fields['Pickup Address'] = data.pickupAddress || '';
      fields['Delivery Address'] = data.deliveryAddress || '';
      fields['Weight'] = data.weight || '';
      fields['Pieces'] = data.pieces || '';
      fields['Commodity'] = data.commodity || '';
      fields['Rate'] = data.rate || '';
      fields['Freight Charges'] = data.freightCharges || '';
      fields['Fuel Surcharge'] = data.fuelSurcharge || '';
      fields['Total Amount'] = data.totalAmount || '';
    } else if (documentType === 'driver_sheet') {
      fields['Driver Name'] = data.driverName || '';
      fields['Pickup Address'] = data.pickupAddress || '';
      fields['Delivery Address'] = data.deliveryAddress || '';
      fields['Appointment Time'] = data.appointmentTime || '';
      fields['Special Instructions'] = data.specialInstructions || '';
    } else if (documentType === 'recon') {
      fields['Load Number'] = data.loadNumber || '';
      fields['Total Revenue'] = data.totalRevenue || '';
      fields['Net Profit'] = data.netProfit || '';
      fields['Date'] = data.date || '';
    }
    
    return (
      <div className="space-y-3">
        {Object.entries(fields).map(([label, value]) => {
          const fieldKey = label.toLowerCase().replace(/\s+/g, '_');
          const isLowConfidence = confidence < 0.8;
          
          return (
            <div key={label} className="space-y-1">
              <Label className="flex items-center gap-2">
                {label}
                {isLowConfidence && (
                  <Badge variant="outline" className="text-orange-600 border-orange-600">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Low Confidence
                  </Badge>
                )}
              </Label>
              <Input
                value={verificationModal.editedData[fieldKey] || value}
                onChange={(e) => handleFieldEdit(fieldKey, e.target.value)}
                className={isLowConfidence ? 'border-orange-300 bg-orange-50' : ''}
                data-testid={`input-field-${fieldKey}`}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const pendingProcessingDocs = filteredDocuments.filter(d => 
    d.processingStatus === 'uploaded' && !processDocumentMutation.isPending
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900" data-testid="heading-document-management">Document Management</h1>
            <p className="text-gray-500 mt-1">Upload, AI-process, verify, and manage load documents</p>
          </div>
          <div className="flex gap-2">
            {pendingProcessingDocs.length > 0 && (
              <Button 
                onClick={() => batchProcessMutation.mutate(pendingProcessingDocs.map(d => d.id))}
                disabled={batchProcessMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
                data-testid="button-process-all-pending"
              >
                {batchProcessMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Process All Pending ({pendingProcessingDocs.length})
              </Button>
            )}
            <Button 
              onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] })}
              variant="outline"
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
          <Card data-testid="card-stat-total">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-pending">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Pending Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-approved">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Approved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-rejected">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Rejected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-processed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">AI Processed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{stats.processed}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-verified">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Verified</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.verified}</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-stat-quality">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Avg Quality</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.avgQuality.toFixed(0)}%</div>
            </CardContent>
          </Card>
        </div>

        {/* Upload Section */}
        <Card data-testid="card-upload">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Documents
            </CardTitle>
            <CardDescription>Upload documents with automatic AI processing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-900">Auto AI Processing</p>
                  <p className="text-sm text-blue-700">Documents will be automatically processed after upload</p>
                </div>
              </div>
              <Switch
                checked={autoProcessEnabled}
                onCheckedChange={setAutoProcessEnabled}
                data-testid="switch-auto-process"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Select Load</Label>
                <Select value={uploadLoadId} onValueChange={setUploadLoadId}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-upload-load">
                    <SelectValue placeholder="Choose a load..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {loads.map(load => (
                      <SelectItem key={load.id} value={load.id}>
                        {load.loadNumber} - {load.pickupLocation} → {load.deliveryLocation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Document Type</Label>
                <Select value={uploadDocType} onValueChange={setUploadDocType}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-upload-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {DOCUMENT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
              onClick={() => document.getElementById('file-upload')?.click()}
              data-testid="dropzone-upload"
            >
              <Input
                id="file-upload"
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
                disabled={isUploading}
                data-testid="input-file-upload"
              />
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium">
                {isUploading ? 'Uploading...' : 'Click to upload or drag and drop'}
              </p>
              <p className="text-sm text-gray-500 mt-2">PNG, JPG, PDF up to 10MB</p>
            </div>
          </CardContent>
        </Card>

        {/* Filters and Document Library */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Filters Sidebar */}
          <Card className="lg:col-span-1" data-testid="card-filters">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Search Load</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Load number..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-white border border-gray-300"
                    data-testid="input-search-load"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Load</Label>
                <Select value={selectedLoad} onValueChange={setSelectedLoad}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-filter-load">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg max-h-64 overflow-y-auto">
                    <SelectItem value="all">All Loads</SelectItem>
                    {loads.map(load => (
                      <SelectItem key={load.id} value={load.id}>
                        {load.loadNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Document Type</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    <SelectItem value="all">All Types</SelectItem>
                    {DOCUMENT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Approval Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {APPROVAL_STATUSES.map(status => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>AI Processing Status</Label>
                <Select value={selectedProcessingStatus} onValueChange={setSelectedProcessingStatus}>
                  <SelectTrigger className="bg-white border border-gray-300" data-testid="select-filter-processing-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-300 shadow-lg">
                    {PROCESSING_STATUSES.map(status => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedLoad('all');
                  setSelectedType('all');
                  setSelectedStatus('all');
                  setSelectedProcessingStatus('all');
                }}
                data-testid="button-clear-filters"
              >
                Clear Filters
              </Button>
            </CardContent>
          </Card>

          {/* Document Library */}
          <div className="lg:col-span-3 space-y-4">
            {/* Toolbar */}
            <Card data-testid="card-toolbar">
              <CardContent className="pt-6">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={selectedDocuments.size === filteredDocuments.length && filteredDocuments.length > 0}
                      onCheckedChange={selectAll}
                      data-testid="checkbox-select-all"
                    />
                    <span className="text-sm text-gray-600">
                      {selectedDocuments.size} selected
                    </span>
                    
                    {selectedDocuments.size > 0 && (
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => batchProcessMutation.mutate(Array.from(selectedDocuments))}
                          disabled={batchProcessMutation.isPending}
                          data-testid="button-batch-process"
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Process AI
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => bulkApproveMutation.mutate(Array.from(selectedDocuments))}
                          disabled={bulkApproveMutation.isPending}
                          data-testid="button-bulk-approve"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => bulkRejectMutation.mutate(Array.from(selectedDocuments))}
                          disabled={bulkRejectMutation.isPending}
                          data-testid="button-bulk-reject"
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={viewMode === 'grid' ? 'default' : 'outline'}
                      onClick={() => setViewMode('grid')}
                      data-testid="button-view-grid"
                    >
                      <Grid3x3 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'list' ? 'default' : 'outline'}
                      onClick={() => setViewMode('list')}
                      data-testid="button-view-list"
                    >
                      <List className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Document Grid/List */}
            {documentsLoading ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <RefreshCw className="w-8 h-8 mx-auto animate-spin text-gray-400 mb-4" />
                  <p className="text-gray-500">Loading documents...</p>
                </CardContent>
              </Card>
            ) : filteredDocuments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-500">No documents found</p>
                  <p className="text-sm text-gray-400 mt-2">Upload documents or adjust your filters</p>
                </CardContent>
              </Card>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="grid-documents">
                {filteredDocuments.map(doc => (
                  <Card key={doc.id} className="overflow-hidden hover:shadow-lg transition-shadow" data-testid={`card-document-${doc.id}`}>
                    <div className="relative aspect-video bg-gray-100">
                      <img 
                        src={doc.imageUrl} 
                        alt={doc.documentType}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => setViewerDocument(doc)}
                      />
                      <div className="absolute top-2 left-2">
                        <Checkbox
                          checked={selectedDocuments.has(doc.id)}
                          onCheckedChange={() => toggleDocumentSelection(doc.id)}
                          className="bg-white"
                          data-testid={`checkbox-document-${doc.id}`}
                        />
                      </div>
                      <div className="absolute top-2 right-2 flex flex-col gap-1">
                        {getStatusBadge(doc.approvalStatus)}
                        {getProcessingStatusBadge(doc.processingStatus)}
                        {doc.extraction && getDocumentTypeBadge(doc.extraction.documentType, doc.extraction.confidence)}
                      </div>
                    </div>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold text-sm">{doc.load?.loadNumber}</h3>
                          <p className="text-xs text-gray-500">
                            {DOCUMENT_TYPES.find(t => t.value === doc.documentType)?.label}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewerDocument(doc)}
                          data-testid={`button-view-${doc.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>

                      {doc.extraction && doc.extraction.confidence && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-gray-600">
                            <span>AI Confidence</span>
                            <span>{Math.round(doc.extraction.confidence * 100)}%</span>
                          </div>
                          <Progress value={doc.extraction.confidence * 100} className="h-2" />
                        </div>
                      )}

                      <div className="flex gap-2">
                        {doc.processingStatus === 'uploaded' && (
                          <Button
                            size="sm"
                            className="flex-1 bg-purple-600 hover:bg-purple-700"
                            onClick={() => processDocumentMutation.mutate(doc.id)}
                            disabled={processDocumentMutation.isPending}
                            data-testid={`button-process-${doc.id}`}
                          >
                            {processDocumentMutation.isPending ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3 mr-1" />
                            )}
                            Process AI
                          </Button>
                        )}
                        
                        {doc.processingStatus === 'processed' && doc.extraction && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => setExtractionResultsModal({
                                open: true,
                                document: doc,
                                extraction: doc.extraction!
                              })}
                              data-testid={`button-view-extraction-${doc.id}`}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              View Data
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700"
                              onClick={() => openVerificationModal(doc, doc.extraction!)}
                              data-testid={`button-verify-${doc.id}`}
                            >
                              <FileCheck className="w-3 h-3 mr-1" />
                              Verify
                            </Button>
                          </>
                        )}
                        
                        {doc.processingStatus === 'verified' && doc.extraction && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setExtractionResultsModal({
                              open: true,
                              document: doc,
                              extraction: doc.extraction!
                            })}
                            data-testid={`button-view-verified-${doc.id}`}
                          >
                            <CheckCheck className="w-3 h-3 mr-1" />
                            Verified by {doc.extraction.verifiedBy}
                          </Button>
                        )}
                      </div>

                      <div className="flex gap-2 text-xs text-gray-500">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        {doc.qualityScore && <span>• {doc.qualityScore}% quality</span>}
                      </div>
                      <p className="text-xs text-gray-400">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card data-testid="list-documents">
                <CardContent className="p-0">
                  <div className="divide-y">
                    {filteredDocuments.map(doc => (
                      <div key={doc.id} className="p-4 flex items-center gap-4 hover:bg-gray-50" data-testid={`row-document-${doc.id}`}>
                        <Checkbox
                          checked={selectedDocuments.has(doc.id)}
                          onCheckedChange={() => toggleDocumentSelection(doc.id)}
                          data-testid={`checkbox-list-${doc.id}`}
                        />
                        <img 
                          src={doc.imageUrl} 
                          alt={doc.documentType}
                          className="w-16 h-16 object-cover rounded cursor-pointer"
                          onClick={() => setViewerDocument(doc)}
                        />
                        <div className="flex-1">
                          <h3 className="font-semibold">{doc.load?.loadNumber}</h3>
                          <p className="text-sm text-gray-500">
                            {DOCUMENT_TYPES.find(t => t.value === doc.documentType)?.label}
                          </p>
                        </div>
                        <div className="flex gap-2 items-center">
                          {getStatusBadge(doc.approvalStatus)}
                          {getProcessingStatusBadge(doc.processingStatus)}
                          {doc.extraction && getDocumentTypeBadge(doc.extraction.documentType, doc.extraction.confidence)}
                        </div>
                        <div className="flex gap-2">
                          {doc.processingStatus === 'uploaded' && (
                            <Button
                              size="sm"
                              className="bg-purple-600 hover:bg-purple-700"
                              onClick={() => processDocumentMutation.mutate(doc.id)}
                              disabled={processDocumentMutation.isPending}
                              data-testid={`button-list-process-${doc.id}`}
                            >
                              <Sparkles className="w-3 h-3 mr-1" />
                              Process
                            </Button>
                          )}
                          {doc.processingStatus === 'processed' && doc.extraction && (
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => openVerificationModal(doc, doc.extraction!)}
                              data-testid={`button-list-verify-${doc.id}`}
                            >
                              <FileCheck className="w-3 h-3 mr-1" />
                              Verify
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewerDocument(doc)}
                            data-testid={`button-list-view-${doc.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Enhanced Document Viewer Modal */}
      {viewerDocument && (
        <EnhancedDocumentViewer
          document={viewerDocument}
          onClose={() => setViewerDocument(null)}
          onApprove={async (notes) => {
            await apiRequest('POST', `/api/documents/${viewerDocument.id}/approve`, {
              approvedBy: 'dispatcher',
              notes
            });
            queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
            setViewerDocument(null);
            toast({
              title: 'Document Approved',
              description: 'Document has been approved successfully'
            });
          }}
          onReject={async (reason) => {
            await apiRequest('POST', `/api/documents/${viewerDocument.id}/reject`, {
              rejectedBy: 'dispatcher',
              reason
            });
            queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
            setViewerDocument(null);
            toast({
              title: 'Document Rejected',
              description: 'Driver has been notified to resubmit'
            });
          }}
        />
      )}

      {/* Extraction Results Modal */}
      <Dialog open={extractionResultsModal.open} onOpenChange={(open) => !open && setExtractionResultsModal({ open: false, document: null, extraction: null })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="modal-extraction-results">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              AI Extraction Results
            </DialogTitle>
            <DialogDescription>
              Review the data extracted by AI from this document
            </DialogDescription>
          </DialogHeader>

          {extractionResultsModal.extraction && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                {getDocumentTypeBadge(
                  extractionResultsModal.extraction.documentType,
                  extractionResultsModal.extraction.confidence
                )}
                <div className="flex-1">
                  <Progress value={extractionResultsModal.extraction.confidence * 100} className="h-3" />
                </div>
                <span className="text-sm font-medium">
                  {Math.round(extractionResultsModal.extraction.confidence * 100)}% Confidence
                </span>
              </div>

              <div className="border rounded-lg p-4 bg-gray-50">
                <h4 className="font-semibold mb-3">Extracted Fields</h4>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(extractionResultsModal.extraction.extractedData).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs text-gray-600">{key}</Label>
                      <p className="text-sm font-medium">{String(value) || 'N/A'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {extractionResultsModal.extraction.confidence < 0.8 && (
                <div className="flex gap-2 items-start p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-orange-900">Low Confidence Detection</p>
                    <p className="text-sm text-orange-700">
                      Please verify this data carefully before applying to workflows.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtractionResultsModal({ open: false, document: null, extraction: null })}
              data-testid="button-close-extraction-results"
            >
              Close
            </Button>
            {extractionResultsModal.document && extractionResultsModal.extraction && (
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => {
                  setExtractionResultsModal({ open: false, document: null, extraction: null });
                  openVerificationModal(extractionResultsModal.document!, extractionResultsModal.extraction!);
                }}
                data-testid="button-verify-from-results"
              >
                <FileCheck className="w-4 h-4 mr-2" />
                Verify & Apply
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification Modal */}
      <Dialog open={verificationModal.open} onOpenChange={(open) => !open && setVerificationModal({ ...verificationModal, open: false })}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" data-testid="modal-verification">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-green-600" />
              Verify & Edit Extraction
            </DialogTitle>
            <DialogDescription>
              Review and correct the extracted data before applying to workflows
            </DialogDescription>
          </DialogHeader>

          {verificationModal.document && verificationModal.extraction && (
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Document Preview */}
              <div className="space-y-3">
                <h4 className="font-semibold">Document Preview</h4>
                <img 
                  src={verificationModal.document.imageUrl}
                  alt="Document"
                  className="w-full border rounded-lg"
                />
                <div className="flex gap-2">
                  {getDocumentTypeBadge(
                    verificationModal.extraction.documentType,
                    verificationModal.extraction.confidence
                  )}
                  {getProcessingStatusBadge(verificationModal.document.processingStatus)}
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Load Number</Label>
                  <p className="font-medium">{verificationModal.document.load?.loadNumber}</p>
                </div>
              </div>

              {/* Right: Editable Fields */}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-1">Extracted Data</h4>
                  <p className="text-sm text-gray-600">
                    Edit any fields that need correction. Changes will be tracked.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">AI Confidence</span>
                    <span className="font-medium">
                      {Math.round(verificationModal.extraction.confidence * 100)}%
                    </span>
                  </div>
                  <Progress value={verificationModal.extraction.confidence * 100} className="h-2" />
                </div>

                {renderExtractionFields(
                  verificationModal.extraction.extractedData,
                  verificationModal.extraction.documentType,
                  verificationModal.extraction.confidence
                )}

                <div className="space-y-2">
                  <Label>Verification Notes (Optional)</Label>
                  <Textarea
                    value={verificationModal.notes}
                    onChange={(e) => setVerificationModal({ ...verificationModal, notes: e.target.value })}
                    placeholder="Add any notes about corrections or observations..."
                    className="min-h-[80px]"
                    data-testid="textarea-verification-notes"
                  />
                </div>

                {verificationModal.corrections.length > 0 && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="font-medium text-blue-900 mb-2">
                      {verificationModal.corrections.length} Correction(s) Made
                    </p>
                    <ul className="text-sm text-blue-700 space-y-1">
                      {verificationModal.corrections.map((c, i) => (
                        <li key={i}>
                          <span className="font-medium">{c.field}:</span> {c.originalValue} → {c.correctedValue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="font-medium text-green-900 mb-1">Workflow Actions</p>
                  <p className="text-sm text-green-700">
                    {verificationModal.extraction.documentType === 'bol' && 
                      'Will update load rate and financial records'}
                    {verificationModal.extraction.documentType === 'driver_sheet' && 
                      'Will send SMS to driver and start GPS tracking'}
                    {verificationModal.extraction.documentType === 'recon' && 
                      'Will log reconciliation data and update financials'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVerificationModal({ ...verificationModal, open: false })}
              data-testid="button-cancel-verification"
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={submitVerification}
              disabled={verifyExtractionMutation.isPending}
              data-testid="button-submit-verification"
            >
              {verifyExtractionMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCheck className="w-4 h-4 mr-2" />
              )}
              Verify & Apply Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
