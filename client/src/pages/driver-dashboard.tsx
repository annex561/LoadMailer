import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  MapPin, Clock, DollarSign, Package, Navigation, CheckCircle, 
  AlertCircle, Phone, MessageCircle, Truck, Star, Settings 
} from 'lucide-react';
import { Link } from 'wouter';
import type { LoadWithRelations, Driver } from '@shared/schema';

interface LoadOffer {
  id: string;
  loadId: string;
  driverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'timeout';
  sentAt: string;
  timeoutAt: string;
  respondedAt?: string;
  load?: LoadWithRelations;
}

interface DriverStats {
  totalLoads: number;
  completedLoads: number;
  totalEarnings: number;
  averageRating: number;
  onTimePercentage: number;
}

export default function DriverDashboard() {
  const [driverId] = useState('e8213f28-19bc-45fd-8293-8c5c8b439ea7'); // Mock driver ID for demo
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch driver profile
  const { data: driver } = useQuery({
    queryKey: ['/api/drivers', driverId],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}`);
      if (!response.ok) throw new Error('Failed to fetch driver profile');
      return response.json();
    }
  });

  // Fetch pending load offers
  const { data: loadOffers = [], refetch: refetchOffers } = useQuery({
    queryKey: ['/api/drivers', driverId, 'offers'],
    queryFn: async () => {
      const response = await fetch(`/api/drivers/${driverId}/offers`);
      if (!response.ok) throw new Error('Failed to fetch load offers');
      const offers = await response.json();
      
      // Enhance offers with load details
      const enhancedOffers = await Promise.all(
        offers.map(async (offer: LoadOffer) => {
          try {
            const loadResponse = await fetch(`/api/loads/${offer.loadId}`);
            const load = await loadResponse.json();
            return { ...offer, load };
          } catch (error) {
            console.error(`Failed to fetch load ${offer.loadId}:`, error);
            return offer;
          }
        })
      );
      
      return enhancedOffers.filter((offer: LoadOffer) => offer.status === 'pending');
    },
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  // Fetch current assigned load
  const { data: currentLoad } = useQuery({
    queryKey: ['/api/drivers', driverId, 'current-load'],
    queryFn: async () => {
      const response = await fetch(`/api/loads?driverId=${driverId}&status=assigned,in_transit`);
      if (!response.ok) throw new Error('Failed to fetch current load');
      const loads = await response.json();
      return loads[0] || null;
    },
    refetchInterval: 10000 // Refresh every 10 seconds
  });

  // Fetch driver statistics
  const { data: stats } = useQuery({
    queryKey: ['/api/drivers', driverId, 'stats'],
    queryFn: async (): Promise<DriverStats> => {
      // Mock stats for demo - in real app this would come from API
      return {
        totalLoads: 47,
        completedLoads: 44,
        totalEarnings: 89750,
        averageRating: 4.8,
        onTimePercentage: 96
      };
    }
  });

  // Respond to load offer
  const respondToOfferMutation = useMutation({
    mutationFn: async ({ offerId, response }: { offerId: string; response: 'accepted' | 'declined' }) => {
      const res = await fetch(`/api/load-offers/${offerId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response })
      });
      if (!res.ok) throw new Error('Failed to respond to offer');
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'offers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'current-load'] });
      
      toast({
        title: variables.response === 'accepted' ? 'Load Accepted!' : 'Load Declined',
        description: variables.response === 'accepted' 
          ? 'You have been assigned this load. Check your current load section.'
          : 'Load offer declined. Keep an eye out for more opportunities.',
        variant: variables.response === 'accepted' ? 'default' : 'destructive'
      });
    }
  });

  // Update load status
  const updateLoadStatusMutation = useMutation({
    mutationFn: async ({ loadId, status }: { loadId: string; status: string }) => {
      const res = await fetch(`/api/loads/${loadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed to update load status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drivers', driverId, 'current-load'] });
      toast({
        title: 'Load Status Updated',
        description: 'Load status has been updated successfully.'
      });
    }
  });

  const handleStartGPSTracking = async () => {
    try {
      toast({
        title: 'Initializing GPS Tracking',
        description: 'Generating secure authentication token...'
      });

      const response = await fetch(`/api/drivers/${driverId}/generate-tracking-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to generate tracking token');
      }

      const { token } = await response.json();
      
      window.location.href = `/driver-tracker?driver=${driverId}&token=${token}`;
    } catch (error) {
      console.error('Error starting GPS tracking:', error);
      toast({
        title: 'Error',
        description: 'Failed to start GPS tracking. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned': return 'bg-blue-500';
      case 'in_transit': return 'bg-orange-500';
      case 'delivered': return 'bg-green-500';
      case 'available': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getDriverRate = (fullRate: number) => {
    return fullRate * 0.9; // Drivers see 90% of load board rate
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Driver Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {driver?.name || 'Driver'}</p>
        </div>
        <div className="flex items-center gap-4">
          <Button 
            variant="default" 
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600" 
            data-testid="button-gps-tracking"
            onClick={handleStartGPSTracking}
          >
            <MapPin className="h-4 w-4" />
            Start GPS Tracking
          </Button>
          <Link href="/driver-profile">
            <Button variant="outline" className="flex items-center gap-2" data-testid="button-profile">
              <Settings className="h-4 w-4" />
              Profile Settings
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Badge className={`${getStatusColor(driver?.status)} text-white`}>
              {driver?.status || 'Unknown'}
            </Badge>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Equipment</div>
              <div className="font-medium">{driver?.equipmentType?.replace('_', ' ') || 'Not Set'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Loads</p>
                <p className="text-2xl font-bold">{stats?.totalLoads || 0}</p>
              </div>
              <Package className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Earnings</p>
                <p className="text-2xl font-bold">{formatCurrency(stats?.totalEarnings || 0)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Average Rating</p>
                <p className="text-2xl font-bold flex items-center gap-1">
                  {stats?.averageRating || 0}
                  <Star className="h-5 w-5 text-yellow-500 fill-current" />
                </p>
              </div>
              <Star className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">On-Time %</p>
                <p className="text-2xl font-bold">{stats?.onTimePercentage || 0}%</p>
              </div>
              <Clock className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Load */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Current Load
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentLoad ? (
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{currentLoad.loadNumber}</h3>
                    <p className="text-muted-foreground">{currentLoad.description}</p>
                  </div>
                  <Badge className={`${getStatusColor(currentLoad.status)} text-white`}>
                    {currentLoad.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Pickup</div>
                    <div className="font-medium">{currentLoad.pickupAddress}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(currentLoad.pickupDate)} at {currentLoad.pickupTime}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Delivery</div>
                    <div className="font-medium">{currentLoad.deliveryAddress}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(currentLoad.deliveryDate)} at {currentLoad.deliveryTime}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="text-sm">
                    <div className="text-muted-foreground">Your Rate</div>
                    <div className="font-bold text-lg text-green-600">
                      {formatCurrency(getDriverRate(currentLoad.rate || 0))}
                    </div>
                  </div>
                  <div className="text-sm text-right">
                    <div className="text-muted-foreground">Distance</div>
                    <div className="font-medium">{currentLoad.miles || 0} miles</div>
                  </div>
                </div>

                {currentLoad.status === 'assigned' && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => updateLoadStatusMutation.mutate({ 
                        loadId: currentLoad.id, 
                        status: 'in_transit' 
                      })}
                      className="flex-1"
                      data-testid="button-start-delivery"
                    >
                      <Navigation className="h-4 w-4 mr-2" />
                      Start Delivery
                    </Button>
                  </div>
                )}

                {currentLoad.status === 'in_transit' && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => updateLoadStatusMutation.mutate({ 
                        loadId: currentLoad.id, 
                        status: 'delivered' 
                      })}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                      data-testid="button-mark-delivered"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Mark as Delivered
                    </Button>
                  </div>
                )}

                {currentLoad.contactPhone && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => window.open(`tel:${currentLoad.contactPhone}`, '_self')}
                      className="flex-1"
                      data-testid="button-call-customer"
                    >
                      <Phone className="h-4 w-4 mr-2" />
                      Call Customer
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => window.open(`sms:${currentLoad.contactPhone}`, '_self')}
                      className="flex-1"
                      data-testid="button-text-customer"
                    >
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Text Customer
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No active load assigned</p>
                <p className="text-sm">Check your load offers below</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Load Offers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Load Offers ({loadOffers.length})
            </CardTitle>
            <CardDescription>
              New load opportunities matching your equipment and location
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {loadOffers.length > 0 ? (
                loadOffers.map((offer: LoadOffer) => (
                  <div key={offer.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold">{offer.load?.loadNumber}</h4>
                        <p className="text-sm text-muted-foreground">{offer.load?.description}</p>
                      </div>
                      <Badge variant="outline">
                        {Math.ceil((new Date(offer.timeoutAt).getTime() - Date.now()) / 60000)}m left
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground">From</div>
                        <div className="font-medium">{offer.load?.pickupAddress}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">To</div>
                        <div className="font-medium">{offer.load?.deliveryAddress}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-blue-50 rounded">
                      <div className="text-sm">
                        <div className="text-muted-foreground">Your Rate</div>
                        <div className="font-bold text-blue-600">
                          {formatCurrency(getDriverRate(offer.load?.rate || 0))}
                        </div>
                      </div>
                      <div className="text-sm text-right">
                        <div className="text-muted-foreground">Distance</div>
                        <div className="font-medium">{offer.load?.miles || 0} miles</div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => respondToOfferMutation.mutate({ 
                          offerId: offer.id, 
                          response: 'accepted' 
                        })}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        disabled={respondToOfferMutation.isPending}
                        data-testid={`button-accept-offer-${offer.id}`}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Accept
                      </Button>
                      <Button
                        onClick={() => respondToOfferMutation.mutate({ 
                          offerId: offer.id, 
                          response: 'declined' 
                        })}
                        variant="outline"
                        className="flex-1"
                        disabled={respondToOfferMutation.isPending}
                        data-testid={`button-decline-offer-${offer.id}`}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No pending load offers</p>
                  <p className="text-sm">New offers will appear here automatically</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}