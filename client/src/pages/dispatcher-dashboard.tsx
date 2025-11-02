import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Truck, Users, ClipboardList, Calendar, Plus, Send, MessageCircle, 
  MapPin, DollarSign, Phone, Mail, Navigation, Activity, FileText, 
  Package, Clock, User, AlertCircle, CheckCircle, XCircle, Map as MapIcon,
  ChevronDown, ChevronUp, TrendingUp, Eye
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { LoadWithRelations, Driver } from '@shared/schema';
import { RateSettingModal } from '@/components/rate-setting-modal';
import DriverLocationMap from '@/components/driver-location-map';

interface LoadOffer {
  id: string;
  loadId: string;
  driverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'awaiting_confirmation';
  sentAt: Date;
  respondedAt?: Date;
  retryCount: number;
  driver?: Driver;
  dispatcherRate?: number;
}

interface OfferWithDriver extends LoadOffer {
  driver?: Driver;
}

interface DispatcherLoad extends LoadWithRelations {
  offers: OfferWithDriver[];
  assignedDriver?: Driver;
}

interface CommunicationThread {
  id: string;
  loadId: string;
  driverId: string;
  lastMessage: string;
  lastMessageTimestamp: Date;
  driverName?: string;
  loadNumber?: string;
}

interface ActivityFeedItem {
  id: string;
  type: 'message' | 'status_change' | 'document' | 'gps_alert';
  title: string;
  description: string;
  timestamp: Date;
  icon: any;
  color: string;
}

