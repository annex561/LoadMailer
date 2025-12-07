import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { formatDistanceToNow } from 'date-fns';

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

interface Document {
  id: string;
  loadId: string;
  driverId: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  load?: {
    loadNumber: string;
    driver?: {
      name: string;
    };
  };
}

interface DriverLocation {
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  address?: string;
  speed?: number;
  batteryLevel?: number;
  lastUpdate: string;
  isMoving: boolean;
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
  
  // New state for GPS, Documents, SMS features
  const [docFilter, setDocFilter] = useState<string>('all');
  const [selectedSMSDriver, setSelectedSMSDriver] = useState<string | null>(null);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsTemplate, setSmsTemplate] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  
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

  // Fetch documents with auto-refresh
  const { data: documents = [], isLoading: documentsLoading } = useQuery<Document[]>({
    queryKey: ['/api/documents/all'],
    queryFn: async () => {
      const response = await fetch('/api/documents/all');
      if (!response.ok) throw new Error('Failed to fetch documents');
      return response.json();
    },
    refetchInterval: 30000
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

  // Document approval mutation
  const approveDocumentMutation = useMutation({
    mutationFn: async ({ documentId, notes }: { documentId: string; notes?: string }) => {
      const response = await apiRequest('POST', `/api/documents/${documentId}/approve`, {
        approvedBy: 'dispatcher',
        notes: notes || ''
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      toast({ title: 'Document approved successfully' });
    }
  });

  // Document rejection mutation
  const rejectDocumentMutation = useMutation({
    mutationFn: async ({ documentId, reason }: { documentId: string; reason: string }) => {
      const response = await apiRequest('POST', `/api/documents/${documentId}/reject`, {
        rejectedBy: 'dispatcher',
        reason
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents/all'] });
      toast({ title: 'Document rejected - driver notified', description: 'Driver will be notified to resubmit' });
    }
  });

  // SMS sending mutation
  const sendSMSMutation = useMutation({
    mutationFn: async ({ driverId, message }: { driverId: string; message: string }) => {
      const response = await apiRequest('POST', '/api/communication/send-sms', {
        driverId,
        message
      });
      return response.json();
    },
    onSuccess: () => {
      setSmsMessage('');
      setSelectedSMSDriver(null);
      queryClient.invalidateQueries({ queryKey: ['/api/communication/threads'] });
      toast({ title: 'SMS sent successfully' });
    },
    onError: (error: any) => {
      console.error('SMS send error:', error);
      toast({ 
        title: 'Failed to send SMS', 
        description: error.message || 'Please try again',
        variant: 'destructive'
      });
    }
  });

  // Helper functions with vibrant modern styling
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-success/10 text-success border border-success/30';
      case 'pending': return 'bg-primary/10 text-primary border border-primary/30';
      case 'assigned': return 'bg-primary/10 text-primary border border-primary/30';
      case 'in_transit': return 'bg-primary/10 text-primary border border-primary/30';
      case 'delivered': return 'bg-success/10 text-success border border-success/30';
      case 'cancelled': return 'bg-destructive/10 text-destructive border border-destructive/30';
      default: return 'bg-muted/10 text-muted-foreground border border-muted/30';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-destructive/10 text-destructive border border-destructive/30';
      case 'medium': return 'bg-warning/10 text-warning border border-warning/30';
      case 'low': return 'bg-success/10 text-success border border-success/30';
      default: return 'bg-muted/10 text-muted-foreground border border-muted/30';
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
      color: 'text-primary'
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
        color: load.status === 'delivered' ? 'text-success' : 'text-primary'
      }))
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 15);

  // Group loads by status
  const loadsByStatus = {
    available: filteredLoads.filter(l => l.status === 'available'),
    assigned: filteredLoads.filter(l => l.status === 'assigned'),
    in_transit: filteredLoads.filter(l => l.status === 'in_transit'),
    delivered: filteredLoads.filter(l => l.status === 'delivered')
  };

  // Filter documents based on docFilter state
  const filteredDocuments = documents.filter(doc => {
    if (docFilter === 'all') return true;
    return doc.approvalStatus === docFilter;
  });

  const handleAssignDriver = () => {
    if (assigningLoadId && selectedDriverId) {
      assignDriverMutation.mutate({ loadId: assigningLoadId, driverId: selectedDriverId });
    }
  };

  return (
    <div className="space-y-6 p-6 bg-background" data-testid="dispatcher-dashboard">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="heading-dispatcher-dashboard">
            Dispatcher Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Fleet management and coordination</p>
        </div>
      </div>

      {/* Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="gps" data-testid="tab-gps">GPS Tracking</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">
            Documents
            {documents.filter(d => d.approvalStatus === 'pending').length > 0 && (
              <Badge className="ml-2 bg-destructive/10 text-destructive border border-destructive/30">{documents.filter(d => d.approvalStatus === 'pending').length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sms">SMS Dispatch</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="label-active-loads">
                      Active Loads
                    </p>
                    <p className="text-3xl font-semibold text-foreground mt-1" data-testid="count-active-loads">
                      {activeLoads}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Truck className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="label-available-drivers">
                      Available Drivers
                    </p>
                    <p className="text-3xl font-semibold text-foreground mt-1" data-testid="count-available-drivers">
                      {availableDrivers}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center">
                    <Users className="h-6 w-6 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="label-pending-assignments">
                      Pending
                    </p>
                    <p className="text-3xl font-semibold text-foreground mt-1" data-testid="count-pending-assignments">
                      {pendingAssignments}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center">
                    <ClipboardList className="h-6 w-6 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide" data-testid="label-todays-pickups">
                      Today's Pickups
                    </p>
                    <p className="text-3xl font-semibold text-foreground mt-1" data-testid="count-todays-pickups">
                      {todaysPickups}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Calendar className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

      {/* Quick Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Link href="/manual-load-entry">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" data-testid="button-create-load">
            <Plus className="h-4 w-4 mr-2" />
            Create Load
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
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
        {/* Panel A - Active Loads (Left, 30%) */}
        <div className="lg:col-span-3">
          <Card className="h-[700px] border-0 shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Active Loads
                <span className="text-muted-foreground font-normal">({filteredLoads.length})</span>
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
                  <Package className="h-16 w-16 text-muted-foreground mb-4" />
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
                            <Badge className={getStatusColor(status)}>
                              {status.replace('_', ' ')}
                            </Badge>
                            <span className="text-sm text-muted-foreground">({loads.length})</span>
                          </div>
                          <div className="space-y-2">
                            {loads.map((load) => (
                              <Card
                                key={load.id}
                                className={`cursor-pointer transition-all hover:bg-muted/50 hover:border-primary/30 shadow-sm rounded-xl ${
                                  selectedLoad?.id === load.id ? 'ring-2 ring-primary border-primary/50 shadow-lg' : ''
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
                                      <div className="flex items-center gap-1 font-semibold text-success">
                                        <DollarSign className="h-3 w-3" />
                                        ${load.rate?.toLocaleString() || 'N/A'}
                                      </div>
                                      {load.assignedDriver && (
                                        <div className="flex items-center gap-1 text-primary font-medium">
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
          <Card className="h-[700px] border-0 shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-success" />
                Available Drivers
                <span className="text-muted-foreground font-normal">({filteredDrivers.length})</span>
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
                      <Users className="h-16 w-16 text-muted-foreground mb-4" />
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
                            className={`cursor-pointer transition-all hover:bg-muted/50 hover:border-primary/30 shadow-sm rounded-xl ${
                              selectedDriverId === driver.id ? 'ring-2 ring-primary border-primary/50 shadow-lg' : ''
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
                                      driver.status === 'available' ? 'bg-success/10 text-success border border-success/30' :
                                      driver.status === 'on_route' ? 'bg-primary/10 text-primary border border-primary/30' :
                                      'bg-muted/10 text-muted-foreground border border-muted/30'
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
          <Card className="h-[700px] border-0 shadow-sm">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Activity Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[640px] text-center p-6">
                  <Activity className="h-16 w-16 text-muted-foreground mb-4" />
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
                          className="flex gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 hover:border-primary/20 transition-all shadow-sm"
                          data-testid={`activity-item-${item.id}`}
                        >
                          <div className={`flex-shrink-0 p-2 rounded-lg ${
                            item.type === 'message' ? 'bg-primary/10 text-primary' :
                            item.type === 'status_change' ? 'bg-success/10 text-success' :
                            item.type === 'document' ? 'bg-warning/10 text-warning' :
                            'bg-destructive/10 text-destructive'
                          }`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">{item.title}</p>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {item.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(item.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            <Badge className={
                              item.type === 'message' ? 'bg-primary/10 text-primary border border-primary/30' :
                              item.type === 'status_change' ? 'bg-success/10 text-success border border-success/30' :
                              item.type === 'document' ? 'bg-warning/10 text-warning border border-warning/30' :
                              'bg-destructive/10 text-destructive border border-destructive/30'
                            }>
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
            <Card className="shadow-md rounded-xl">
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
                  <div className="h-[500px] bg-muted rounded-xl flex items-center justify-center border border-border">
                    <div className="text-center p-6">
                      <MapIcon className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-2">No active driver locations available</p>
                      <p className="text-sm text-muted-foreground">
                        Driver locations will appear here when GPS tracking is active
                      </p>
                      <Link href="/gps-tracking">
                        <Button className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground" data-testid="button-open-full-map">
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
        </TabsContent>

        {/* GPS Tracking Tab */}
        <TabsContent value="gps" className="space-y-4 mt-6">
          <Card className="shadow-md rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Live GPS Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Map showing all driver locations */}
              <div className="h-[500px] mb-4">
                {driverLocations?.locations && driverLocations.locations.length > 0 ? (
                  <DriverLocationMap />
                ) : (
                  <div className="h-full bg-muted rounded-xl flex items-center justify-center border border-border">
                    <div className="text-center p-6">
                      <MapPin className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-2">No active GPS data available</p>
                      <p className="text-sm text-muted-foreground">
                        Driver locations will appear here when GPS tracking is active
                      </p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Driver location cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {driverLocations?.locations?.map((loc: DriverLocation) => (
                  <Card key={loc.driverId} className="hover:border-primary/30 transition-all shadow-sm rounded-xl" data-testid={`gps-location-card-${loc.driverId}`}>
                    <CardContent className="p-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold" data-testid={`gps-driver-name-${loc.driverId}`}>
                              {loc.driverName}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {loc.address || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                            </p>
                          </div>
                          <Badge className={loc.isMoving ? 'bg-success/10 text-success border border-success/30' : 'bg-muted/10 text-muted-foreground border border-muted/30'}>
                            {loc.isMoving ? 'Moving' : 'Stationary'}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {loc.speed !== undefined && (
                            <div className="flex items-center gap-1 text-primary font-medium">
                              <Navigation className="h-3 w-3" />
                              <span>{Math.round(loc.speed)} mph</span>
                            </div>
                          )}
                          {loc.batteryLevel !== undefined && (
                            <div className="flex items-center gap-1 font-medium">
                              <Activity className={`h-3 w-3 ${loc.batteryLevel > 20 ? 'text-success' : 'text-destructive'}`} />
                              <span className={loc.batteryLevel > 20 ? 'text-success' : 'text-destructive'}>{loc.batteryLevel}%</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="text-xs text-muted-foreground">
                          Last update: {formatDistanceToNow(new Date(loc.lastUpdate))} ago
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )) || (
                  <div className="col-span-2 text-center py-8 text-muted-foreground">
                    No driver location data available
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Document Management</h3>
            <Select value={docFilter} onValueChange={setDocFilter}>
              <SelectTrigger className="w-40" data-testid="select-document-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Documents</SelectItem>
                <SelectItem value="pending">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {documentsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No documents found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {docFilter === 'all' ? 'Documents will appear here once uploaded' : `No ${docFilter} documents`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map(doc => (
                <Card key={doc.id} className="hover:border-primary/30 transition-all shadow-sm rounded-xl" data-testid={`document-card-${doc.id}`}>
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-semibold text-sm" data-testid={`document-type-${doc.id}`}>
                            {doc.documentType}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Load: {doc.load?.loadNumber || 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Driver: {doc.load?.driver?.name || 'Unknown'}
                          </p>
                        </div>
                        <Badge 
                          className={
                            doc.approvalStatus === 'approved' ? 'bg-success/10 text-success border border-success/30' :
                            doc.approvalStatus === 'rejected' ? 'bg-destructive/10 text-destructive border border-destructive/30' :
                            'bg-warning/10 text-warning border border-warning/30'
                          }
                        >
                          {doc.approvalStatus}
                        </Badge>
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()}
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={() => window.open(doc.fileUrl, '_blank')}
                          data-testid={`button-view-document-${doc.id}`}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                        {doc.approvalStatus === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              className="flex-1 bg-success hover:bg-success/90 text-xs text-white"
                              onClick={() => approveDocumentMutation.mutate({ documentId: doc.id })}
                              disabled={approveDocumentMutation.isPending}
                              data-testid={`button-approve-document-${doc.id}`}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="flex-1 text-xs"
                              onClick={() => rejectDocumentMutation.mutate({ 
                                documentId: doc.id, 
                                reason: 'Quality issue' 
                              })}
                              disabled={rejectDocumentMutation.isPending}
                              data-testid={`button-reject-document-${doc.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* SMS Dispatch Tab */}
        <TabsContent value="sms" className="space-y-4 mt-6">
          <Card className="shadow-md rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Send SMS to Driver
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Driver selection */}
              <div>
                <label className="text-sm font-medium mb-2 block">Select Driver</label>
                <Select value={selectedSMSDriver || ''} onValueChange={setSelectedSMSDriver}>
                  <SelectTrigger data-testid="select-sms-driver">
                    <SelectValue placeholder="Select driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map(driver => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name} - {driver.phone || 'No phone'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Quick templates */}
              <div>
                <label className="text-sm font-medium mb-2 block">Quick Templates</label>
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSmsMessage('Are you available for a load?')}
                    data-testid="button-template-availability"
                  >
                    Check Availability
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSmsMessage('Please provide load status update')}
                    data-testid="button-template-status"
                  >
                    Status Update
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setSmsMessage('Load assigned - check your dashboard')}
                    data-testid="button-template-assigned"
                  >
                    Load Assigned
                  </Button>
                </div>
              </div>
              
              {/* Message input */}
              <div>
                <label className="text-sm font-medium mb-2 block">Message</label>
                <Textarea 
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                  placeholder="Type your message..."
                  rows={4}
                  data-testid="input-sms-message"
                />
              </div>
              
              {/* Send button */}
              <Button 
                onClick={() => {
                  if (!selectedSMSDriver) {
                    toast({ title: 'Please select a driver', variant: 'destructive' });
                    return;
                  }
                  if (!smsMessage.trim()) {
                    toast({ title: 'Please enter a message', variant: 'destructive' });
                    return;
                  }
                  sendSMSMutation.mutate({ driverId: selectedSMSDriver, message: smsMessage });
                }}
                disabled={sendSMSMutation.isPending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                data-testid="button-send-sms"
              >
                <Send className="w-4 h-4 mr-2" />
                {sendSMSMutation.isPending ? 'Sending...' : 'Send SMS'}
              </Button>
              
              {/* Recent messages */}
              <div className="mt-6">
                <h4 className="font-semibold mb-2">Recent Messages</h4>
                <ScrollArea className="h-48">
                  {threads.slice(0, 10).length > 0 ? (
                    threads.slice(0, 10).map(thread => (
                      <div key={thread.id} className="p-2 border-b border-border" data-testid={`thread-${thread.id}`}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{thread.driverName || 'Unknown Driver'}</p>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {thread.lastMessage}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                            {thread.lastMessageTimestamp 
                              ? `${formatDistanceToNow(new Date(thread.lastMessageTimestamp))} ago`
                              : 'No messages'}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No recent messages
                    </div>
                  )}
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
              <div className="p-3 bg-muted rounded-xl">
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
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
