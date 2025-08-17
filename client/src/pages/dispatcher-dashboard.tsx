import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Phone, Mail, MapPin, Clock, DollarSign, Truck, User, FileText, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { LoadWithRelations, Driver, Customer } from '@shared/schema';

interface LoadOffer {
  id: string;
  loadId: string;
  driverId: string;
  status: 'pending' | 'accepted' | 'declined';
  sentAt: Date;
  respondedAt?: Date;
  retryCount: number;
  driver?: Driver;
}

interface DispatcherLoad extends LoadWithRelations {
  offers: LoadOffer[];
  assignedDriver?: Driver;
}

export default function DispatcherDashboard() {
  const [selectedLoad, setSelectedLoad] = useState<DispatcherLoad | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [notes, setNotes] = useState('');
  const [isNotesDialogOpen, setIsNotesDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all loads with detailed information
  const { data: loads = [], isLoading: loadsLoading, refetch: refetchLoads } = useQuery({
    queryKey: ['/api/loads', 'dispatcher'],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      const loads: LoadWithRelations[] = await response.json();
      
      // Enhance loads with offer and driver information
      const enhancedLoads: DispatcherLoad[] = await Promise.all(
        loads.map(async (load) => {
          try {
            // Get load offers
            const offersResponse = await fetch(`/api/loads/${load.id}/offers`);
            const offers: LoadOffer[] = offersResponse.ok ? await offersResponse.json() : [];
            
            // Get assigned driver if load is assigned
            let assignedDriver: Driver | undefined;
            if (load.driverId) {
              const driverResponse = await fetch(`/api/drivers/${load.driverId}`);
              assignedDriver = driverResponse.ok ? await driverResponse.json() : undefined;
            }
            
            return {
              ...load,
              offers,
              assignedDriver
            };
          } catch (error) {
            console.error(`Error enhancing load ${load.id}:`, error);
            return { ...load, offers: [] };
          }
        })
      );
      
      return enhancedLoads;
    },
    refetchInterval: 10000 // Refresh every 10 seconds
  });

  // Fetch all drivers for assignment
  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      return response.json();
    }
  });

  // Update load status mutation
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
    },
    onError: () => {
      toast({ title: 'Failed to assign driver', variant: 'destructive' });
    }
  });

  // Add notes mutation
  const addNotesMutation = useMutation({
    mutationFn: async ({ loadId, notes }: { loadId: string; notes: string }) => {
      const response = await fetch(`/api/loads/${loadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      if (!response.ok) {
        throw new Error('Failed to add notes');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loads'] });
      toast({ title: 'Notes added successfully' });
    },
    onError: () => {
      toast({ title: 'Failed to add notes', variant: 'destructive' });
    }
  });

  // Filter loads based on status and search - ONLY show loads that were sent to drivers
  const filteredLoads = loads.filter(load => {
    // Only include loads that have offers (were sent to drivers)
    const hasOffers = load.offers && load.offers.length > 0;
    if (!hasOffers) return false;
    
    const matchesStatus = statusFilter === 'all' || load.status === statusFilter;
    const matchesSearch = searchQuery === '' || 
      load.loadNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.deliveryAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      load.assignedDriver?.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesStatus && matchesSearch;
  });

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

  const calculateDriverRate = (fullRate: number) => {
    return Math.round(fullRate * 0.9);
  };

  if (loadsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dispatcher-dashboard">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-dispatcher-dashboard">Dispatcher Dashboard</h1>
          <p className="text-muted-foreground">Manage loads, track shipments, and coordinate with drivers</p>
        </div>
        <Button onClick={() => refetchLoads()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters and Search */}
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <Input
            placeholder="Search loads, drivers, or routes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-loads"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 bg-white border border-gray-300" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent className="bg-white border border-gray-300 shadow-lg">
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Loads List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Loads ({filteredLoads.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[600px]">
                <div className="space-y-2 p-4">
                  {filteredLoads.map((load) => (
                    <Card 
                      key={load.id} 
                      className={`cursor-pointer transition-colors ${
                        selectedLoad?.id === load.id ? 'ring-2 ring-primary' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedLoad(load)}
                      data-testid={`card-load-${load.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold" data-testid={`text-load-number-${load.id}`}>
                                {load.loadNumber}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {load.pickupAddress} → {load.deliveryAddress}
                              </p>
                            </div>
                            <Badge className={`${getStatusColor(load.status)} text-white`}>
                              {load.status}
                            </Badge>
                          </div>
                          
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4" />
                              <span className="font-medium">${load.rate?.toLocaleString()}</span>
                            </div>
                            <Badge variant="outline" className={getPriorityColor(load.priority)}>
                              {load.priority}
                            </Badge>
                          </div>

                          {load.assignedDriver && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="h-4 w-4" />
                              <span>{load.assignedDriver.name}</span>
                            </div>
                          )}

                          {load.offers.length > 0 && (
                            <div className="bg-blue-50 border border-blue-200 rounded p-2 mt-2">
                              <div className="text-xs font-medium text-blue-800 mb-1">Driver Offers:</div>
                              {load.offers.map((offer: any, index: number) => {
                                const driver = drivers.find(d => d.id === offer.driverId);
                                const statusColor = offer.status === 'accepted' ? 'text-green-600' : 
                                                  offer.status === 'declined' ? 'text-red-600' : 'text-yellow-600';
                                const statusText = offer.status === 'pending' ? 'Awaiting Response' : 
                                                 offer.status === 'accepted' ? 'Accepted' : 'Declined';
                                return (
                                  <div key={index} className="flex justify-between items-center text-xs">
                                    <span className="font-medium">{driver?.name || 'Unknown Driver'}</span>
                                    <span className={`capitalize ${statusColor}`}>
                                      {statusText}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Load Details */}
        <div className="lg:col-span-2">
          {selectedLoad ? (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle data-testid={`title-selected-load-${selectedLoad.id}`}>
                      {selectedLoad.loadNumber}
                    </CardTitle>
                    <p className="text-muted-foreground">
                      {selectedLoad.pickupAddress} → {selectedLoad.deliveryAddress}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge className={`${getStatusColor(selectedLoad.status)} text-white`}>
                      {selectedLoad.status}
                    </Badge>
                    <Badge variant="outline" className={getPriorityColor(selectedLoad.priority)}>
                      {selectedLoad.priority}
                    </Badge>
                    <div className="text-sm text-muted-foreground">
                      Pickup: {selectedLoad.pickupDate ? (typeof selectedLoad.pickupDate === 'string' ? new Date(selectedLoad.pickupDate).toLocaleDateString() : selectedLoad.pickupDate.toLocaleDateString()) : 'N/A'} 
                      {selectedLoad.pickupTime && ` at ${selectedLoad.pickupTime}`}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="details" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
                    <TabsTrigger value="driver" data-testid="tab-driver">Driver</TabsTrigger>
                    <TabsTrigger value="offers" data-testid="tab-offers">Offers</TabsTrigger>
                    <TabsTrigger value="tracking" data-testid="tab-tracking">Tracking</TabsTrigger>
                  </TabsList>

                  <TabsContent value="details" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-semibold flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            Pickup Information
                          </h4>
                          <p className="text-sm">{selectedLoad.pickupAddress}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedLoad.pickupDate ? new Date(selectedLoad.pickupDate).toLocaleDateString() : 'N/A'} at {selectedLoad.pickupTime || 'N/A'}
                          </p>
                          {selectedLoad.contactPhone && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => window.open(`tel:${selectedLoad.contactPhone}`)}
                              data-testid={`button-call-pickup-${selectedLoad.id}`}
                            >
                              <Phone className="h-4 w-4 mr-1" />
                              {selectedLoad.contactPhone}
                            </Button>
                          )}
                        </div>

                        <div>
                          <h4 className="font-semibold">Load Details</h4>
                          <div className="space-y-1 text-sm">
                            <p>Weight: {selectedLoad.weight.toLocaleString()} lbs</p>
                            <p>Equipment: {selectedLoad.equipmentType}</p>
                            <p>Miles: {selectedLoad.miles || 'N/A'}</p>
                            {selectedLoad.temperatureRequired && (
                              <Badge variant="secondary">Temperature Controlled</Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <h4 className="font-semibold flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            Delivery Information
                          </h4>
                          <p className="text-sm">{selectedLoad.deliveryAddress}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedLoad.deliveryDate ? new Date(selectedLoad.deliveryDate).toLocaleDateString() : 'N/A'} at {selectedLoad.deliveryTime || 'N/A'}
                          </p>
                          {selectedLoad.contactPhone && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => window.open(`tel:${selectedLoad.contactPhone}`)}
                              data-testid={`button-call-delivery-${selectedLoad.id}`}
                            >
                              <Phone className="h-4 w-4 mr-1" />
                              Contact: {selectedLoad.contactPhone}
                            </Button>
                          )}
                        </div>

                        <div>
                          <h4 className="font-semibold flex items-center gap-2">
                            <DollarSign className="h-4 w-4" />
                            Rate Information
                          </h4>
                          <div className="space-y-1 text-sm">
                            <p>Full Rate: <span className="font-semibold">${selectedLoad.rate?.toLocaleString()}</span></p>
                            <p>Driver Rate (90%): <span className="font-semibold">${calculateDriverRate(selectedLoad.rate || 0).toLocaleString()}</span></p>
                            {selectedLoad.miles && (
                              <p>Rate/Mile: ${((selectedLoad.rate || 0) / selectedLoad.miles).toFixed(2)}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {selectedLoad.specialInstructions && (
                      <div>
                        <h4 className="font-semibold">Special Instructions</h4>
                        <p className="text-sm bg-muted p-3 rounded">{selectedLoad.specialInstructions}</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Select 
                        value={selectedLoad.status} 
                        onValueChange={(status) => 
                          updateLoadMutation.mutate({ 
                            loadId: selectedLoad.id, 
                            updates: { status } 
                          })
                        }
                      >
                        <SelectTrigger className="w-48 bg-white border border-gray-300" data-testid="select-update-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-gray-300 shadow-lg">
                          <SelectItem value="available">Available</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="assigned">Assigned</SelectItem>
                          <SelectItem value="in_transit">In Transit</SelectItem>
                          <SelectItem value="delivered">Delivered</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>

                      <Dialog open={isNotesDialogOpen} onOpenChange={setIsNotesDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" data-testid="button-add-notes">
                            <FileText className="h-4 w-4 mr-2" />
                            Add Notes
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-white border border-gray-300">
                          <DialogHeader>
                            <DialogTitle>Add Notes to Load {selectedLoad.loadNumber}</DialogTitle>
                            <p className="text-sm text-muted-foreground">Add dispatcher notes and comments for this load.</p>
                          </DialogHeader>
                          <div className="space-y-4">
                            <Textarea
                              placeholder="Enter dispatch notes..."
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              className="bg-white border border-gray-300"
                              data-testid="textarea-notes"
                            />
                            <Button 
                              onClick={() => {
                                addNotesMutation.mutate({ 
                                  loadId: selectedLoad.id, 
                                  notes 
                                });
                                setNotes('');
                                setIsNotesDialogOpen(false);
                              }}
                              disabled={!notes.trim() || addNotesMutation.isPending}
                              data-testid="button-save-notes"
                            >
                              {addNotesMutation.isPending ? 'Saving...' : 'Save Notes'}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TabsContent>

                  <TabsContent value="driver" className="space-y-4">
                    {selectedLoad.assignedDriver ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-semibold text-lg">{selectedLoad.assignedDriver.name}</h4>
                            <p className="text-muted-foreground">{selectedLoad.assignedDriver.city}</p>
                          </div>
                          <Badge variant="outline">
                            {selectedLoad.assignedDriver.status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <h5 className="font-medium">Contact Information</h5>
                            <div className="space-y-2 mt-2">
                              <Button 
                                variant="outline" 
                                className="w-full justify-start"
                                onClick={() => window.open(`tel:${selectedLoad.assignedDriver?.phone}`)}
                                data-testid={`button-call-driver-${selectedLoad.assignedDriver.id}`}
                              >
                                <Phone className="h-4 w-4 mr-2" />
                                {selectedLoad.assignedDriver.phone}
                              </Button>
                              {selectedLoad.assignedDriver.email && (
                                <Button 
                                  variant="outline" 
                                  className="w-full justify-start"
                                  onClick={() => window.open(`mailto:${selectedLoad.assignedDriver?.email}`)}
                                  data-testid={`button-email-driver-${selectedLoad.assignedDriver.id}`}
                                >
                                  <Mail className="h-4 w-4 mr-2" />
                                  {selectedLoad.assignedDriver.email}
                                </Button>
                              )}
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium">Equipment Information</h5>
                            <div className="space-y-1 mt-2 text-sm">
                              <p>Type: {selectedLoad.assignedDriver.equipmentType}</p>
                              <p>Capacity: {selectedLoad.assignedDriver.weightCapacity?.toLocaleString()} lbs</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-muted-foreground">No driver assigned to this load</p>
                        <div>
                          <Label htmlFor="driver-select">Assign Driver</Label>
                          <Select 
                            onValueChange={(driverId) => 
                              assignDriverMutation.mutate({ 
                                loadId: selectedLoad.id, 
                                driverId 
                              })
                            }
                          >
                            <SelectTrigger className="bg-white border border-gray-300" data-testid="select-assign-driver">
                              <SelectValue placeholder="Select a driver" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border border-gray-300 shadow-lg">
                              {drivers
                                .filter((driver: any) => driver.status === 'available')
                                .map((driver: any) => (
                                <SelectItem key={driver.id} value={driver.id}>
                                  {driver.name} - {driver.city} ({driver.equipmentType})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="offers" className="space-y-4">
                    {selectedLoad.offers.length > 0 ? (
                      <div className="space-y-4">
                        {selectedLoad.offers.map((offer) => (
                          <Card key={offer.id}>
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium">{offer.driver?.name || 'Unknown Driver'}</p>
                                  <p className="text-sm text-muted-foreground">
                                    Sent: {new Date(offer.sentAt).toLocaleString()}
                                  </p>
                                  {offer.respondedAt && (
                                    <p className="text-sm text-muted-foreground">
                                      Responded: {new Date(offer.respondedAt).toLocaleString()}
                                    </p>
                                  )}
                                  {offer.retryCount > 0 && (
                                    <p className="text-sm text-yellow-600">
                                      Retries: {offer.retryCount}
                                    </p>
                                  )}
                                </div>
                                <Badge 
                                  variant={
                                    offer.status === 'accepted' ? 'default' :
                                    offer.status === 'declined' ? 'destructive' : 'secondary'
                                  }
                                >
                                  {offer.status}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No offers sent for this load</p>
                    )}
                  </TabsContent>

                  <TabsContent value="tracking" className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          Timeline
                        </h4>
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Load created: {selectedLoad.createdAt?.toLocaleString()}</span>
                          </div>
                          {selectedLoad.assignedDriver && (
                            <div className="flex items-center gap-2 text-sm">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span>Driver assigned: {selectedLoad.assignedDriver.name}</span>
                            </div>
                          )}
                          {selectedLoad.status === 'in_transit' && (
                            <div className="flex items-center gap-2 text-sm">
                              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                              <span>Load in transit</span>
                            </div>
                          )}
                          {selectedLoad.status === 'delivered' && (
                            <div className="flex items-center gap-2 text-sm">
                              <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                              <span>Load delivered</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <Separator />

                      <div>
                        <h4 className="font-semibold">Quick Actions</h4>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(selectedLoad.pickupAddress)}`)}
                            data-testid="button-view-pickup-map"
                          >
                            <MapPin className="h-4 w-4 mr-1" />
                            View Pickup
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(selectedLoad.deliveryAddress)}`)}
                            data-testid="button-view-delivery-map"
                          >
                            <MapPin className="h-4 w-4 mr-1" />
                            View Delivery
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => window.open(`https://maps.google.com/dir/${encodeURIComponent(selectedLoad.pickupAddress)}/${encodeURIComponent(selectedLoad.deliveryAddress)}`)}
                            data-testid="button-view-route"
                          >
                            <Truck className="h-4 w-4 mr-1" />
                            View Route
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              const loadInfo = `Load: ${selectedLoad.loadNumber}\nRoute: ${selectedLoad.pickupAddress} → ${selectedLoad.deliveryAddress}\nRate: $${selectedLoad.rate?.toLocaleString()}\nPickup: ${selectedLoad.pickupDate.toLocaleDateString()} at ${selectedLoad.pickupTime}`;
                              navigator.clipboard.writeText(loadInfo);
                              toast({ title: 'Load info copied to clipboard' });
                            }}
                            data-testid="button-copy-load-info"
                          >
                            <FileText className="h-4 w-4 mr-1" />
                            Copy Info
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a load to view details</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}