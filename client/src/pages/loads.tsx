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

  // Fetch real DAT loads to display alongside regular loads
  const { data: datLoads = [] } = useQuery({
    queryKey: ["/api/dat-loads-direct"],
    refetchInterval: 10000, // Refresh every 10 seconds
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
                <p className="text-sm text-gray-500">Manage and track all loads ({filteredLoads.length + datLoads.length} total • {datLoads.length} DAT • {filteredLoads.length} Company)</p>
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
                  <th className="px-3 py-2 text-left">
                    <Checkbox data-testid="checkbox-select-all" />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Origin/Dest</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Load Details</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Miles</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deadhead</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Equipment</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Broker/Customer</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Comments</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {/* Real DAT Loads Section */}
                {datLoads.length > 0 && (
                  <>
                    <tr className="bg-blue-50">
                      <td colSpan={10} className="px-6 py-3">
                        <div className="flex items-center">
                          <Truck className="w-5 h-5 mr-2 text-blue-600" />
                          <span className="text-sm font-semibold text-blue-800">Real DAT LoadLink Freight ({datLoads.length} loads)</span>
                          <Badge className="ml-2 bg-blue-600">Live Data</Badge>
                        </div>
                      </td>
                    </tr>
                    {datLoads.map((datLoad: any) => (
                      <tr key={datLoad.id} className="hover:bg-blue-25 transition-colors border-l-4 border-l-blue-500 text-xs" data-testid={`dat-load-row-${datLoad.id}`}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Checkbox data-testid={`checkbox-dat-${datLoad.id}`} />
                        </td>
                        {/* Origin/Dest */}
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            <div className="flex items-center">
                              <MapPin className="w-3 h-3 text-green-600 mr-1" />
                              <span className="font-medium">{datLoad.origin}</span>
                            </div>
                            <div className="flex items-center mt-1">
                              <MapPin className="w-3 h-3 text-red-600 mr-1" />
                              <span className="font-medium">{datLoad.destination}</span>
                            </div>
                            <div className="text-gray-500 mt-1">{datLoad.age}</div>
                          </div>
                        </td>
                        {/* Load Details */}
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            <div className="font-medium text-blue-600">{datLoad.weight}</div>
                            <div className="text-gray-600">{datLoad.length}</div>
                            <div className="text-gray-500">#{datLoad.id.split('-')[2]}</div>
                          </div>
                        </td>
                        {/* Rate */}
                        <td className="px-3 py-2">
                          <div className="flex items-center">
                            <DollarSign className="w-3 h-3 text-green-600 mr-1" />
                            <span className="font-bold text-green-600 text-sm">
                              ${parseInt(datLoad.rate).toLocaleString()}
                            </span>
                          </div>
                        </td>
                        {/* Miles */}
                        <td className="px-3 py-2">
                          <div className="text-xs font-medium">{datLoad.miles}</div>
                        </td>
                        {/* Deadhead */}
                        <td className="px-3 py-2">
                          <div className="text-xs font-medium text-orange-600">{datLoad.deadhead}</div>
                        </td>
                        {/* Equipment */}
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">
                            {datLoad.equipment}
                          </Badge>
                        </td>
                        {/* Dates */}
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            <div><strong>PU:</strong> {datLoad.pickup}</div>
                            <div><strong>DEL:</strong> {datLoad.delivery}</div>
                          </div>
                        </td>
                        {/* Broker/Customer */}
                        <td className="px-3 py-2">
                          <div className="text-xs">
                            <div className="font-medium text-gray-900">{datLoad.broker}</div>
                            <div className="text-gray-600">{datLoad.phone}</div>
                            <div className="text-gray-500 truncate">{datLoad.email}</div>
                          </div>
                        </td>
                        {/* Comments */}
                        <td className="px-3 py-2 max-w-32">
                          <div className="text-xs text-gray-700 truncate" title={datLoad.comments}>
                            {datLoad.comments}
                          </div>
                        </td>
                        {/* Actions */}
                        <td className="px-3 py-2">
                          <div className="flex items-center space-x-1">
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600" title="Call">
                              <Phone className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-green-600" title="Book">
                              <Truck className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
                
                {/* Regular Company Loads */}
                {filteredLoads.length > 0 && (
                  <tr className="bg-gray-50">
                    <td colSpan={10} className="px-6 py-3">
                      <div className="flex items-center">
                        <Building2 className="w-5 h-5 mr-2 text-gray-600" />
                        <span className="text-sm font-semibold text-gray-800">Company Loads ({filteredLoads.length} loads)</span>
                      </div>
                    </td>
                  </tr>
                )}
                {filteredLoads.map((load) => (
                  <tr key={load.id} className="hover:bg-gray-50 transition-colors text-xs" data-testid={`load-detail-row-${load.id}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Checkbox data-testid={`checkbox-load-${load.id}`} />
                    </td>
                    {/* Origin/Dest */}
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        <div className="flex items-center">
                          <MapPin className="w-3 h-3 text-green-600 mr-1" />
                          <span className="font-medium truncate">{load.pickupAddress}</span>
                        </div>
                        <div className="flex items-center mt-1">
                          <MapPin className="w-3 h-3 text-red-600 mr-1" />
                          <span className="font-medium truncate">{load.deliveryAddress}</span>
                        </div>
                        <div className="text-gray-500 mt-1">Company Load</div>
                      </div>
                    </td>
                    {/* Load Details */}
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        <div className="font-medium text-primary">{load.loadNumber}</div>
                        <div className="text-gray-600">{load.equipmentType || 'Any Equipment'}</div>
                        <div className="text-gray-500 truncate">{load.description}</div>
                      </div>
                    </td>
                    {/* Rate */}
                    <td className="px-3 py-2">
                      <div className="flex items-center">
                        <DollarSign className="w-3 h-3 text-green-600 mr-1" />
                        <span className="font-bold text-green-600 text-sm">
                          ${load.rate ? parseInt(load.rate.toString()).toLocaleString() : 'TBD'}
                        </span>
                      </div>
                    </td>
                    {/* Miles */}
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium">-</div>
                    </td>
                    {/* Deadhead */}
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-orange-600">-</div>
                    </td>
                    {/* Equipment */}
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {load.equipmentType || 'Any'}
                      </Badge>
                    </td>
                    {/* Dates */}
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        <div><strong>PU:</strong> {format(new Date(load.pickupDate), "MMM d")}</div>
                        <div><strong>DEL:</strong> {format(new Date(load.deliveryDate), "MMM d")}</div>
                      </div>
                    </td>
                    {/* Broker/Customer */}
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        <div className="font-medium text-gray-900">{load.customer.name}</div>
                        <div className="text-gray-600">{load.customer.phone}</div>
                        <div className="text-gray-500 truncate">{load.customer.email}</div>
                      </div>
                    </td>
                    {/* Comments */}
                    <td className="px-3 py-2 max-w-32">
                      <div className="text-xs text-gray-700 truncate" title={load.description}>
                        {getStatusBadge(load.status)}
                      </div>
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-primary" title="Edit" onClick={() => setEditingLoad(load)}>
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600" title="Email">
                          <Mail className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" title="Delete">
                          <Trash2 className="w-3 h-3" />
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
