import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PredictionConfidenceIndicator } from '@/components/PredictionConfidenceIndicator';
import { RealTimePredictionDashboard } from '@/components/RealTimePredictionDashboard';
import { useQuery } from '@tanstack/react-query';
import { Search, TrendingUp, Users, BarChart3, Activity } from 'lucide-react';

function PredictionConfidencePage() {
  const [selectedLoadId, setSelectedLoadId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch recent loads for selection
  const { data: recentLoads, isLoading: loadsLoading } = useQuery({
    queryKey: ['/api/loads'],
    select: (data) => data.slice(-20) // Get last 20 loads
  });

  const filteredLoads = recentLoads?.filter((load: any) => 
    load.loadNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    load.pickupAddress?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    load.deliveryAddress?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="prediction-confidence-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Load Matching Predictions</h1>
          <p className="text-gray-600 mt-1">
            Real-time confidence indicators for driver-load matching
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-blue-600" />
          <span className="text-sm font-medium text-blue-600">AI-Powered Analytics</span>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dashboard" className="flex items-center space-x-2">
            <BarChart3 className="w-4 h-4" />
            <span>Live Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="load-analysis" className="flex items-center space-x-2">
            <TrendingUp className="w-4 h-4" />
            <span>Load Analysis</span>
          </TabsTrigger>
          <TabsTrigger value="driver-insights" className="flex items-center space-x-2">
            <Users className="w-4 h-4" />
            <span>Driver Insights</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <RealTimePredictionDashboard />
        </TabsContent>

        <TabsContent value="load-analysis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Load Prediction Analysis</CardTitle>
              <p className="text-sm text-gray-600">
                Analyze prediction confidence for specific loads
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <Label htmlFor="search-loads">Search Loads</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="search-loads"
                        placeholder="Search by load number, pickup, or delivery location..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                        data-testid="input-search-loads"
                      />
                    </div>
                  </div>
                </div>

                {loadsLoading && (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-sm text-gray-600 mt-2">Loading recent loads...</p>
                  </div>
                )}

                {filteredLoads.length > 0 && (
                  <div className="space-y-2">
                    <Label>Select a Load to Analyze:</Label>
                    <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
                      {filteredLoads.map((load: any) => (
                        <Button
                          key={load.id}
                          variant={selectedLoadId === load.id ? "default" : "outline"}
                          className="justify-start h-auto p-3"
                          onClick={() => setSelectedLoadId(load.id)}
                          data-testid={`button-select-load-${load.id}`}
                        >
                          <div className="text-left">
                            <div className="font-medium">{load.loadNumber}</div>
                            <div className="text-xs text-gray-600">
                              {load.pickupAddress} → {load.deliveryAddress}
                            </div>
                            <div className="text-xs text-gray-500">
                              ${load.rate?.toLocaleString()} • {load.equipmentType}
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLoadId && (
                  <div className="mt-6">
                    <PredictionConfidenceIndicator 
                      loadId={selectedLoadId} 
                      showFactors={true}
                    />
                  </div>
                )}

                {!selectedLoadId && filteredLoads.length === 0 && !loadsLoading && (
                  <div className="text-center py-8 text-gray-500">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No loads found matching your search criteria</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="driver-insights" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Driver Performance Insights</CardTitle>
              <p className="text-sm text-gray-600">
                Historical prediction accuracy and driver behavior patterns
              </p>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">Driver Insights Coming Soon</h3>
                <p className="text-sm">
                  This section will show historical accuracy of predictions, 
                  driver response patterns, and optimization recommendations.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PredictionConfidencePage;