import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, Users, Clock, AlertCircle } from 'lucide-react';

interface RealTimeUpdate {
  loadId: string;
  loadNumber: string;
  status: string;
  topPredictions: {
    driverId: string;
    driverName: string;
    confidenceScore: number;
    acceptanceProbability: number;
    riskLevel: 'low' | 'medium' | 'high';
  }[];
}

interface StreamData {
  timestamp: string;
  updates: RealTimeUpdate[];
}

export function RealTimePredictionDashboard() {
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  useEffect(() => {
    connectToStream();
    return () => {
      // Cleanup will be handled by the browser when component unmounts
    };
  }, []);

  const connectToStream = () => {
    try {
      const eventSource = new EventSource('/api/prediction-confidence/realtime');
      
      eventSource.onopen = () => {
        setConnected(true);
        setError(null);
        console.log('🔗 Connected to real-time prediction stream');
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data: StreamData = JSON.parse(event.data);
          setStreamData(data);
          setLastUpdate(new Date().toLocaleTimeString());
        } catch (parseError) {
          console.error('Error parsing stream data:', parseError);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('Stream error:', error);
        setConnected(false);
        setError('Connection lost. Attempting to reconnect...');
        
        // Auto-reconnect after 5 seconds
        setTimeout(() => {
          eventSource.close();
          connectToStream();
        }, 5000);
      };
      
    } catch (err) {
      setError('Failed to connect to real-time stream');
      setConnected(false);
    }
  };

  const getRiskLevelColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getAverageConfidence = (updates: RealTimeUpdate[]) => {
    if (!updates.length) return 0;
    const total = updates.reduce((sum, update) => {
      const avgForLoad = update.topPredictions.reduce((loadSum, pred) => loadSum + pred.confidenceScore, 0) / update.topPredictions.length;
      return sum + avgForLoad;
    }, 0);
    return Math.round(total / updates.length);
  };

  const getTotalDrivers = (updates: RealTimeUpdate[]) => {
    const uniqueDrivers = new Set();
    updates.forEach(update => {
      update.topPredictions.forEach(pred => uniqueDrivers.add(pred.driverId));
    });
    return uniqueDrivers.size;
  };

  const getHighConfidenceLoads = (updates: RealTimeUpdate[]) => {
    return updates.filter(update => 
      update.topPredictions.some(pred => pred.confidenceScore >= 75)
    ).length;
  };

  return (
    <div className="space-y-6" data-testid="realtime-prediction-dashboard">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5" />
              <span>Real-Time Load Matching Predictions</span>
            </span>
            <div className="flex items-center space-x-2">
              {connected ? (
                <Badge className="bg-green-100 text-green-800">
                  <div className="w-2 h-2 bg-green-600 rounded-full mr-2 animate-pulse"></div>
                  Live
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Disconnected
                </Badge>
              )}
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  Last update: {lastUpdate}
                </span>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
              <div className="flex items-center space-x-2 text-red-700">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {streamData && (
            <>
              {/* Summary Statistics */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600 font-medium">Active Loads</p>
                      <p className="text-2xl font-bold text-blue-800">{streamData.updates.length}</p>
                    </div>
                    <div className="bg-blue-200 p-2 rounded-full">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-green-600 font-medium">Avg Confidence</p>
                      <p className="text-2xl font-bold text-green-800">{getAverageConfidence(streamData.updates)}%</p>
                    </div>
                    <div className="bg-green-200 p-2 rounded-full">
                      <TrendingUp className="w-4 h-4 text-green-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-purple-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-purple-600 font-medium">Active Drivers</p>
                      <p className="text-2xl font-bold text-purple-800">{getTotalDrivers(streamData.updates)}</p>
                    </div>
                    <div className="bg-purple-200 p-2 rounded-full">
                      <Users className="w-4 h-4 text-purple-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-orange-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-orange-600 font-medium">High Confidence</p>
                      <p className="text-2xl font-bold text-orange-800">{getHighConfidenceLoads(streamData.updates)}</p>
                    </div>
                    <div className="bg-orange-200 p-2 rounded-full">
                      <Clock className="w-4 h-4 text-orange-600" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Updates */}
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4" />
                  <span>Live Load Predictions</span>
                </h3>
                
                {streamData.updates.map((update) => (
                  <Card key={update.loadId} className="border-l-4 border-l-blue-500">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-medium">{update.loadNumber}</h4>
                          <Badge 
                            variant={update.status === 'active' ? 'default' : 'secondary'}
                            className="capitalize"
                          >
                            {update.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-500">
                          {update.topPredictions.length} drivers analyzed
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {update.topPredictions.map((prediction) => (
                          <div 
                            key={prediction.driverId}
                            className="bg-gray-50 p-3 rounded-md space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{prediction.driverName}</span>
                              <Badge className={getRiskLevelColor(prediction.riskLevel)}>
                                {prediction.riskLevel}
                              </Badge>
                            </div>
                            
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span>Confidence</span>
                                <span className={getConfidenceColor(prediction.confidenceScore)}>
                                  {prediction.confidenceScore}%
                                </span>
                              </div>
                              <Progress value={prediction.confidenceScore} className="h-2" />
                            </div>
                            
                            <div className="text-xs text-gray-600">
                              Acceptance: {prediction.acceptanceProbability}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {!streamData && connected && (
            <div className="text-center py-8 text-gray-500">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <p>Waiting for prediction data...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default RealTimePredictionDashboard;