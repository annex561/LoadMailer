import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FileText, Camera, Truck, CheckCircle, Upload, Download, Trash2 } from "lucide-react";
import type { UploadResult } from "@uppy/core";
import type { LoadDocument, Load, Driver } from "@shared/schema";

const documentTypeLabels = {
  bol: "Bill of Lading",
  freight_photo: "Freight Photo",
  delivery_photo: "Delivery Photo",
  signature: "Delivery Signature"
};

const documentTypeIcons = {
  bol: FileText,
  freight_photo: Camera,
  delivery_photo: Truck,
  signature: CheckCircle
};

interface DocumentUploadFormData {
  loadId: string;
  driverId: string;
  documentType: "bol" | "freight_photo" | "delivery_photo" | "signature";
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  signerName?: string;
  notes?: string;
}

export default function DocumentManagement() {
  const [selectedLoadId, setSelectedLoadId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [signerName, setSignerName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch loads
  const { data: loads = [] } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
  });

  // Fetch drivers
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch documents for selected load
  const { data: documents = [] } = useQuery<LoadDocument[]>({
    queryKey: ["/api/loads", selectedLoadId, "documents"],
    enabled: !!selectedLoadId,
  });

  // Upload URL mutation
  const uploadUrlMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/documents/upload-url", {
        method: "POST",
      });
      return response.uploadUrl;
    },
  });

  // Document creation mutation
  const createDocumentMutation = useMutation({
    mutationFn: async (data: DocumentUploadFormData) => {
      return apiRequest("/api/documents", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads", selectedLoadId, "documents"] });
      toast({
        title: "Document uploaded successfully",
        description: "The document has been processed and stored.",
      });
      // Reset form
      setSelectedDocumentType("");
      setNotes("");
      setSignerName("");
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Failed to process the document upload.",
        variant: "destructive",
      });
    },
  });

  // Document deletion mutation
  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      return apiRequest(`/api/documents/${documentId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads", selectedLoadId, "documents"] });
      toast({
        title: "Document deleted",
        description: "The document has been successfully removed.",
      });
    },
  });

  // Request pickup documents mutation
  const requestPickupDocsMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      return apiRequest(`/api/loads/${loadId}/request-pickup-documents`, {
        method: "POST",
        body: JSON.stringify({ driverId }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Pickup documents requested",
        description: "Driver has been notified to upload pickup documents.",
      });
    },
  });

  // Request delivery documents mutation
  const requestDeliveryDocsMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      return apiRequest(`/api/loads/${loadId}/request-delivery-documents`, {
        method: "POST",
        body: JSON.stringify({ driverId }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Delivery documents requested",
        description: "Driver has been notified to upload delivery documents.",
      });
    },
  });

  const handleGetUploadParameters = async () => {
    const uploadUrl = await uploadUrlMutation.mutateAsync();
    return {
      method: "PUT" as const,
      url: uploadUrl,
    };
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful.length > 0) {
      const uploadedFile = result.successful[0];
      const uploadUrl = uploadedFile.uploadURL;
      
      if (!uploadUrl || !selectedLoadId || !selectedDriverId || !selectedDocumentType) {
        toast({
          title: "Upload incomplete",
          description: "Please fill in all required fields.",
          variant: "destructive",
        });
        return;
      }

      createDocumentMutation.mutate({
        loadId: selectedLoadId,
        driverId: selectedDriverId,
        documentType: selectedDocumentType as DocumentUploadFormData["documentType"],
        fileName: uploadedFile.name || "document",
        fileUrl: uploadUrl,
        fileSize: uploadedFile.size,
        mimeType: uploadedFile.type,
        signerName: selectedDocumentType === "signature" ? signerName : undefined,
        notes: notes || undefined,
      });
    }
  };

  const selectedLoad = loads.find(load => load.id === selectedLoadId);
  const assignedDriverId = selectedLoad?.driverId;

  // Group documents by type
  const documentsByType = documents.reduce((acc, doc) => {
    if (!acc[doc.documentType]) {
      acc[doc.documentType] = [];
    }
    acc[doc.documentType].push(doc);
    return acc;
  }, {} as Record<string, LoadDocument[]>);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" data-testid="heading-document-management">
            Document Management
          </h1>
          <p className="text-gray-600 mt-2">
            Upload and manage BOL, freight photos, and delivery documentation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Document Upload
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="load-select">Select Load</Label>
              <Select value={selectedLoadId} onValueChange={setSelectedLoadId}>
                <SelectTrigger className="bg-white border border-gray-300" data-testid="select-load">
                  <SelectValue placeholder="Choose a load..." />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-300 shadow-lg">
                  {loads.map((load) => (
                    <SelectItem key={load.id} value={load.id}>
                      {load.loadNumber} - {load.pickupAddress} → {load.deliveryAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-select">Select Driver</Label>
              <Select 
                value={selectedDriverId} 
                onValueChange={setSelectedDriverId}
                disabled={!!assignedDriverId}
              >
                <SelectTrigger className="bg-white border border-gray-300" data-testid="select-driver">
                  <SelectValue placeholder={assignedDriverId ? 
                    drivers.find(d => d.id === assignedDriverId)?.name || "Assigned driver" :
                    "Choose a driver..."
                  } />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-300 shadow-lg">
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name} - {driver.equipmentType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignedDriverId && (
                <p className="text-sm text-gray-600">
                  Driver is automatically selected based on load assignment
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="document-type">Document Type</Label>
              <Select value={selectedDocumentType} onValueChange={setSelectedDocumentType}>
                <SelectTrigger className="bg-white border border-gray-300" data-testid="select-document-type">
                  <SelectValue placeholder="Choose document type..." />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-300 shadow-lg">
                  <SelectItem value="bol">Bill of Lading (BOL)</SelectItem>
                  <SelectItem value="freight_photo">Freight Photo</SelectItem>
                  <SelectItem value="delivery_photo">Delivery Photo</SelectItem>
                  <SelectItem value="signature">Delivery Signature</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedDocumentType === "signature" && (
              <div className="space-y-2">
                <Label htmlFor="signer-name">Signer Name</Label>
                <Input
                  id="signer-name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Enter signer's name..."
                  className="bg-white border border-gray-300"
                  data-testid="input-signer-name"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes..."
                className="bg-white border border-gray-300"
                data-testid="input-notes"
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={10485760} // 10MB
                onGetUploadParameters={handleGetUploadParameters}
                onComplete={handleUploadComplete}
                buttonClassName="w-full"
              >
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload Document
                </div>
              </ObjectUploader>

              {selectedLoadId && (assignedDriverId || selectedDriverId) && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestPickupDocsMutation.mutate({
                      loadId: selectedLoadId,
                      driverId: assignedDriverId || selectedDriverId
                    })}
                    disabled={requestPickupDocsMutation.isPending}
                    className="flex-1"
                    data-testid="button-request-pickup-docs"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Request Pickup Docs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestDeliveryDocsMutation.mutate({
                      loadId: selectedLoadId,
                      driverId: assignedDriverId || selectedDriverId
                    })}
                    disabled={requestDeliveryDocsMutation.isPending}
                    className="flex-1"
                    data-testid="button-request-delivery-docs"
                  >
                    <Truck className="h-4 w-4 mr-1" />
                    Request Delivery Docs
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents Display Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Uploaded Documents
              {selectedLoadId && (
                <Badge variant="outline">
                  {documents.length} document{documents.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedLoadId ? (
              <p className="text-gray-500 text-center py-8">
                Select a load to view its documents
              </p>
            ) : documents.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No documents uploaded yet
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(documentTypeLabels).map(([type, label]) => {
                  const docsOfType = documentsByType[type] || [];
                  const IconComponent = documentTypeIcons[type as keyof typeof documentTypeIcons];
                  
                  return (
                    <div key={type} className="border rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <IconComponent className="h-4 w-4" />
                        <span className="font-medium">{label}</span>
                        <Badge variant={docsOfType.length > 0 ? "default" : "secondary"}>
                          {docsOfType.length}
                        </Badge>
                      </div>
                      
                      {docsOfType.length > 0 ? (
                        <div className="space-y-2">
                          {docsOfType.map((doc) => (
                            <div 
                              key={doc.id} 
                              className="flex items-center justify-between bg-gray-50 p-2 rounded"
                              data-testid={`document-${doc.id}`}
                            >
                              <div>
                                <p className="font-medium text-sm">{doc.fileName}</p>
                                <p className="text-xs text-gray-600">
                                  {new Date(doc.createdAt).toLocaleDateString()} 
                                  {doc.signerName && ` • Signed by: ${doc.signerName}`}
                                  {doc.notes && ` • ${doc.notes}`}
                                </p>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.open(doc.fileUrl, '_blank')}
                                  data-testid={`button-view-${doc.id}`}
                                >
                                  <Download className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteDocumentMutation.mutate(doc.id)}
                                  data-testid={`button-delete-${doc.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No {label.toLowerCase()} uploaded</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedLoad && (
        <Card>
          <CardHeader>
            <CardTitle>Load Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-600">Load Number</Label>
                <p className="font-medium" data-testid="text-load-number">{selectedLoad.loadNumber}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-600">Status</Label>
                <Badge variant="outline" className="mt-1">
                  {selectedLoad.status}
                </Badge>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-600">Pickup</Label>
                <p className="text-sm">{selectedLoad.pickupAddress}</p>
                <p className="text-xs text-gray-500">
                  {selectedLoad.pickupDate} at {selectedLoad.pickupTime}
                </p>
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-600">Delivery</Label>
                <p className="text-sm">{selectedLoad.deliveryAddress}</p>
                <p className="text-xs text-gray-500">
                  {selectedLoad.deliveryDate} at {selectedLoad.deliveryTime}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}