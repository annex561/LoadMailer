import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Edit, User, Building, BarChart3 } from "lucide-react";
import type { Driver, Customer } from "@shared/schema";
import ContactFormModal from "@/components/contact-form-modal";
import { DriverPerformanceModal } from "@/components/DriverPerformanceModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Contacts() {
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [performanceDriver, setPerformanceDriver] = useState<Driver | null>(null);
  const [showPerformanceModal, setShowPerformanceModal] = useState(false);

  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const getDriverStatusBadge = (status: string) => {
    const statusConfig = {
      available: { label: "Available", className: "bg-success bg-opacity-10 text-success" },
      on_route: { label: "On Route", className: "bg-warning bg-opacity-10 text-warning" },
      unavailable: { label: "Unavailable", className: "bg-destructive bg-opacity-10 text-destructive" },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.available;
    
    return (
      <Badge className={`${config.className} border-0`}>
        {config.label}
      </Badge>
    );
  };

  const getCustomerStatusBadge = (status: string) => {
    const statusConfig = {
      active: { label: "Active", className: "bg-success bg-opacity-10 text-success" },
      inactive: { label: "Inactive", className: "bg-destructive bg-opacity-10 text-destructive" },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.active;
    
    return (
      <Badge className={`${config.className} border-0`}>
        {config.label}
      </Badge>
    );
  };

  if (driversLoading || customersLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-64 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6">
        {/* Driver Registration Section */}
        <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  LAMP Logistics Driver Registration
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Quick registration to start receiving load offers
                </p>
              </div>
            </div>
            <Button
              onClick={() => window.open('/simple-registration', '_blank')}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-open-registration"
            >
              <Plus className="h-4 w-4 mr-2" />
              Open Registration
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              Essential driver information only
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              Instant database integration
            </div>
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              Mobile-friendly interface
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Drivers Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Drivers</h3>
                  <p className="text-sm text-gray-500">Manage your driver contacts ({drivers.length} total)</p>
                </div>
                <Button
                  onClick={() => setShowDriverModal(true)}
                  className="bg-primary text-white hover:bg-blue-700"
                  data-testid="button-add-driver"
                >
                  <Plus className="mr-2 w-4 h-4" />
                  Add Driver
                </Button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="space-y-4">
                {drivers.map((driver) => (
                  <div 
                    key={driver.id} 
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                    data-testid={`driver-card-${driver.id}`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-primary bg-opacity-10 rounded-full flex items-center justify-center">
                        <User className="text-primary w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">{driver.name}</h4>
                        <p className="text-sm text-gray-500">{driver.phone}</p>
                        <p className="text-sm text-gray-500">{driver.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getDriverStatusBadge(driver.status)}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setPerformanceDriver(driver);
                          setShowPerformanceModal(true);
                        }}
                        data-testid={`button-performance-${driver.id}`}
                        title="View Performance Dashboard"
                      >
                        <BarChart3 className="w-4 h-4 text-blue-600" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setEditingDriver(driver)}
                        data-testid={`button-edit-driver-${driver.id}`}
                      >
                        <Edit className="w-4 h-4 text-gray-600" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {drivers.length === 0 && (
                  <div className="text-center py-8 text-gray-500" data-testid="empty-drivers">
                    No drivers found. Add your first driver to get started.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Customers Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Customers</h3>
                  <p className="text-sm text-gray-500">Manage your customer contacts ({customers.length} total)</p>
                </div>
                <Button
                  onClick={() => setShowCustomerModal(true)}
                  className="bg-secondary text-white hover:bg-indigo-700"
                  data-testid="button-add-customer"
                >
                  <Plus className="mr-2 w-4 h-4" />
                  Add Customer
                </Button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="space-y-4">
                {customers.map((customer) => (
                  <div 
                    key={customer.id} 
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                    data-testid={`customer-card-${customer.id}`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-secondary bg-opacity-10 rounded-full flex items-center justify-center">
                        <Building className="text-secondary w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">{customer.name}</h4>
                        <p className="text-sm text-gray-500">{customer.contactPerson} - Contact Person</p>
                        <p className="text-sm text-gray-500">{customer.email}</p>
                        <p className="text-sm text-gray-500">{customer.phone}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getCustomerStatusBadge(customer.status)}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setEditingCustomer(customer)}
                        data-testid={`button-edit-customer-${customer.id}`}
                      >
                        <Edit className="w-4 h-4 text-gray-600" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {customers.length === 0 && (
                  <div className="text-center py-8 text-gray-500" data-testid="empty-customers">
                    No customers found. Add your first customer to get started.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ContactFormModal
        isOpen={showDriverModal}
        onClose={() => setShowDriverModal(false)}
        onSuccess={() => setShowDriverModal(false)}
        type="driver"
      />

      <ContactFormModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSuccess={() => setShowCustomerModal(false)}
        type="customer"
      />

      {editingDriver && (
        <ContactFormModal
          isOpen={true}
          onClose={() => setEditingDriver(null)}
          onSuccess={() => setEditingDriver(null)}
          type="driver"
          contact={editingDriver}
          isEdit={true}
        />
      )}

      {editingCustomer && (
        <ContactFormModal
          isOpen={true}
          onClose={() => setEditingCustomer(null)}
          onSuccess={() => setEditingCustomer(null)}
          type="customer"
          contact={editingCustomer}
          isEdit={true}
        />
      )}

      {/* Performance Modal */}
      <DriverPerformanceModal
        driver={performanceDriver}
        isOpen={showPerformanceModal}
        onClose={() => {
          setShowPerformanceModal(false);
          setPerformanceDriver(null);
        }}
      />
    </>
  );
}
