import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { 
  MapPin, 
  Clock, 
  DollarSign, 
  Truck, 
  Search, 
  Filter, 
  UserCheck, 
  AlertTriangle, 
  Phone, 
  MessageSquare, 
  CheckCircle, 
  XCircle,
  RotateCcw,
  Users,
  TrendingUp,
  Target
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Load {
  id: string;
  loadNumber: string;
  customerId: string;
  driverId?: string;
  description: string;
  priority: 'standard' | 'high' | 'urgent';
  pickupAddress: string;
  pickupDate: string;
  pickupTime: string;
  deliveryAddress: string;
  deliveryDate: string;
  deliveryTime: string;
  status: 'scheduled' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled' | 'expired';
  equipmentType: string;
  rate?: number;
  miles?: number;
  weight?: number;
  company?: string;
  contactPhone?: string;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
  };
  driver?: {
    id: string;
    name: string;
    phone: string;
  };
}

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'available' | 'on_route' | 'unavailable';
  equipmentType: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
    timestamp: string;
  };
  distanceToPickup?: number;
  estimatedArrival?: string;
}

interface ManualAssignmentData {
  loadId: string;
  driverId: string;
  dispatcherId: string;
  dispatcherName: string;
  actionType: 'manual_assign' | 'override_assign' | 'emergency_assign';
  reasonCode: 'automated_failed' | 'emergency' | 'customer_request' | 'proximity' | 'other';
  reasonDescription?: string;
  distanceToPickup?: number;
}

