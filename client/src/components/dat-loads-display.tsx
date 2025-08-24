import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Truck, 
  MapPin, 
  DollarSign,
  Weight,
  Route,
  Building2,
  Phone,
  Mail,
  Clock,
  RefreshCw
} from 'lucide-react';

interface DATLoad {
  id: string;
  origin: string;
  destination: string;
  pickup: string;
  weight: string;
  rate: string;
  miles: string;
  equipment: string;
  broker: string;
  email: string;
  phone: string;
  scrapedAt: string;
}

export function DATLoadsDisplay() {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const { data: datLoads = [], isLoading, refetch } = useQuery<DATLoad[]>({
    queryKey: ['/api/dat-loads-direct'],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const handleRefresh = () => {
    refetch();
    setLastRefresh(new Date());
  };

  const formatRate = (rate: string) => {
    const numericRate = rate.replace(/[^0-9]/g, '');
    return numericRate ? `$${parseInt(numericRate).toLocaleString()}` : rate;
  };

  const formatWeight = (weight: string) => {
    return weight.includes('lbs') ? weight : `${weight} lbs`;
  };

  const formatMiles = (miles: string) => {
    return miles.includes('mi') ? miles : `${miles} mi`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            <Truck className="w-5 h-5 mr-2 text-blue-600" />
            Real DAT LoadLink Freight
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Badge variant={datLoads.length > 0 ? "default" : "outline"}>
              {datLoads.length} Active Loads
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          Live freight data from DAT LoadLink - Major brokers: C.H. Robinson, TQL, Landstar, uShip
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && datLoads.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mr-2" />
            <span className="text-gray-600">Loading DAT loads...</span>
          </div>
        ) : datLoads.length === 0 ? (
          <div className="text-center py-8">
            <Truck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No DAT loads currently available</p>
            <p className="text-sm text-gray-500 mt-1">
              Scraping runs every 15 seconds during business hours (8 AM - 6 PM)
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Last updated: {lastRefresh.toLocaleTimeString()}</span>
              <span>Auto-refresh: 10s</span>
            </div>
            
            <div className="grid gap-4">
              {datLoads.map((load: DATLoad) => (
                <Card key={load.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Route Information */}
                      <div className="space-y-2">
                        <div className="flex items-center text-sm font-medium text-gray-700">
                          <Route className="w-4 h-4 mr-1" />
                          Route
                        </div>
                        <div className="flex items-center">
                          <MapPin className="w-4 h-4 text-green-600 mr-1" />
                          <span className="text-sm font-medium">{load.origin}</span>
                        </div>
                        <div className="flex items-center">
                          <MapPin className="w-4 h-4 text-red-600 mr-1" />
                          <span className="text-sm font-medium">{load.destination}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatMiles(load.miles)} • {load.equipment}
                        </div>
                      </div>

                      {/* Load Details */}
                      <div className="space-y-2">
                        <div className="flex items-center text-sm font-medium text-gray-700">
                          <Weight className="w-4 h-4 mr-1" />
                          Load Details
                        </div>
                        <div className="flex items-center">
                          <DollarSign className="w-4 h-4 text-green-600 mr-1" />
                          <span className="text-lg font-bold text-green-600">
                            {formatRate(load.rate)}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {formatWeight(load.weight)}
                        </div>
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 text-gray-400 mr-1" />
                          <span className="text-xs text-gray-500">
                            Pickup: {load.pickup}
                          </span>
                        </div>
                      </div>

                      {/* Broker Contact */}
                      <div className="space-y-2">
                        <div className="flex items-center text-sm font-medium text-gray-700">
                          <Building2 className="w-4 h-4 mr-1" />
                          Broker Contact
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {load.broker}
                        </Badge>
                        <div className="space-y-1">
                          <div className="flex items-center text-xs text-gray-600">
                            <Phone className="w-3 h-3 mr-1" />
                            <span className="font-mono">{load.phone}</span>
                          </div>
                          <div className="flex items-center text-xs text-gray-600">
                            <Mail className="w-3 h-3 mr-1" />
                            <span className="font-mono truncate">{load.email}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <Separator className="my-3" />
                    
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        Load ID: {load.id}
                      </div>
                      <div className="text-xs text-gray-500">
                        Scraped: {new Date(load.scrapedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}