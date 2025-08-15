import { useQuery } from "@tanstack/react-query";
import { Plus, Truck, Route, CheckCircle, Mail, Eye, Edit } from "lucide-react";
import { useState } from "react";
import StatsCard from "@/components/stats-card";
import LoadFormModal from "@/components/load-form-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { LoadWithRelations } from "@shared/schema";

export default function Dashboard() {
  const [showLoadModal, setShowLoadModal] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<{activeLoads: number, inTransit: number, deliveredToday: number, emailAlerts: number}>({
    queryKey: ["/api/dashboard-stats"],
  });

  const { data: loads, isLoading: loadsLoading } = useQuery({
    queryKey: ["/api/loads"],
  });

  const activeLoads = (loads || []).filter((load: LoadWithRelations) => 
    load.status !== "delivered" && load.status !== "cancelled"
  ).slice(0, 5);

  if (statsLoading || loadsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-20 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      scheduled: { label: "Scheduled", variant: "default" as const, icon: "⏱️" },
      in_transit: { label: "In Transit", variant: "secondary" as const, icon: "🚛" },
      delivered: { label: "Delivered", variant: "default" as const, icon: "✅" },
      cancelled: { label: "Cancelled", variant: "destructive" as const, icon: "❌" },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.scheduled;
    
    return (
      <Badge variant={config.variant} className="text-xs">
        <span className="mr-1">{config.icon}</span>
        {config.label}
      </Badge>
    );
  };

  return (
    <>
      <div className="p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Active Loads"
            value={stats?.activeLoads || 0}
            change={{ value: "12%", trend: "up" }}
            icon={Truck}
            iconBgColor="bg-primary bg-opacity-10"
            iconColor="text-primary"
          />
          <StatsCard
            title="In Transit"
            value={stats?.inTransit || 0}
            change={{ value: "8%", trend: "up" }}
            icon={Route}
            iconBgColor="bg-warning bg-opacity-10"
            iconColor="text-warning"
          />
          <StatsCard
            title="Delivered Today"
            value={stats?.deliveredToday || 0}
            change={{ value: "15%", trend: "up" }}
            icon={CheckCircle}
            iconBgColor="bg-success bg-opacity-10"
            iconColor="text-success"
          />
          <StatsCard
            title="Email Alerts"
            value={stats?.emailAlerts || 0}
            change={{ value: "3%", trend: "down" }}
            icon={Mail}
            iconBgColor="bg-secondary bg-opacity-10"
            iconColor="text-secondary"
          />
        </div>

        {/* Quick Actions and Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <Button
                onClick={() => setShowLoadModal(true)}
                className="w-full justify-between bg-primary bg-opacity-5 hover:bg-opacity-10 text-gray-900 border-0"
                variant="outline"
                data-testid="button-create-load"
              >
                <div className="flex items-center">
                  <Plus className="text-primary mr-3 w-4 h-4" />
                  <span className="font-medium">Create New Load</span>
                </div>
                <div className="text-primary">→</div>
              </Button>
              
              <Button
                className="w-full justify-between bg-warning bg-opacity-5 hover:bg-opacity-10 text-gray-900 border-0"
                variant="outline"
                data-testid="button-assign-driver"
              >
                <div className="flex items-center">
                  <Truck className="text-warning mr-3 w-4 h-4" />
                  <span className="font-medium">Assign Driver</span>
                </div>
                <div className="text-warning">→</div>
              </Button>
              
              <Button
                className="w-full justify-between bg-secondary bg-opacity-5 hover:bg-opacity-10 text-gray-900 border-0"
                variant="outline"
                data-testid="button-send-email"
              >
                <div className="flex items-center">
                  <Mail className="text-secondary mr-3 w-4 h-4" />
                  <span className="font-medium">Send Email Update</span>
                </div>
                <div className="text-secondary">→</div>
              </Button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
              <Button variant="ghost" size="sm" className="text-primary hover:text-blue-700">
                View All
              </Button>
            </div>
            
            <div className="space-y-4">
              {activeLoads && activeLoads.slice(0, 4).map((load: LoadWithRelations) => (
                <div key={load.id} className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                  <div className="w-8 h-8 bg-success bg-opacity-10 rounded-full flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="text-success w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      Load {load.loadNumber} - {load.customer.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      Status: {load.status} • {format(new Date(load.updatedAt || load.createdAt || new Date()), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Active Loads Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Active Loads</h3>
                <p className="text-sm text-gray-500">Current loads in progress</p>
              </div>
              <Button 
                onClick={() => setShowLoadModal(true)}
                className="bg-primary text-white hover:bg-blue-700"
                data-testid="button-new-load-table"
              >
                <Plus className="mr-2 w-4 h-4" />
                New Load
              </Button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Load ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Route</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delivery Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {activeLoads.map((load: LoadWithRelations) => (
                  <tr key={load.id} className="hover:bg-gray-50 transition-colors" data-testid={`load-row-${load.id}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-primary">{load.loadNumber}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{load.customer.name}</div>
                        <div className="text-sm text-gray-500">{load.customer.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div className="truncate max-w-32" title={load.pickupAddress}>
                          {load.pickupAddress.split(',')[0]}...
                        </div>
                        <div className="text-gray-500 truncate max-w-32" title={load.deliveryAddress}>
                          → {load.deliveryAddress.split(',')[0]}...
                        </div>
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {format(new Date(load.deliveryDate), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <Button variant="ghost" size="sm" data-testid={`button-view-load-${load.id}`}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" data-testid={`button-edit-load-${load.id}`}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" data-testid={`button-email-load-${load.id}`}>
                          <Mail className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <LoadFormModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onSuccess={() => setShowLoadModal(false)}
      />
    </>
  );
}