export default function ManualDispatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State for filters and search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('unassigned');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [equipmentFilter, setEquipmentFilter] = useState<string>('all');
  const [selectedLoads, setSelectedLoads] = useState<string[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [assignmentReason, setAssignmentReason] = useState<string>('');
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showDriverDetails, setShowDriverDetails] = useState(false);
  const [bulkAssignMode, setBulkAssignMode] = useState(false);
  
  // Fetch loads data
  const { data: loads = [], isLoading: loadsLoading, refetch: refetchLoads } = useQuery<Load[]>({
    queryKey: ['/api/loads'],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch drivers data
  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch driver locations for distance calculation
  const { data: driverLocations = [] } = useQuery({
    queryKey: ['/api/driver-locations/active'],
    queryFn: async () => {
      const response = await fetch('/api/driver-locations/active');
      return response.json();
    },
    refetchInterval: 15000, // More frequent updates for real-time tracking
  });

  // Manual assignment mutation
  const assignLoadMutation = useMutation({
    mutationFn: async (data: ManualAssignmentData) => {
      const response = await fetch(`/api/loads/${data.loadId}/manual-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to assign load');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Load Assigned Successfully",
        description: "The load has been manually assigned to the driver.",
      });
      setSelectedLoads([]);
      setSelectedDriver(null);
      setShowAssignDialog(false);
      refetchLoads();
      queryClient.invalidateQueries({ queryKey: ['/api/telegram/load-offers'] });
    },
    onError: (error) => {
      toast({
        title: "Assignment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Bulk assignment mutation
  const bulkAssignMutation = useMutation({
    mutationFn: async (data: { assignments: ManualAssignmentData[] }) => {
      const response = await fetch('/api/loads/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to bulk assign loads');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Bulk Assignment Complete",
        description: `Successfully assigned ${data.successful} of ${data.total} loads.`,
      });
      setSelectedLoads([]);
      setBulkAssignMode(false);
      refetchLoads();
    },
    onError: (error) => {
      toast({
        title: "Bulk Assignment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Geocode address to coordinates (simplified - would use real geocoding service)
  const geocodeAddress = async (address: string) => {
    // Enhanced geocoding function with more Tennessee locations
    const cityCoords = {
      "Nashville, TN": { lat: 36.1627, lng: -86.7816 },
      "Atlanta, GA": { lat: 33.7490, lng: -84.3880 },
      "Memphis, TN": { lat: 35.1495, lng: -90.0490 },
      "Knoxville, TN": { lat: 35.9606, lng: -83.9207 },
      "Charlotte, NC": { lat: 35.2271, lng: -80.8431 },
      "OOLTEWAH, TN": { lat: 35.0629, lng: -85.0516 },
      "OOLTEWAH": { lat: 35.0629, lng: -85.0516 },
      "Birmingham, AL": { lat: 33.5186, lng: -86.8104 },
      "Louisville, KY": { lat: 38.2527, lng: -85.7585 },
      "Chattanooga, TN": { lat: 35.0456, lng: -85.3097 },
      // Add more cities as needed
    };
    
    // Try exact match first
    const exactMatch = cityCoords[address];
    if (exactMatch) return exactMatch;
    
    // Try city, state format
    const cityState = address.split(',')[0]?.trim() + ', ' + address.split(',')[1]?.trim();
    const cityStateMatch = cityCoords[cityState];
    if (cityStateMatch) return cityStateMatch;
    
    // Try just city name
    const cityOnly = address.split(',')[0]?.trim();
    const cityMatch = cityCoords[cityOnly];
    if (cityMatch) return cityMatch;
    
    return { lat: 36.1627, lng: -86.7816 }; // Default to Nashville
  };

  // Enhanced drivers with location data and distance calculation
  const driversWithDistance = useMemo(() => {
    if (!selectedLoads.length || !loads.length || !drivers.length) return drivers;
    
    const selectedLoad = loads.find(load => load.id === selectedLoads[0]);
    if (!selectedLoad) return drivers;

    return drivers.map(driver => {
      const location = driverLocations.find(loc => loc.driverId === driver.id);
      let distanceToPickup = 0;
      let estimatedArrival = '';

      if (location && selectedLoad.pickupAddress) {
        // Use real GPS coordinates to calculate distance
        const pickupCoords = await geocodeAddress(selectedLoad.pickupAddress);
        if (pickupCoords) {
          distanceToPickup = Math.round(calculateDistance(
            location.latitude,
            location.longitude,
            pickupCoords.lat,
            pickupCoords.lng
          ));
          const travelTime = distanceToPickup / 55; // Assume 55 mph average
          estimatedArrival = format(
            new Date(Date.now() + travelTime * 60 * 60 * 1000), 
            'h:mm a'
          );
        }
      }

      return {
        ...driver,
        currentLocation: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.address,
          timestamp: location.timestamp,
        } : undefined,
        distanceToPickup,
        estimatedArrival,
      };
    });
  }, [drivers, driverLocations, selectedLoads, loads]);

  // Filter loads based on search and filters
  const filteredLoads = useMemo(() => {
    return loads.filter(load => {
      // Status filter
      if (statusFilter === 'unassigned' && load.driverId) return false;
      if (statusFilter === 'assigned' && !load.driverId) return false;
      if (statusFilter !== 'all' && statusFilter !== 'unassigned' && statusFilter !== 'assigned' && load.status !== statusFilter) return false;
      
      // Priority filter
      if (priorityFilter !== 'all' && load.priority !== priorityFilter) return false;
      
      // Equipment filter
      if (equipmentFilter !== 'all' && load.equipmentType !== equipmentFilter) return false;
      
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          load.loadNumber.toLowerCase().includes(query) ||
          load.pickupAddress.toLowerCase().includes(query) ||
          load.deliveryAddress.toLowerCase().includes(query) ||
          load.company?.toLowerCase().includes(query) ||
          load.customer?.name.toLowerCase().includes(query)
        );
      }
      
      return true;
    });
  }, [loads, searchQuery, statusFilter, priorityFilter, equipmentFilter]);

  // Available drivers filtered by equipment compatibility
  const availableDrivers = useMemo(() => {
    if (!selectedLoads.length || !loads.length) return driversWithDistance.filter(d => d.status === 'available');
    
    const selectedLoad = loads.find(load => load.id === selectedLoads[0]);
    if (!selectedLoad) return driversWithDistance.filter(d => d.status === 'available');
    
    return driversWithDistance
      .filter(driver => {
        // Check if driver is available
        if (driver.status !== 'available') return false;
        
        // Check equipment compatibility - be more flexible
        const loadEquipment = selectedLoad.equipmentType;
        const driverEquipment = driver.equipmentType;
        
        // Direct match
        if (driverEquipment === loadEquipment) return true;
        
        // Box truck can handle most smaller loads
        if (driverEquipment === 'straight_box_truck' && 
            (loadEquipment === 'box_truck' || loadEquipment === 'dry_van')) return true;
        
        // Dry van is versatile
        if (driverEquipment === 'dry_van') return true;
        
        return false;
      })
      .sort((a, b) => (a.distanceToPickup || 999) - (b.distanceToPickup || 999));
  }, [driversWithDistance, selectedLoads, loads]);

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'assigned': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'in_transit': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'delivered': return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200';
      case 'expired': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'standard': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleLoadSelection = (loadId: string) => {
    if (bulkAssignMode) {
      setSelectedLoads(prev => 
        prev.includes(loadId) 
          ? prev.filter(id => id !== loadId)
          : [...prev, loadId]
      );
    } else {
      setSelectedLoads([loadId]);
    }
  };

  const handleDriverSelection = (driver: Driver) => {
    setSelectedDriver(driver);
    setShowDriverDetails(true);
  };

  const handleAssignment = () => {
    if (!selectedDriver || !selectedLoads.length) return;
    
    const assignmentData: ManualAssignmentData = {
      loadId: selectedLoads[0],
      driverId: selectedDriver.id,
      dispatcherId: 'dispatcher-001', // Would come from auth context
      dispatcherName: 'System Dispatcher',
      actionType: 'manual_assign',
      reasonCode: assignmentReason as any || 'other',
      reasonDescription: `Manual assignment - Distance: ${selectedDriver.distanceToPickup} miles`,
      distanceToPickup: selectedDriver.distanceToPickup,
    };

    assignLoadMutation.mutate(assignmentData);
  };

  const handleBulkAssignment = () => {
    if (!selectedDriver || !selectedLoads.length) return;
    
    const assignments: ManualAssignmentData[] = selectedLoads.map(loadId => ({
      loadId,
      driverId: selectedDriver.id,
      dispatcherId: 'dispatcher-001',
      dispatcherName: 'System Dispatcher',
      actionType: 'manual_assign',
      reasonCode: 'other',
      reasonDescription: 'Bulk manual assignment',
    }));

    bulkAssignMutation.mutate({ assignments });
  };

  if (loadsLoading || driversLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCheck className="w-6 h-6 text-blue-600" />
            Manual Dispatch Override
          </h1>
          <p className="text-gray-500">Manual load assignment when automated systems fail</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={bulkAssignMode ? "default" : "outline"}
            onClick={() => setBulkAssignMode(!bulkAssignMode)}
            className="flex items-center gap-2"
            data-testid="button-bulk-mode"
          >
            <Users className="w-4 h-4" />
            Bulk Mode
          </Button>
          <Button
            onClick={() => refetchLoads()}
            variant="outline"
            className="flex items-center gap-2"
            data-testid="button-refresh-loads"
          >
            <RotateCcw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Unassigned Loads</p>
                <p className="text-2xl font-bold text-red-600">
                  {loads.filter(load => !load.driverId && load.status === 'scheduled').length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Available Drivers</p>
                <p className="text-2xl font-bold text-green-600">
                  {drivers.filter(driver => driver.status === 'available').length}
                </p>
              </div>
              <Truck className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Urgent Loads</p>
                <p className="text-2xl font-bold text-orange-600">
                  {loads.filter(load => load.priority === 'urgent').length}
                </p>
              </div>
              <Target className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Manual Assignments Today</p>
                <p className="text-2xl font-bold text-blue-600">0</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search loads, addresses, companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-loads"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in_transit">In Transit</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger data-testid="select-priority-filter">
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
              <SelectTrigger data-testid="select-equipment-filter">
                <SelectValue placeholder="Filter by equipment" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Equipment</SelectItem>
                <SelectItem value="dry_van">Dry Van</SelectItem>
                <SelectItem value="refrigerated">Refrigerated</SelectItem>
                <SelectItem value="flatbed">Flatbed</SelectItem>
                <SelectItem value="straight_box_truck">Box Truck</SelectItem>
              </SelectContent>
            </Select>
            
            {selectedLoads.length > 0 && (
              <Button
                onClick={() => setShowAssignDialog(true)}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="button-assign-selected"
              >
                Assign {bulkAssignMode ? `${selectedLoads.length} ` : ''}Load{bulkAssignMode && selectedLoads.length > 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Selected loads info */}
      {selectedLoads.length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <span className="font-medium text-blue-900">
                  {selectedLoads.length} load{selectedLoads.length > 1 ? 's' : ''} selected
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedLoads([])}
                data-testid="button-clear-selection"
              >
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loads List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-blue-600" />
            Loads ({filteredLoads.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredLoads.map((load) => (
              <div
                key={load.id}
                className={cn(
                  "border border-gray-200 rounded-lg p-4 cursor-pointer transition-all hover:shadow-md",
                  selectedLoads.includes(load.id) && "border-blue-500 bg-blue-50",
                  !load.driverId && "border-l-4 border-l-red-500"
                )}
                onClick={() => handleLoadSelection(load.id)}
                data-testid={`load-item-${load.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-bold text-primary">{load.loadNumber}</div>
                    <Badge className={cn("border", getStatusBadgeColor(load.status))}>
                      {load.status}
                    </Badge>
                    <Badge className={cn("border", getPriorityBadgeColor(load.priority))}>
                      {load.priority}
                    </Badge>
                    {!load.driverId && (
                      <Badge className="bg-red-100 text-red-800 border-red-200">
                        Unassigned
                      </Badge>
                    )}
                  </div>
                  <div className="text-right text-sm text-gray-600">
                    <div>Created: {format(new Date(load.createdAt), "MMM d, h:mm a")}</div>
                    {load.rate && (
                      <div className="font-medium text-green-600">${load.rate?.toLocaleString()}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Route Information */}
                  <div className="lg:col-span-2">
                    <div className="flex items-center gap-6">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="w-4 h-4 text-blue-600" />
                          <span className="font-medium text-gray-900">Pickup</span>
                        </div>
                        <div className="text-sm text-gray-600">{load.pickupAddress}</div>
                        <div className="text-sm text-gray-500">
                          {format(new Date(load.pickupDate), "MMM d")} at {load.pickupTime}
                        </div>
                      </div>
                      
                      <div className="text-gray-400">→</div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-gray-900">Delivery</span>
                        </div>
                        <div className="text-sm text-gray-600">{load.deliveryAddress}</div>
                        <div className="text-sm text-gray-500">
                          {format(new Date(load.deliveryDate), "MMM d")} at {load.deliveryTime}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Load Details */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Equipment:</span>
                      <span className="font-medium">{load.equipmentType}</span>
                    </div>
                    {load.weight && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Weight:</span>
                        <span className="font-medium">{load.weight?.toLocaleString()} lbs</span>
                      </div>
                    )}
                    {load.miles && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Miles:</span>
                        <span className="font-medium">{load.miles}</span>
                      </div>
                    )}
                    {load.company && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Company:</span>
                        <span className="font-medium">{load.company}</span>
                      </div>
                    )}
                    {load.driver && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Driver:</span>
                        <span className="font-medium text-blue-600">{load.driver.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {filteredLoads.length === 0 && (
              <div className="text-center py-12">
                <Truck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No loads found</h3>
                <p className="text-gray-500">
                  Try adjusting your search criteria or filters.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Assignment Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bulkAssignMode ? `Assign ${selectedLoads.length} Loads` : 'Assign Load'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available Drivers */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Available Drivers ({availableDrivers.length})</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {availableDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className={cn(
                      "border border-gray-200 rounded-lg p-3 cursor-pointer transition-all hover:shadow-md",
                      selectedDriver?.id === driver.id && "border-blue-500 bg-blue-50"
                    )}
                    onClick={() => handleDriverSelection(driver)}
                    data-testid={`driver-item-${driver.id}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-gray-900">{driver.name}</div>
                      <div className="flex items-center gap-2">
                        {driver.distanceToPickup && (
                          <Badge variant="outline" className="text-xs">
                            {driver.distanceToPickup} mi
                          </Badge>
                        )}
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          {driver.status}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="text-sm text-gray-600 space-y-1">
                      <div className="flex items-center justify-between">
                        <span>Equipment:</span>
                        <span className="font-medium">{driver.equipmentType}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Phone:</span>
                        <span className="font-medium">{driver.phone}</span>
                      </div>
                      {driver.estimatedArrival && (
                        <div className="flex items-center justify-between">
                          <span>ETA to Pickup:</span>
                          <span className="font-medium text-blue-600">{driver.estimatedArrival}</span>
                        </div>
                      )}
                      {driver.currentLocation?.address && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-gray-400" />
                          <span className="text-xs">{driver.currentLocation.address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {availableDrivers.length === 0 && (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No available drivers found</p>
                  </div>
                )}
              </div>
            </div>

            {/* Assignment Details */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Assignment Details</h3>
              
              {selectedDriver && (
                <div className="space-y-4">
                  <Card className="border-blue-200 bg-blue-50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <UserCheck className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-blue-900">Selected Driver</span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Name:</span>
                          <span className="font-medium">{selectedDriver.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Distance:</span>
                          <span className="font-medium">{selectedDriver.distanceToPickup} miles</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Equipment:</span>
                          <span className="font-medium">{selectedDriver.equipmentType}</span>
                        </div>
                        {selectedDriver.estimatedArrival && (
                          <div className="flex justify-between">
                            <span>ETA:</span>
                            <span className="font-medium">{selectedDriver.estimatedArrival}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Assignment Reason
                    </label>
                    <Select value={assignmentReason} onValueChange={setAssignmentReason}>
                      <SelectTrigger data-testid="select-assignment-reason">
                        <SelectValue placeholder="Select reason for manual assignment" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-300 shadow-lg">
                        <SelectItem value="automated_failed">Automated Assignment Failed</SelectItem>
                        <SelectItem value="emergency">Emergency Priority</SelectItem>
                        <SelectItem value="customer_request">Customer Request</SelectItem>
                        <SelectItem value="proximity">Driver Proximity</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={bulkAssignMode ? handleBulkAssignment : handleAssignment}
                      disabled={!selectedDriver || assignLoadMutation.isPending || bulkAssignMutation.isPending}
                      className="flex-1"
                      data-testid="button-confirm-assignment"
                    >
                      {(assignLoadMutation.isPending || bulkAssignMutation.isPending) && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      )}
                      {bulkAssignMode ? 'Assign All Selected' : 'Assign Load'}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={() => setShowAssignDialog(false)}
                      data-testid="button-cancel-assignment"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {!selectedDriver && (
                <div className="text-center py-12">
                  <UserCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Select a driver to continue</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}