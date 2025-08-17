import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, TrendingUp, DollarSign, Route, Target, BarChart3, Zap, AlertCircle } from "lucide-react";

interface LoadRecommendation {
  id: string;
  loadId: string;
  aiScore: number;
  historicalPerformanceScore: number;
  marketConditionScore: number;
  profitabilityScore: number;
  routeOptimizationScore: number;
  predictedProfit: number;
  predictedMargin: number;
  riskScore: number;
  confidenceLevel: number;
  competitiveRatePosition: string;
  demandLevel: string;
  reasoningFactors: any;
  createdAt: string;
}

interface BackhaulOpportunity {
  id: string;
  primaryLoadId: string;
  backhaulLoadId: string;
  combinedRate: number;
  deadheadSavings: number;
  totalProfit: number;
  profitImprovement: number;
  matchScore: number;
  timeEfficiency: number;
  profitScore: number;
  status: string;
}

interface MarketTrend {
  id: string;
  originState: string;
  destinationState: string;
  equipmentType: string;
  averageRate: number;
  ratePerMile: number;
  loadVolume: number;
  truckDemand: number;
  seasonalFactor: number;
  weekOf: string;
}

export default function SmartLoadMatching() {
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const [activeTab, setActiveTab] = useState("recommendations");

  // Fetch available drivers
  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
  });

  // Fetch load recommendations for selected driver
  const { data: recommendationsData, refetch: refetchRecommendations } = useQuery({
    queryKey: ['/api/smart-matching/recommendations', selectedDriver],
    enabled: !!selectedDriver,
  });

  // Fetch backhaul opportunities
  const { data: backhaulData } = useQuery({
    queryKey: ['/api/smart-matching/backhaul-opportunities'],
  });

  // Fetch market trends
  const { data: marketData } = useQuery({
    queryKey: ['/api/smart-matching/market-trends'],
  });

  const recommendations: LoadRecommendation[] = recommendationsData?.recommendations || [];
  const backhaulOpportunities: BackhaulOpportunity[] = backhaulData?.opportunities || [];
  const marketTrends: MarketTrend[] = marketData?.trends || [];

  const handleGenerateRecommendations = async () => {
    if (!selectedDriver) return;
    
    try {
      const response = await fetch(`/api/smart-matching/analyze-load/${selectedDriver}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: selectedDriver })
      });
      
      if (response.ok) {
        refetchRecommendations();
      }
    } catch (error) {
      console.error('Error generating recommendations:', error);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="smart-load-matching-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="page-title">
            <Brain className="h-8 w-8 text-blue-600" />
            Smart Load Matching with AI Analytics
          </h1>
          <p className="text-gray-600 mt-2" data-testid="page-description">
            AI-powered load recommendations, market analysis, and profit optimization
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <Select value={selectedDriver} onValueChange={setSelectedDriver}>
            <SelectTrigger className="w-[200px] bg-white border border-gray-300" data-testid="driver-select">
              <SelectValue placeholder="Select Driver" />
            </SelectTrigger>
            <SelectContent className="bg-white border border-gray-300 shadow-lg">
              {drivers.map((driver: any) => (
                <SelectItem key={driver.id} value={driver.id} data-testid={`driver-option-${driver.id}`}>
                  {driver.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button 
            onClick={handleGenerateRecommendations}
            disabled={!selectedDriver}
            className="flex items-center gap-2"
            data-testid="generate-recommendations-btn"
          >
            <Zap className="h-4 w-4" />
            Generate AI Analysis
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4" data-testid="tabs-list">
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">
            Load Recommendations
          </TabsTrigger>
          <TabsTrigger value="backhaul" data-testid="tab-backhaul">
            Backhaul Opportunities
          </TabsTrigger>
          <TabsTrigger value="market" data-testid="tab-market">
            Market Trends
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            AI Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2" data-testid="recommendations-title">
                <Target className="h-5 w-5" />
                AI-Powered Load Recommendations
              </CardTitle>
              <CardDescription data-testid="recommendations-description">
                {selectedDriver ? 
                  `Personalized recommendations for ${drivers.find((d: any) => d.id === selectedDriver)?.name || 'selected driver'}` :
                  'Select a driver to view personalized AI recommendations'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedDriver ? (
                <div className="text-center py-8 text-gray-500" data-testid="no-driver-selected">
                  Please select a driver to view AI-powered load recommendations
                </div>
              ) : recommendations.length === 0 ? (
                <div className="text-center py-8" data-testid="no-recommendations">
                  <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No recommendations available</p>
                  <p className="text-sm text-gray-400">Click "Generate AI Analysis" to create recommendations</p>
                </div>
              ) : (
                <div className="space-y-4" data-testid="recommendations-list">
                  {recommendations.map((rec) => (
                    <Card key={rec.id} className="border-l-4 border-l-blue-500" data-testid={`recommendation-${rec.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-semibold text-lg" data-testid={`rec-title-${rec.id}`}>
                              Load {rec.loadId}
                            </h4>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant={getScoreBadgeVariant(rec.aiScore)} data-testid={`ai-score-${rec.id}`}>
                                AI Score: {rec.aiScore}%
                              </Badge>
                              <Badge variant="outline" data-testid={`confidence-${rec.id}`}>
                                {rec.confidenceLevel}% Confidence
                              </Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-green-600" data-testid={`profit-${rec.id}`}>
                              ${rec.predictedProfit.toLocaleString()}
                            </div>
                            <div className="text-sm text-gray-500" data-testid={`margin-${rec.id}`}>
                              {rec.predictedMargin.toFixed(1)}% margin
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div data-testid={`historical-score-${rec.id}`}>
                            <div className="text-sm text-gray-500">Historical Performance</div>
                            <div className={`font-semibold ${getScoreColor(rec.historicalPerformanceScore)}`}>
                              {rec.historicalPerformanceScore}%
                            </div>
                          </div>
                          <div data-testid={`market-score-${rec.id}`}>
                            <div className="text-sm text-gray-500">Market Conditions</div>
                            <div className={`font-semibold ${getScoreColor(rec.marketConditionScore)}`}>
                              {rec.marketConditionScore}%
                            </div>
                          </div>
                          <div data-testid={`profitability-score-${rec.id}`}>
                            <div className="text-sm text-gray-500">Profitability</div>
                            <div className={`font-semibold ${getScoreColor(rec.profitabilityScore)}`}>
                              {rec.profitabilityScore}%
                            </div>
                          </div>
                          <div data-testid={`route-score-${rec.id}`}>
                            <div className="text-sm text-gray-500">Route Efficiency</div>
                            <div className={`font-semibold ${getScoreColor(rec.routeOptimizationScore)}`}>
                              {rec.routeOptimizationScore}%
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <Badge variant="outline" data-testid={`rate-position-${rec.id}`}>
                              {rec.competitiveRatePosition.replace('_', ' ')}
                            </Badge>
                            <Badge variant="outline" data-testid={`demand-level-${rec.id}`}>
                              {rec.demandLevel} demand
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">Risk Level:</span>
                            <Progress value={rec.riskScore} className="w-16" data-testid={`risk-progress-${rec.id}`} />
                            <span className="text-sm font-medium" data-testid={`risk-value-${rec.id}`}>
                              {rec.riskScore}%
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backhaul" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2" data-testid="backhaul-title">
                <Route className="h-5 w-5" />
                Backhaul Opportunities
              </CardTitle>
              <CardDescription data-testid="backhaul-description">
                Maximize profitability with AI-identified backhaul matches
              </CardDescription>
            </CardHeader>
            <CardContent>
              {backhaulOpportunities.length === 0 ? (
                <div className="text-center py-8" data-testid="no-backhaul">
                  <Route className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No backhaul opportunities available</p>
                </div>
              ) : (
                <div className="space-y-4" data-testid="backhaul-list">
                  {backhaulOpportunities.map((opp) => (
                    <Card key={opp.id} className="border-l-4 border-l-green-500" data-testid={`backhaul-${opp.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-semibold text-lg" data-testid={`backhaul-title-${opp.id}`}>
                              Primary: {opp.primaryLoadId} → Backhaul: {opp.backhaulLoadId}
                            </h4>
                            <Badge variant="default" className="mt-2" data-testid={`match-score-${opp.id}`}>
                              {opp.matchScore}% Match Score
                            </Badge>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-green-600" data-testid={`combined-rate-${opp.id}`}>
                              ${opp.combinedRate.toLocaleString()}
                            </div>
                            <div className="text-sm text-green-500" data-testid={`profit-improvement-${opp.id}`}>
                              +${opp.profitImprovement.toLocaleString()} improvement
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div data-testid={`deadhead-savings-${opp.id}`}>
                            <div className="text-sm text-gray-500">Deadhead Savings</div>
                            <div className="font-semibold text-green-600">
                              ${opp.deadheadSavings.toLocaleString()}
                            </div>
                          </div>
                          <div data-testid={`time-efficiency-${opp.id}`}>
                            <div className="text-sm text-gray-500">Time Efficiency</div>
                            <div className="font-semibold">
                              {opp.timeEfficiency}%
                            </div>
                          </div>
                          <div data-testid={`total-profit-${opp.id}`}>
                            <div className="text-sm text-gray-500">Total Profit</div>
                            <div className="font-semibold text-green-600">
                              ${opp.totalProfit.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="market" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2" data-testid="market-title">
                <TrendingUp className="h-5 w-5" />
                Market Trends & Rate Analysis
              </CardTitle>
              <CardDescription data-testid="market-description">
                Real-time market intelligence and rate predictions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {marketTrends.length === 0 ? (
                <div className="text-center py-8" data-testid="no-market-data">
                  <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No market trend data available</p>
                </div>
              ) : (
                <div className="space-y-4" data-testid="market-trends-list">
                  {marketTrends.slice(0, 10).map((trend) => (
                    <Card key={trend.id} className="border-l-4 border-l-yellow-500" data-testid={`trend-${trend.id}`}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-semibold text-lg" data-testid={`trend-route-${trend.id}`}>
                              {trend.originState} → {trend.destinationState}
                            </h4>
                            <Badge variant="outline" className="mt-1" data-testid={`equipment-type-${trend.id}`}>
                              {trend.equipmentType}
                            </Badge>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold" data-testid={`rate-per-mile-${trend.id}`}>
                              ${trend.ratePerMile.toFixed(2)}/mi
                            </div>
                            <div className="text-sm text-gray-500" data-testid={`avg-rate-${trend.id}`}>
                              Avg: ${trend.averageRate.toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div data-testid={`load-volume-${trend.id}`}>
                            <div className="text-sm text-gray-500">Load Volume</div>
                            <div className="font-semibold">
                              {trend.loadVolume} loads
                            </div>
                          </div>
                          <div data-testid={`truck-demand-${trend.id}`}>
                            <div className="text-sm text-gray-500">Truck Demand</div>
                            <div className="font-semibold">
                              {trend.truckDemand.toFixed(1)}x
                            </div>
                          </div>
                          <div data-testid={`seasonal-factor-${trend.id}`}>
                            <div className="text-sm text-gray-500">Seasonal Factor</div>
                            <div className="font-semibold">
                              {trend.seasonalFactor.toFixed(2)}x
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card data-testid="analytics-overview">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  AI System Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Active AI Models</span>
                    <span className="font-semibold">3</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Daily Analyses</span>
                    <span className="font-semibold">247</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Accuracy Rate</span>
                    <span className="font-semibold text-green-600">94.2%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="performance-metrics">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Performance Impact
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Profit Increase</span>
                    <span className="font-semibold text-green-600">+18.7%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Deadhead Reduction</span>
                    <span className="font-semibold text-green-600">-23.4%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Load Acceptance</span>
                    <span className="font-semibold text-green-600">+31.2%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="learning-status">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Learning Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Training Data Points</span>
                    <span className="font-semibold">12,847</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Model Version</span>
                    <span className="font-semibold">v1.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Last Updated</span>
                    <span className="font-semibold">2 hours ago</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}