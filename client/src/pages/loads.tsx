import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Download, Plus, Eye, Edit, Mail, Copy, Trash2, FileText, Camera, Truck, MapPin, DollarSign, Building2, Phone } from "lucide-react";
import { format } from "date-fns";
import type { LoadWithRelations, LoadDocument } from "@shared/schema";
import LoadFormModal from "@/components/load-form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

// Component to display document counts for a load
function DocumentCount({ loadId }: { loadId: string }) {
  const { data: documents = [] } = useQuery<LoadDocument[]>({
    queryKey: ["/api/loads", loadId, "documents"],
    enabled: !!loadId,
  });

  const bolCount = documents.filter(doc => doc.documentType === "bol").length;
  const photoCount = documents.filter(doc => 
    doc.documentType === "freight_photo" || doc.documentType === "delivery_photo"
  ).length;

  return (
    <div className="flex items-center space-x-2">
      <div className="flex items-center space-x-1">
        <FileText className="w-4 h-4 text-blue-500" />
        <span className="text-xs text-gray-600">BOL: {bolCount}</span>
      </div>
      <div className="flex items-center space-x-1">
        <Camera className="w-4 h-4 text-green-500" />
        <span className="text-xs text-gray-600">Photos: {photoCount}</span>
      </div>
    </div>
  );
}

export default function Loads() {
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [editingLoad, setEditingLoad] = useState<LoadWithRelations | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: loads = [], isLoading } = useQuery<LoadWithRelations[]>({
    queryKey: ["/api/loads"],
  });



  const filteredLoads = loads.filter(load => {
    const matchesSearch = !searchTerm || 
      load.loadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.driver?.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = !statusFilter || statusFilter === "all" || load.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      scheduled: { label: "Scheduled", className: "bg-primary bg-opacity-10 text-primary", icon: "⏱️" },
      in_transit: { label: "In Transit", className: "bg-warning bg-opacity-10 text-warning", icon: "🚛" },
      delivered: { label: "Delivered", className: "bg-success bg-opacity-10 text-success", icon: "✅" },
      cancelled: { label: "Cancelled", className: "bg-destructive bg-opacity-10 text-destructive", icon: "❌" },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.scheduled;
    
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${config.className}`}>
        <span className="mr-1">{config.icon}</span>
        {config.label}
      </span>
    );
  };

  const getEmailStatusBadges = () => (
    <div className="space-y-1">
      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-success bg-opacity-10 text-success">
        ✅ Assignment Sent
      </span>
      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-success bg-opacity-10 text-success">
        ✅ Pickup Confirmed
      </span>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6">
        {/* Search and Filter Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            <div className="flex-1 max-w-lg">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search loads by ID, customer, or driver..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-loads"
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              
              <Button
                onClick={() => setShowLoadModal(true)}
                className="bg-primary text-white hover:bg-blue-700"
                data-testid="button-new-load-header"
              >
                <Plus className="mr-2 w-4 h-4" />
                New Load
              </Button>
            </div>
          </div>
        </div>

        {/* Load Management Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">All Loads</h3>
                <p className="text-sm text-gray-500">Manage and track all your loads ({filteredLoads.length} total)</p>
              </div>
              <div className="flex items-center space-x-3">
                <Button variant="outline" size="sm" data-testid="button-export-loads">
                  <Download className="mr-1 w-4 h-4" />
                  Export
                </Button>
                <Button variant="outline" size="sm" data-testid="button-filter-loads">
                  <Filter className="mr-1 w-4 h-4" />
                  Filter
                </Button>
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <Checkbox data-testid="checkbox-select-all" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Load Details</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Route</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Documents</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dates</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLoads.map((load) => (
                  <tr key={load.id} className="hover:bg-gray-50 transition-colors" data-testid={`load-detail-row-${load.id}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Checkbox data-testid={`checkbox-load-${load.id}`} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <span className="text-sm font-medium text-primary">{load.loadNumber}</span>
                        <div className="text-xs text-gray-500">{load.description}</div>
                        <div className="text-xs text-gray-500">{load.equipmentType || 'Any Equipment'}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{load.customer.name}</div>
                        <div className="text-sm text-gray-500">{load.customer.email}</div>
                        <div className="text-xs text-gray-500">{load.customer.phone}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs">
                        <div><strong>From:</strong> <span className="truncate block">{load.pickupAddress}</span></div>
                        <div className="mt-1"><strong>To:</strong> <span className="truncate block">{load.deliveryAddress}</span></div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {load.driver ? (
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center mr-3">
                            👤
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{load.driver.name}</div>
                            <div className="text-sm text-gray-500">{load.driver.phone}</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">Not assigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(load.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <DocumentCount loadId={load.id} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div><strong>Pickup:</strong> {format(new Date(load.pickupDate), "MMM d, yyyy")}</div>
                        <div><strong>Delivery:</strong> {format(new Date(load.deliveryDate), "MMM d, yyyy")}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getEmailStatusBadges()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <Button variant="ghost" size="sm" title="View Details" data-testid={`button-view-detail-${load.id}`}>
                          <Eye className="w-4 h-4 text-primary" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          title="Edit Load"
                          onClick={() => setEditingLoad(load)}
                          data-testid={`button-edit-detail-${load.id}`}
                        >
                          <Edit className="w-4 h-4 text-gray-600" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Send Email" data-testid={`button-email-detail-${load.id}`}>
                          <Mail className="w-4 h-4 text-secondary" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Duplicate" data-testid={`button-duplicate-detail-${load.id}`}>
                          <Copy className="w-4 h-4 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Delete" data-testid={`button-delete-detail-${load.id}`}>
                          <Trash2 className="w-4 h-4 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          <div className="px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing 1 to {filteredLoads.length} of {filteredLoads.length} loads
              </div>
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
                <Button size="sm">1</Button>
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LoadFormModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onSuccess={() => setShowLoadModal(false)}
      />

      {editingLoad && (
        <LoadFormModal
          isOpen={true}
          onClose={() => setEditingLoad(null)}
          onSuccess={() => setEditingLoad(null)}
          load={editingLoad}
          isEdit={true}
        />
      )}
    </>
  );
}
