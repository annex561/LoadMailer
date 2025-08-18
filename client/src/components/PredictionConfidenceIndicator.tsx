import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, MapPin } from 'lucide-react';

interface PredictionFactors {
  distanceScore: number;
  equipmentCompatibilityScore: number;
  rateAttractivenessScore: number;
  driverHistoryScore: number;
  timeOfDayScore: number;
  routePreferenceScore: number;
  recentActivityScore: number;
}

interface DriverPrediction {
  driverId: string;
  driverName: string;
  driverCity: string;
  equipmentType: string;
  status: string;
  confidenceScore: number;
  acceptanceProbability: number;
  factors: PredictionFactors;
  reasoning: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

interface PredictionConfidenceIndicatorProps {
  loadId: string;
  compact?: boolean;
  showFactors?: boolean;
}

export function PredictionConfidenceIndicator({ 
  loadId, 
  compact = false, 
  showFactors = true 
}: PredictionConfidenceIndicatorProps) {
  const [predictions, setPredictions] = useState<DriverPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadDetails, setLoadDetails] = useState<any>(null);

  useEffect(() => {
    fetchPredictions();
  }, [loadId]);

  const fetchPredictions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/prediction-confidence/load/${loadId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch predictions');
      }
      
      const data = await response.json();
      setLoadDetails({
        loadNumber: data.loadNumber,
        pickupAddress: data.pickupAddress,
        deliveryAddress: data.deliveryAddress,
        rate: data.rate,
        equipmentType: data.equipmentType
      });
      setPredictions(data.predictions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
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

  const getRiskLevelIcon = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return <CheckCircle className="w-4 h-4" />;
      case 'medium': return <Clock className="w-4 h-4" />;
      case 'high': return <AlertTriangle className="w-4 h-4" />;
      default: return null;
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getFactorIcon = (factorName: string) => {
    switch (factorName) {
      case 'distanceScore': return <MapPin className="w-3 h-3" />;
      case 'equipmentCompatibilityScore': return <CheckCircle className="w-3 h-3" />;
      case 'rateAttractivenessScore': return <TrendingUp className="w-3 h-3" />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-sm text-gray-600">Calculating prediction confidence...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full border-red-200">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2 text-red-600">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">Error loading predictions: {error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2" data-testid="prediction-confidence-compact">
        {predictions.slice(0, 3).map((prediction) => (
          <TooltipProvider key={prediction.driverId}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-between p-2 bg-gray-50 rounded-md hover:bg-gray-100 cursor-pointer">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-sm">{prediction.driverName}</span>
                    <Badge variant="outline" className={getRiskLevelColor(prediction.riskLevel)}>
                      {getRiskLevelIcon(prediction.riskLevel)}
                      <span className="ml-1">{prediction.riskLevel}</span>
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`font-bold text-sm ${getConfidenceColor(prediction.confidenceScore)}`}>
                      {prediction.confidenceScore}%
                    </span>
                    <div className="w-16">
                      <Progress value={prediction.confidenceScore} className="h-2" />
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-semibold">Acceptance Probability: {prediction.acceptanceProbability}%</p>
                  <ul className="text-xs space-y-1">
                    {prediction.reasoning.map((reason, idx) => (
                      <li key={idx}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    );
  }

  return (
    <Card className="w-full" data-testid="prediction-confidence-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Load Matching Confidence</span>
          {loadDetails && (
            <Badge variant="outline">
              {loadDetails.loadNumber}
            </Badge>
          )}
        </CardTitle>
        {loadDetails && (
          <div className="text-sm text-gray-600">
            <div>{loadDetails.pickupAddress} → {loadDetails.deliveryAddress}</div>
            <div className="flex items-center space-x-4 mt-1">
              <span>${loadDetails.rate?.toLocaleString()}</span>
              <span>{loadDetails.equipmentType}</span>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {predictions.map((prediction) => (
            <div key={prediction.driverId} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div>
                    <h4 className="font-semibold">{prediction.driverName}</h4>
                    <p className="text-sm text-gray-600">
                      {prediction.driverCity} • {prediction.equipmentType}
                    </p>
                  </div>
                  <Badge 
                    variant={prediction.status === 'available' ? 'default' : 'secondary'}
                    className="capitalize"
                  >
                    {prediction.status}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${getConfidenceColor(prediction.confidenceScore)}`}>
                    {prediction.confidenceScore}%
                  </div>
                  <div className="text-sm text-gray-600">
                    {prediction.acceptanceProbability}% acceptance
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Badge className={getRiskLevelColor(prediction.riskLevel)}>
                  {getRiskLevelIcon(prediction.riskLevel)}
                  <span className="ml-1 capitalize">{prediction.riskLevel} Risk</span>
                </Badge>
                <Progress value={prediction.confidenceScore} className="flex-1 h-2" />
              </div>

              {prediction.reasoning.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-sm font-medium">Key Factors:</h5>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {prediction.reasoning.map((reason, idx) => (
                      <li key={idx} className="flex items-start space-x-1">
                        <span className="text-blue-600 mt-1">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showFactors && (
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Distance</div>
                    <div className="text-sm font-medium">{Math.round(prediction.factors.distanceScore)}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Equipment</div>
                    <div className="text-sm font-medium">{Math.round(prediction.factors.equipmentCompatibilityScore)}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500">Rate</div>
                    <div className="text-sm font-medium">{Math.round(prediction.factors.rateAttractivenessScore)}%</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default PredictionConfidenceIndicator;