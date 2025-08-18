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
  Truck
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
  isRunning: boolean;
  config?: {
    botUsername?: string;
    responseTimeoutMinutes?: number;
  };
}

interface TestLoadResponse {
  success: boolean;
  message: string;
}

export default function TelegramDispatching() {
  const { toast } = useToast();

  const { data: loadOffers = [], isLoading: loadOffersLoading, refetch: refetchOffers } = useQuery<LoadOfferWithDetails[]>({
    queryKey: ["/api/telegram/load-offers"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time updates
  });

  const { data: driverStats = [], isLoading: statsLoading, refetch: refetchStats } = useQuery<DriverStats[]>({
    queryKey: ["/api/telegram/driver-stats"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: serviceStatus } = useQuery<ServiceStatus>({
    queryKey: ["/api/telegram/service-status"],
    refetchInterval: 5000, // Check service status every 5 seconds
  });

  const testLoadMutation = useMutation({
    mutationFn: async (): Promise<TestLoadResponse> => {
      const response = await fetch("/api/telegram/test-load");
      if (!response.ok) throw new Error('Failed to send test load');
      return response.json();
    },
    onSuccess: (data: TestLoadResponse) => {
      toast({
        title: "Test Load",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      refetchOffers();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send test load",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Clock },
      accepted: { label: "Accepted", className: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle },
      declined: { label: "Declined", className: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
      timeout: { label: "Timeout", className: "bg-gray-100 text-gray-800 border-gray-200", icon: AlertTriangle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const IconComponent = config.icon;

    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        <IconComponent className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getStatsIcon = (current: number, total: number) => {
    if (total === 0) return <Minus className="w-4 h-4 text-gray-400" />;
    const percentage = (current / total) * 100;
    if (percentage >= 70) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (percentage >= 30) return <Minus className="w-4 h-4 text-yellow-600" />;
    return <TrendingDown className="w-4 h-4 text-red-600" />;
  };

  const refreshAll = () => {
    refetchOffers();
    refetchStats();
    queryClient.invalidateQueries({ queryKey: ["/api/telegram/service-status"] });
  };

  if (loadOffersLoading || statsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-20 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-32 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-blue-600" />
              Telegram Load Dispatching
            </h1>
            <p className="text-gray-500">Real-time load dispatching via Telegram bot</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${serviceStatus?.isRunning ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-600">
                {serviceStatus?.isRunning ? 'Service Running' : 'Service Offline'}
              </span>
            </div>
            <Button 
              onClick={refreshAll}
              size="sm"
              className="flex items-center gap-2"
              data-testid="button-refresh-dispatching"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
            <Button 
              onClick={() => testLoadMutation.mutate()}
              disabled={testLoadMutation.isPending}
              size="sm"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              data-testid="button-test-load"
            >
              <Play className="w-4 h-4" />
              {testLoadMutation.isPending ? "Sending..." : "Test Load"}
            </Button>
          </div>
        </div>

        {/* Service Status */}
        {serviceStatus && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${serviceStatus.isRunning ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <div>
                    <p className="font-medium">Telegram Bot Status</p>
                    <p className="text-sm text-gray-600">
                      {serviceStatus.config?.botUsername || 'LAMPDispatchbot'} • 
                      Timeout: {serviceStatus.config?.responseTimeoutMinutes || 3} minutes
                    </p>
                  </div>
                </div>
                <Badge className={serviceStatus.isRunning ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                  {serviceStatus.isRunning ? "Online" : "Offline"}
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
                No loads have been sent to drivers via Telegram yet.
              </p>
              <Button 
                onClick={() => testLoadMutation.mutate()}
                disabled={testLoadMutation.isPending}
                className="flex items-center gap-2"
                data-testid="button-send-test-load"
              >
                <Play className="w-4 h-4" />
                Send Test Load
              </Button>
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
                          <Truck className="w-3 h-3 text-blue-600" />
                          <span className="text-gray-600">Miles: </span>
                          <span className="font-medium">{offer.load.miles}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Driver Response Details */}
                  {offer.status !== 'pending' && (
                    <>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">Driver Response:</span>
                          <span className="text-gray-600">
                            {offer.status === 'accepted' && '✅ Accepted the load'}
                            {offer.status === 'declined' && '❌ Declined the load'}
                            {offer.status === 'timeout' && '⏰ No response (timeout)'}
                          </span>
                        </div>
                        {offer.respondedAt && (
                          <span className="text-gray-500">
                            {format(new Date(offer.respondedAt), "h:mm a")}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}