export default function DispatcherDashboard() {
  const [selectedLoad, setSelectedLoad] = useState<DispatcherLoad | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [showMap, setShowMap] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assigningLoadId, setAssigningLoadId] = useState<string | null>(null);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{ load: DispatcherLoad; driverId: string; driverName: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all loads with auto-refresh every 30 seconds
  const { data: loads = [], isLoading: loadsLoading } = useQuery({
    queryKey: ['/api/loads', 'dispatcher'],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      if (!response.ok) throw new Error('Failed to fetch loads');
      const loads: LoadWithRelations[] = await response.json();
      
      // Map to DispatcherLoad format - offers and assignedDriver will be populated from LoadWithRelations
      const dispatcherLoads: DispatcherLoad[] = loads.map(load => ({
        ...load,
        offers: [], // Offers should come from the API if needed
        assignedDriver: load.driver // Use the driver relation from LoadWithRelations
      }));
      
      return dispatcherLoads;
    },
    refetchInterval: 30000
  });

  // Fetch all drivers with auto-refresh every 60 seconds
  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      if (!response.ok) throw new Error('Failed to fetch drivers');
      return response.json();
    },
    refetchInterval: 60000
  });

  // Fetch communication threads for activity feed with auto-refresh every 15 seconds
  const { data: threads = [] } = useQuery<CommunicationThread[]>({
    queryKey: ['/api/communication/threads'],
    queryFn: async () => {
      const response = await fetch('/api/communication/threads');
      if (!response.ok) throw new Error('Failed to fetch threads');
      return response.json();
    },
    refetchInterval: 15000
  });

  // Fetch driver locations for map
  const { data: driverLocations } = useQuery({
    queryKey: ['/api/driver-locations/active'],
    queryFn: async () => {
      const response = await fetch('/api/driver-locations/active');
      if (!response.ok) throw new Error('Failed to fetch driver locations');
      return response.json();
    },
    refetchInterval: 60000
  });

  // Assign driver mutation
  const assignDriverMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      const response = await fetch(`/api/loads/${loadId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId })
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
      toast({ title: 'Driver assigned successfully' });
      setIsAssignDialogOpen(false);
      setAssigningLoadId(null);
      setSelectedDriverId(null);
    },
    onError: () => {
      toast({ title: 'Failed to assign driver', variant: 'destructive' });
    }
  });

  // Update load mutation
  const updateLoadMutation = useMutation({
    mutationFn: async ({ loadId, updates }: { loadId: string; updates: any }) => {
      const response = await fetch(`/api/loads/${loadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
      toast({ title: 'Load updated successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to update load', variant: 'destructive' });
    }
  });

  // Book load mutation
  const bookLoadMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      const response = await apiRequest('POST', `/api/loads/${loadId}/book-for-driver/${driverId}`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
      toast({ 
        title: 'Load Booked Successfully', 
        description: `Load ${data.loadNumber} booked for ${data.driverName}.` 
      });
    },
    onError: () => {
      toast({ title: 'Failed to book load', variant: 'destructive' });
    }
  });

  // Helper functions
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-500';
      case 'pending': return 'bg-yellow-500';
      case 'assigned': return 'bg-blue-500';
      case 'in_transit': return 'bg-purple-500';
      case 'delivered': return 'bg-gray-500';
      case 'cancelled': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'low': return 'text-green-600 bg-green-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  // Calculate stats
  const activeLoads = loads.filter(l => l.status === 'in_transit').length;
  const availableDrivers = drivers.filter(d => d.status === 'available').length;
  const pendingAssignments = loads.filter(l => l.status === 'assigned' && !l.driverId).length;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysPickups = loads.filter(l => {
    const pickupDate = new Date(l.pickupDate);
    pickupDate.setHours(0, 0, 0, 0);
    return pickupDate.getTime() === today.getTime();
  }).length;

  // Filter loads and drivers based on search
  const filteredLoads = loads.filter(load => {
    const matchesSearch = searchQuery === '' || 
      load.loadNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.deliveryAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.assignedDriver?.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  });

  const filteredDrivers = drivers.filter(driver => {
    const matchesFilter = driverFilter === 'all' || driver.status === driverFilter;
    const matchesSearch = searchQuery === '' ||
      driver.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.equipmentType?.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  // Build activity feed from communication threads and load status changes
  const activityFeed: ActivityFeedItem[] = [
    ...threads.slice(0, 10).map(thread => ({
      id: thread.id,
      type: 'message' as const,
      title: `Message from ${thread.driverName || 'Driver'}`,
      description: thread.lastMessage,
      timestamp: new Date(thread.lastMessageTimestamp),
      icon: MessageCircle,
      color: 'text-blue-500'
    })),
    ...loads
      .filter(l => l.status === 'in_transit' || l.status === 'delivered')
      .slice(0, 5)
      .map(load => ({
        id: `status-${load.id}`,
        type: 'status_change' as const,
        title: `Load ${load.loadNumber}`,
        description: `Status changed to ${load.status}`,
        timestamp: new Date(load.updatedAt || load.createdAt),
        icon: load.status === 'delivered' ? CheckCircle : Truck,
        color: load.status === 'delivered' ? 'text-green-500' : 'text-purple-500'
      }))
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 15);

  // Group loads by status
  const loadsByStatus = {
    available: filteredLoads.filter(l => l.status === 'available'),
    assigned: filteredLoads.filter(l => l.status === 'assigned'),
    in_transit: filteredLoads.filter(l => l.status === 'in_transit'),
    delivered: filteredLoads.filter(l => l.status === 'delivered')
  };

  const handleAssignDriver = () => {
    if (assigningLoadId && selectedDriverId) {
      assignDriverMutation.mutate({ loadId: assigningLoadId, driverId: selectedDriverId });
    }
  };

  return (
    <div className="space-y-6 p-6" data-testid="dispatcher-dashboard">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-[#0A101A]" data-testid="heading-dispatcher-dashboard">
            Mission Control
          </h1>
          <p className="text-muted-foreground">Unified dispatcher workspace</p>
        </div>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="label-active-loads">
                  Active Loads
                </p>
                <p className="text-3xl font-bold text-[#0A101A]" data-testid="count-active-loads">
                  {activeLoads}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <Truck className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="label-available-drivers">
                  Available Drivers
                </p>
                <p className="text-3xl font-bold text-[#0A101A]" data-testid="count-available-drivers">
                  {availableDrivers}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                <Users className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="label-pending-assignments">
                  Pending Assignments
                </p>
                <p className="text-3xl font-bold text-[#0A101A]" data-testid="count-pending-assignments">
                  {pendingAssignments}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <ClipboardList className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground" data-testid="label-todays-pickups">
                  Today's Pickups
                </p>
                <p className="text-3xl font-bold text-[#0A101A]" data-testid="count-todays-pickups">
                  {todaysPickups}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Link href="/manual-load-entry">
          <Button className="bg-[#00B5B8] hover:bg-[#009A9D] text-white" data-testid="button-create-load">
            <Plus className="h-4 w-4 mr-2" />
            Create New Load
          </Button>
        </Link>
        <Button 
          onClick={() => {
            if (selectedLoad) {
              setAssigningLoadId(selectedLoad.id);
              setIsAssignDialogOpen(true);
            } else {
              toast({ title: 'Please select a load first', variant: 'destructive' });
            }
          }}
          variant="outline"
          data-testid="button-assign-load"
        >
          <Send className="h-4 w-4 mr-2" />
          Assign Load
        </Button>
        <Link href="/unified-messaging">
          <Button variant="outline" data-testid="button-send-message">
            <MessageCircle className="h-4 w-4 mr-2" />
            Send Message
          </Button>
        </Link>
        <Link href="/gps-tracking">
          <Button variant="outline" data-testid="button-view-drivers">
            <Users className="h-4 w-4 mr-2" />
            View All Drivers
          </Button>
        </Link>
        <Button 
          onClick={() => setShowMap(!showMap)}
          variant="outline"
          data-testid="button-toggle-map"
        >
          <MapIcon className="h-4 w-4 mr-2" />
          {showMap ? 'Hide Map' : 'Show Map'}
        </Button>
      </div>

      {/* Smart Search */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search loads, drivers, equipment, or locations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
            data-testid="input-search-global"
          />
        </div>
      </div>

      {/* Main Three-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        {/* Panel A - Active Loads (Left, 30%) */}
        <div className="lg:col-span-3">
          <Card className="h-[700px]">
            <CardHeader className="bg-[#0A101A] text-white">
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5" />
                Active Loads ({filteredLoads.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadsLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : filteredLoads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[600px] text-center p-6">
                  <Package className="h-16 w-16 text-gray-300 mb-4" />
                  <p className="text-muted-foreground">No loads found</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Try adjusting your search or create a new load
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[640px]">
                  <div className="p-4 space-y-4">
                    {Object.entries(loadsByStatus).map(([status, loads]) => 
                      loads.length > 0 && (
                        <div key={status}>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className={`${getStatusColor(status)} text-white`}>
                              {status.replace('_', ' ')}
                            </Badge>
                            <span className="text-sm text-muted-foreground">({loads.length})</span>
                          </div>
                          <div className="space-y-2">
                            {loads.map((load) => (
                              <Card
                                key={load.id}
                                className={`cursor-pointer transition-all hover:shadow-md ${
                                  selectedLoad?.id === load.id ? 'ring-2 ring-[#00B5B8] shadow-md' : ''
                                }`}
                                onClick={() => setSelectedLoad(load)}
                                data-testid={`card-load-${load.id}`}
                              >
                                <CardContent className="p-3">
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-start">
                                      <div className="flex-1">
                                        <p className="font-semibold text-sm" data-testid={`text-load-number-${load.id}`}>
                                          {load.loadNumber}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          {load.pickupAddress.split(',')[0]} → {load.deliveryAddress.split(',')[0]}
                                        </p>
                                      </div>
                                      <Badge variant="outline" className={getPriorityColor(load.priority)}>
                                        {load.priority}
                                      </Badge>
                                    </div>
                                    
                                    <div className="flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-1 font-medium text-green-600">
                                        <DollarSign className="h-3 w-3" />
                                        {load.rate?.toLocaleString() || 'N/A'}
                                      </div>
                                      {load.assignedDriver && (
                                        <div className="flex items-center gap-1 text-blue-600">
                                          <User className="h-3 w-3" />
                                          <span className="truncate max-w-[100px]">
                                            {load.assignedDriver.name}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs flex-1"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAssigningLoadId(load.id);
                                          setIsAssignDialogOpen(true);
                                        }}
                                        data-testid={`button-assign-driver-${load.id}`}
                                      >
                                        Assign
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs flex-1"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(`/gps-tracking?load=${load.id}`, '_blank');
                                        }}
                                        data-testid={`button-track-gps-${load.id}`}
                                      >
                                        <Navigation className="h-3 w-3 mr-1" />
                                        Track
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Panel B - Available Drivers (Center, 30%) */}
        <div className="lg:col-span-3">
          <Card className="h-[700px]">
            <CardHeader className="bg-[#0A101A] text-white">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Available Drivers ({filteredDrivers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs value={driverFilter} onValueChange={setDriverFilter} className="w-full">
                <TabsList className="w-full grid grid-cols-4 rounded-none border-b">
                  <TabsTrigger value="all" data-testid="tab-drivers-all">All</TabsTrigger>
                  <TabsTrigger value="available" data-testid="tab-drivers-available">Available</TabsTrigger>
                  <TabsTrigger value="on_route" data-testid="tab-drivers-on-route">On Route</TabsTrigger>
                  <TabsTrigger value="unavailable" data-testid="tab-drivers-unavailable">Unavailable</TabsTrigger>
                </TabsList>
                
                <TabsContent value={driverFilter} className="m-0">
                  {driversLoading ? (
                    <div className="p-4 space-y-3">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : filteredDrivers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[570px] text-center p-6">
                      <Users className="h-16 w-16 text-gray-300 mb-4" />
                      <p className="text-muted-foreground">No drivers found</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Try adjusting your filter or search
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[570px]">
                      <div className="p-4 space-y-2">
                        {filteredDrivers.map((driver) => (
                          <Card
                            key={driver.id}
                            className={`cursor-pointer transition-all hover:shadow-md ${
                              selectedDriverId === driver.id ? 'ring-2 ring-[#00B5B8] shadow-md' : ''
                            }`}
                            onClick={() => setSelectedDriverId(driver.id)}
                            data-testid={`card-driver-${driver.id}`}
                          >
                            <CardContent className="p-3">
                              <div className="space-y-2">
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <p className="font-semibold text-sm" data-testid={`text-driver-name-${driver.id}`}>
                                      {driver.name}
                                    </p>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                      <MapPin className="h-3 w-3" />
                                      {driver.city || 'Location unknown'}
                                    </div>
                                  </div>
                                  <Badge 
                                    className={
                                      driver.status === 'available' ? 'bg-green-500 text-white' :
                                      driver.status === 'on_route' ? 'bg-blue-500 text-white' :
                                      'bg-gray-500 text-white'
                                    }
                                  >
                                    {driver.status}
                                  </Badge>
                                </div>
                                
                                <div className="flex items-center gap-2 text-xs">
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <Truck className="h-3 w-3" />
                                    {driver.equipmentType?.replace('_', ' ') || 'N/A'}
                                  </div>
                                </div>

                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs flex-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (selectedLoad) {
                                        assignDriverMutation.mutate({ 
                                          loadId: selectedLoad.id, 
                                          driverId: driver.id 
                                        });
                                      } else {
                                        toast({ title: 'Please select a load first', variant: 'destructive' });
                                      }
                                    }}
                                    data-testid={`button-assign-to-load-${driver.id}`}
                                  >
                                    Assign to Load
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (driver.phone) {
                                        window.open(`tel:${driver.phone}`, '_self');
                                      }
                                    }}
                                    data-testid={`button-call-driver-${driver.id}`}
                                  >
                                    <Phone className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Panel C - Activity Feed (Right, 40%) */}
        <div className="lg:col-span-4">
          <Card className="h-[700px]">
            <CardHeader className="bg-[#0A101A] text-white">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Activity Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[640px] text-center p-6">
                  <Activity className="h-16 w-16 text-gray-300 mb-4" />
                  <p className="text-muted-foreground">No recent activity</p>
                </div>
              ) : (
                <ScrollArea className="h-[640px]">
                  <div className="p-4 space-y-3">
                    {activityFeed.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div 
                          key={item.id} 
                          className="flex gap-3 p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                          data-testid={`activity-item-${item.id}`}
                        >
                          <div className={`flex-shrink-0 ${item.color}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{item.title}</p>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {item.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(item.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            <Badge variant="outline" className="text-xs">
                              {item.type.replace('_', ' ')}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Integrated Map View (Toggle) */}
      {showMap && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MapIcon className="h-5 w-5" />
                Live Map View
              </span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowMap(false)}
                data-testid="button-close-map"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {driverLocations?.locations && driverLocations.locations.length > 0 ? (
              <div className="h-[500px]">
                <DriverLocationMap />
              </div>
            ) : (
              <div className="h-[500px] bg-gray-100 rounded-lg flex items-center justify-center border">
                <div className="text-center p-6">
                  <MapIcon className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                  <p className="text-muted-foreground mb-2">No active driver locations available</p>
                  <p className="text-sm text-muted-foreground">
                    Driver locations will appear here when GPS tracking is active
                  </p>
                  <Link href="/gps-tracking">
                    <Button className="mt-4 bg-[#00B5B8] hover:bg-[#009A9D]" data-testid="button-open-full-map">
                      <Eye className="h-4 w-4 mr-2" />
                      Open GPS Tracking
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Assignment Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent data-testid="dialog-assign-driver" aria-describedby="assign-driver-description">
          <DialogHeader>
            <DialogTitle>Assign Driver to Load</DialogTitle>
          </DialogHeader>
          <p id="assign-driver-description" className="sr-only">
            Select a driver to assign to the selected load
          </p>
          <div className="space-y-4">
            {assigningLoadId && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium">
                  Load: {loads.find(l => l.id === assigningLoadId)?.loadNumber}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {loads.find(l => l.id === assigningLoadId)?.pickupAddress} →{' '}
                  {loads.find(l => l.id === assigningLoadId)?.deliveryAddress}
                </p>
              </div>
            )}
            
            <div>
              <label className="text-sm font-medium mb-2 block">Select Driver</label>
              <Select value={selectedDriverId || ''} onValueChange={setSelectedDriverId}>
                <SelectTrigger data-testid="select-driver-assign">
                  <SelectValue placeholder="Choose a driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.filter(d => d.status === 'available').map(driver => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name} - {driver.city || 'Unknown location'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 justify-end">
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsAssignDialogOpen(false);
                  setAssigningLoadId(null);
                  setSelectedDriverId(null);
                }}
                data-testid="button-cancel-assign"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAssignDriver}
                disabled={!selectedDriverId || assignDriverMutation.isPending}
                className="bg-[#00B5B8] hover:bg-[#009A9D]"
                data-testid="button-confirm-assign"
              >
                {assignDriverMutation.isPending ? 'Assigning...' : 'Assign Driver'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rate Setting Modal */}
      <RateSettingModal
        isOpen={isRateModalOpen}
        onClose={() => {
          setIsRateModalOpen(false);
          setSelectedOffer(null);
        }}
        load={selectedOffer?.load || null}
        driverId={selectedOffer?.driverId || ''}
        driverName={selectedOffer?.driverName || ''}
        originalRate={selectedOffer?.load?.rate || 0}
      />
    </div>
  );
}
