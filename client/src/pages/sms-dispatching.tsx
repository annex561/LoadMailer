import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  MessageSquare, 
  Users, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Send,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Play,
  MapPin,
  DollarSign,
  Calendar,
  Weight,
  Truck,
  Phone
} from "lucide-react";
import { format } from "date-fns";
import type { LoadOffer, LoadWithRelations, Driver } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface LoadOfferWithDetails extends LoadOffer {
  load: LoadWithRelations;
  driver: Driver;
}

interface DriverStats {
  driverId: string;
  driverName: string;
  totalOffers: number;
  accepted: number;
  declined: number;
  timeout: number;
  pending: number;
}

interface ServiceStatus {
  isConfigured: boolean;
  status: string;
  service: string;
  timestamp: string;
}

export default function SMSDispatching() {
  const { toast } = useToast();

  const { data: loadOffers = [], isLoading: loadOffersLoading, refetch: refetchOffers } = useQuery<LoadOfferWithDetails[]>({
    queryKey: ["/api/sms/load-offers"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time updates
  });

  const { data: driverStats = [], isLoading: statsLoading, refetch: refetchStats } = useQuery<DriverStats[]>({
    queryKey: ["/api/sms/driver-stats"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: serviceStatus } = useQuery<ServiceStatus>({
    queryKey: ["/api/sms/health"],
    refetchInterval: 5000, // Check service status every 5 seconds
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return <Badge className="bg-green-100 text-green-800">Accepted</Badge>;
      case 'declined':
        return <Badge className="bg-red-100 text-red-800">Declined</Badge>;
      case 'timeout':
        return <Badge className="bg-gray-100 text-gray-800">Timeout</Badge>;
      case 'sent':
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }
  };

  const getStatsIcon = (value: number, total: number) => {
    if (total === 0) return <Minus className="w-3 h-3 text-gray-400" />;
    
    const percentage = (value / total) * 100;
    if (percentage > 50) return <TrendingUp className="w-3 h-3 text-green-600" />;
    if (percentage > 25) return <Minus className="w-3 h-3 text-yellow-600" />;
    return <TrendingDown className="w-3 h-3 text-red-600" />;
  };

  // Test SMS functionality
  const testSMSMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return apiRequest(`/api/sms/test/${driverId}`, {
        method: 'POST',
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Test SMS Sent",
        description: `SMS sent successfully to ${data.driverName}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "SMS Test Failed",
        description: error.message || "Failed to send test SMS",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" data-testid="page-title">SMS Dispatching</h1>
          <p className="text-gray-600">Manage load offers and SMS communications with drivers</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => refetchOffers()} 
            variant="outline" 
            className="flex items-center gap-2"
            data-testid="refresh-offers-btn"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Offers
          </Button>
          <Button 
            onClick={() => refetchStats()} 
            variant="outline" 
            className="flex items-center gap-2"
            data-testid="refresh-stats-btn"
          >
            <Activity className="w-4 h-4" />
            Refresh Stats
          </Button>
        </div>
      </div>

      {/* Service Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {serviceStatus && (
          <Card data-testid="sms-service-status">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl flex items-center gap-2">
                <Phone className="w-6 h-6 text-blue-600" />
                SMS Service Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">{serviceStatus.service || 'Twilio SMS'}</div>
                  <div className="text-sm text-gray-600">
                    Status: {serviceStatus.status}
                  </div>
                  <div className="text-xs text-gray-500">
                    Last checked: {serviceStatus.timestamp ? format(new Date(serviceStatus.timestamp), "MMM d, h:mm:ss a") : 'Unknown'}
                  </div>
                </div>
                <Badge className={serviceStatus.isConfigured ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                  {serviceStatus.isConfigured ? "Configured" : "Not Configured"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Driver Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {driverStats.map((stats) => (
          <Card key={stats.driverId} data-testid={`driver-stats-${stats.driverId}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                {stats.driverName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total Offers</span>
                  <span className="font-medium">{stats.totalOffers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-600" />
                    Accepted
                  </span>
                  <div className="flex items-center gap-1">
                    {getStatsIcon(stats.accepted, stats.totalOffers)}
                    <span className="font-medium text-green-600">{stats.accepted}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-600" />
                    Declined
                  </span>
                  <span className="font-medium text-red-600">{stats.declined}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-gray-600" />
                    Timeout
                  </span>
                  <span className="font-medium text-gray-600">{stats.timeout}</span>
                </div>
                {stats.pending > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-yellow-600" />
                      Pending
                    </span>
                    <span className="font-medium text-yellow-600">{stats.pending}</span>
                  </div>
                )}
              </div>
              <Separator className="my-3" />
              <Button 
                size="sm" 
                variant="outline" 
                className="w-full"
                onClick={() => testSMSMutation.mutate(stats.driverId)}
                disabled={testSMSMutation.isPending}
                data-testid={`test-sms-${stats.driverId}`}
              >
                <Send className="w-3 h-3 mr-1" />
                Test SMS
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Load Offers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" />
            Recent Load Offers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadOffers.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No load offers yet</h3>
              <p className="text-gray-500 mb-4">
                No loads have been sent to drivers via SMS yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {loadOffers.map((offer) => (
                <div key={offer.id} className="border border-gray-200 rounded-lg p-4" data-testid={`load-offer-${offer.id}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-bold text-primary">{offer.load.loadNumber}</div>
                      {getStatusBadge(offer.status)}
                      <span className="text-sm text-gray-500">to {offer.driver.name}</span>
                    </div>
                    <div className="text-right text-sm text-gray-600">
                      <div>Sent: {format(new Date(offer.sentAt), "MMM d, h:mm a")}</div>
                      {offer.respondedAt && (
                        <div>Responded: {format(new Date(offer.respondedAt), "MMM d, h:mm a")}</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Route Information */}
                    <div className="lg:col-span-2">
                      <div className="flex items-center gap-6">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <MapPin className="w-3 h-3 text-green-600" />
                            <span className="text-xs font-medium text-gray-500">PICKUP</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">{offer.load.pickupAddress}</div>
                          <div className="text-xs text-gray-600">
                            {format(new Date(offer.load.pickupDate), "MMM d")} at {offer.load.pickupTime}
                          </div>
                        </div>
                        
                        <div className="flex-shrink-0 text-gray-300">
                          <div className="w-6 h-px bg-gray-300 relative">
                            <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-1 h-1 border-r border-t border-gray-300 rotate-45"></div>
                          </div>
                        </div>
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <MapPin className="w-3 h-3 text-red-600" />
                            <span className="text-xs font-medium text-gray-500">DELIVERY</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">{offer.load.deliveryAddress}</div>
                          <div className="text-xs text-gray-600">
                            {format(new Date(offer.load.deliveryDate), "MMM d")} by {offer.load.deliveryTime}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Load Details */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <DollarSign className="w-3 h-3 text-green-600" />
                        <span className="text-gray-600">Rate: </span>
                        <span className="font-medium">${offer.load.rate?.toLocaleString() || 'TBD'}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm">
                        <Weight className="w-3 h-3 text-gray-500" />
                        <span className="text-gray-600">Weight: </span>
                        <span className="font-medium">{offer.load.weight ? offer.load.weight.toLocaleString() : 'TBD'} lbs</span>
                      </div>
                      
                      {offer.load.miles && (
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="w-3 h-3 text-blue-600" />
                          <span className="text-gray-600">Miles: </span>
                          <span className="font-medium">{offer.load.miles}</span>
                        </div>
                      )}
                      
                      {offer.load.equipmentType && (
                        <div className="flex items-center gap-2 text-sm">
                          <Truck className="w-3 h-3 text-gray-500" />
                          <span className="text-gray-600">Equipment: </span>
                          <span className="font-medium capitalize">{offer.load.equipmentType.replace('_', ' ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}