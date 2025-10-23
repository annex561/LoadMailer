import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { 
  Upload, 
  FileText, 
  Filter, 
  Download, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Grid3x3, 
  List,
  Search,
  RefreshCw,
  Trash2,
  Eye,
  ChevronDown,
  AlertCircle,
  TrendingUp,
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

export default function DocumentManagement() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLoad, setSelectedLoad] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [uploadLoadId, setUploadLoadId] = useState<string>('');
  const [uploadDocType, setUploadDocType] = useState<string>('bol');
  const [viewerDocument, setViewerDocument] = useState<LoadDocument | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch all loads for dropdown
  const { data: loads = [] } = useQuery<Load[]>({
    queryKey: ['/api/loads']
  });

  // Fetch all documents
  const { data: allDocuments = [], isLoading: documentsLoading } = useQuery<LoadDocument[]>({
    queryKey: ['/api/documents/all'],
    refetchInterval: 10000
  });

  // Filter documents based on search and filters
  const filteredDocuments = allDocuments.filter(doc => {
    if (selectedLoad !== 'all' && doc.loadId !== selectedLoad) return false;
    if (selectedType !== 'all' && doc.documentType !== selectedType) return false;
    if (selectedStatus !== 'all' && doc.approvalStatus !== selectedStatus) return false;
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
    avgQuality: allDocuments.filter(d => d.qualityScore).reduce((acc, d) => acc + (d.qualityScore || 0), 0) / allDocuments.filter(d => d.qualityScore).length || 0
  };

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

  // File upload handler
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
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Get upload URL
        const { uploadUrl } = await apiRequest('/api/documents/upload-url', {
          method: 'POST'
        });

        // Upload file
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type
          }
        });

        // Extract public URL from upload URL
        const publicUrl = uploadUrl.split('?')[0];

        // Create document record
        await apiRequest('/api/documents', {
          method: 'POST',
          body: JSON.stringify({
            loadId: uploadLoadId,
            documentType: uploadDocType,
            imageUrl: publicUrl,
            uploadedBy: 'dispatcher'
          })
        });
      }

      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      
      toast({
        title: 'Upload Successful',
        description: `${files.length} document(s) uploaded successfully`
      });

      // Reset upload form
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
        apiRequest(`/api/documents/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approvedBy: 'dispatcher', notes: 'Bulk approved' })
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
        apiRequest(`/api/documents/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ 
            rejectedBy: 'dispatcher', 
            reason: 'Bulk rejected - please resubmit'
          })
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

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900" data-testid="heading-document-management">Document Management</h1>
            <p className="text-gray-500 mt-1">Upload, review, and manage load documents</p>
          </div>
          <Button 
            onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] })}
            variant="outline"
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
            <CardDescription>Manually upload documents for any load</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <Label>Status</Label>
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

              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedLoad('all');
                  setSelectedType('all');
                  setSelectedStatus('all');
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
                      <div className="absolute top-2 right-2">
                        {getStatusBadge(doc.approvalStatus)}
                      </div>
                    </div>
                    <CardContent className="p-4 space-y-2">
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
                        <div className="text-right">
                          {getStatusBadge(doc.approvalStatus)}
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(doc.uploadedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewerDocument(doc)}
                          data-testid={`button-list-view-${doc.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
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
            await apiRequest(`/api/documents/${viewerDocument.id}/approve`, {
              method: 'POST',
              body: JSON.stringify({ approvedBy: 'dispatcher', notes })
            });
            queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
            setViewerDocument(null);
            toast({
              title: 'Document Approved',
              description: 'Document has been approved successfully'
            });
          }}
          onReject={async (reason) => {
            await apiRequest(`/api/documents/${viewerDocument.id}/reject`, {
              method: 'POST',
              body: JSON.stringify({ rejectedBy: 'dispatcher', reason })
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
    </div>
  );
}
