import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Truck, 
  Settings, 
  User,
  Package,
  Ruler,
  Weight,
  Save,
  RotateCcw
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  equipmentType: string;
  weightCapacity: number;
  maxLength: number;
  usedLength: number;
  status: string;
  city: string;
  telegramId: string;
}

interface VehicleSettings {
  id: string;
  type: string;
  totalLength: number;
  usedLength: number;
  weightCapacity: number;
  availableSpace: number;
}

export default function DispatcherVehicleDashboard() {
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch drivers
  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
    queryFn: async (): Promise<Driver[]> => {
      const response = await fetch('/api/drivers');
      return response.json();
    }
  });

  // Update driver vehicle settings
  const updateVehicleMutation = useMutation({
    mutationFn: async ({ driverId, settings }: { driverId: string; settings: Partial<Driver> }) => {
      return apiRequest(`/api/drivers/${driverId}`, 'PUT', settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers'] });
      toast({
        title: "Settings Updated",
        description: "Driver vehicle settings have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update vehicle settings. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleVehicleUpdate = async (driverId: string, formData: FormData) => {
    const settings = {
      equipmentType: formData.get('type') as string,
      maxLength: parseFloat(formData.get('totalLength') as string) || 0,
      usedLength: parseFloat(formData.get('usedLength') as string) || 0,
      weightCapacity: parseFloat(formData.get('weightCapacity') as string) || 0,
    };

    updateVehicleMutation.mutate({ driverId, settings });
  };

  const resetVehicleSpace = (driverId: string) => {
    updateVehicleMutation.mutate({ 
      driverId, 
      settings: { usedLength: 0 } 
    });
  };

  const equipmentTypes = [
    'Box Truck',
    'Dry Van',
    'Flatbed',
    'Refrigerated',
    'Step Deck',
    'Lowboy',
    'Tanker'
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800';
      case 'on_route': return 'bg-blue-100 text-blue-800';
      case 'unavailable': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const calculateSpaceUtilization = (driver: Driver) => {
    if (!driver.maxLength || driver.maxLength === 0) return 0;
    return Math.round((driver.usedLength / driver.maxLength) * 100);
  };

  const getAvailableSpace = (driver: Driver) => {
    return Math.max(0, (driver.maxLength || 0) - (driver.usedLength || 0));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Truck className="w-8 h-8 mr-3 text-blue-600" />
              Dispatcher Vehicle Dashboard
            </h1>
            <p className="text-gray-600 mt-1">
              Manage driver vehicle settings and space allocation for smart load matching
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Total Drivers</p>
            <p className="text-2xl font-bold text-blue-600">{drivers.length}</p>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Driver List */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <User className="w-5 h-5 mr-2" />
                  Driver Fleet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {drivers.map((driver) => (
                    <div 
                      key={driver.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-all ${
                        selectedDriver === driver.id 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedDriver(driver.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{driver.name}</h3>
                        <Badge variant="outline" className={getStatusColor(driver.status)}>
                          {driver.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p className="flex items-center">
                          <Package className="w-4 h-4 mr-1" />
                          {driver.equipmentType || 'Not Set'}
                        </p>
                        <p className="flex items-center">
                          <Ruler className="w-4 h-4 mr-1" />
                          {driver.maxLength || 0}ft / {driver.usedLength || 0}ft used
                        </p>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full" 
                            style={{ 
                              width: `${calculateSpaceUtilization(driver)}%` 
                            }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500">
                          {calculateSpaceUtilization(driver)}% space utilized
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Vehicle Settings Form */}
          <div className="lg:col-span-2">
            {selectedDriver ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Settings className="w-5 h-5 mr-2" />
                    Vehicle Settings - {drivers.find(d => d.id === selectedDriver)?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {drivers.filter(d => d.id === selectedDriver).map((driver) => (
                    <form
                      key={driver.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const formData = new FormData(e.currentTarget);
                        handleVehicleUpdate(driver.id, formData);
                      }}
                      className="space-y-6"
                    >
                      {/* Driver Info */}
                      <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                          <Label className="text-sm font-medium text-gray-700">Driver Name</Label>
                          <p className="font-semibold">{driver.name}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-700">Phone</Label>
                          <p className="font-semibold">{driver.phone}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-700">Location</Label>
                          <p className="font-semibold">{driver.city || 'Not specified'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-700">Status</Label>
                          <Badge variant="outline" className={getStatusColor(driver.status)}>
                            {driver.status}
                          </Badge>
                        </div>
                      </div>

                      <Separator />

                      {/* Vehicle Configuration */}
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                            <Package className="w-5 h-5 mr-2" />
                            Equipment Type
                          </h3>
                          <div>
                            <Label htmlFor="type">Vehicle Type</Label>
                            <Select name="type" defaultValue={driver.equipmentType || ''}>
                              <SelectTrigger className="bg-white border border-gray-300">
                                <SelectValue placeholder="Select equipment type" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                                {equipmentTypes.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor="weightCapacity">Weight Capacity (lbs)</Label>
                            <Input
                              id="weightCapacity"
                              name="weightCapacity"
                              type="number"
                              defaultValue={driver.weightCapacity || 26000}
                              className="bg-white border border-gray-300"
                            />
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                            <Ruler className="w-5 h-5 mr-2" />
                            Space Management
                          </h3>
                          <div>
                            <Label htmlFor="totalLength">Total Length (ft)</Label>
                            <Input
                              id="totalLength"
                              name="totalLength"
                              type="number"
                              step="0.1"
                              defaultValue={driver.maxLength || 26}
                              className="bg-white border border-gray-300"
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="usedLength">Currently Used Length (ft)</Label>
                            <Input
                              id="usedLength"
                              name="usedLength"
                              type="number"
                              step="0.1"
                              defaultValue={driver.usedLength || 0}
                              className="bg-white border border-gray-300"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Space Utilization Display */}
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-semibold text-blue-900 mb-3">Current Space Utilization</h4>
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-2xl font-bold text-blue-600">
                              {getAvailableSpace(driver).toFixed(1)}ft
                            </p>
                            <p className="text-sm text-gray-600">Available Space</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-purple-600">
                              {calculateSpaceUtilization(driver)}%
                            </p>
                            <p className="text-sm text-gray-600">Space Used</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-green-600">
                              {driver.maxLength || 0}ft
                            </p>
                            <p className="text-sm text-gray-600">Total Length</p>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="w-full bg-gray-200 rounded-full h-4">
                            <div 
                              className="bg-gradient-to-r from-blue-500 to-purple-500 h-4 rounded-full transition-all duration-300" 
                              style={{ 
                                width: `${calculateSpaceUtilization(driver)}%` 
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex justify-between">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => resetVehicleSpace(driver.id)}
                          className="flex items-center"
                          disabled={updateVehicleMutation.isPending}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Reset Space
                        </Button>
                        
                        <Button
                          type="submit"
                          className="flex items-center"
                          disabled={updateVehicleMutation.isPending}
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {updateVehicleMutation.isPending ? 'Updating...' : 'Update Settings'}
                        </Button>
                      </div>
                    </form>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <Card className="h-96">
                <CardContent className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500">
                    <Truck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium">Select a driver to manage vehicle settings</p>
                    <p className="text-sm">Choose a driver from the list to configure their equipment and space allocation</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* AI Load Stacking Information */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900">
              Smart Load Stacking - AI Ready
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div className="p-3 bg-green-50 rounded-lg">
                <h4 className="font-medium text-green-800 mb-2">Partial Load Matching</h4>
                <p>AI logic ready for stacking multiple small loads based on available truck space and route optimization.</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-800 mb-2">Space Optimization</h4>
                <p>Intelligent space utilization ensures maximum efficiency while maintaining safe load distribution.</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <h4 className="font-medium text-purple-800 mb-2">Real-Time Updates</h4>
                <p>Vehicle space availability updates in real-time as loads are assigned and completed by drivers.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}