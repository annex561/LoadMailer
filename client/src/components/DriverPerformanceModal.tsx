import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Star, 
  MapPin, 
  Clock, 
  DollarSign, 
  Truck,
  Target,
  Award,
  AlertTriangle,
  Calendar,
  BarChart3,
  Activity
} from "lucide-react";
import type { Driver } from "@shared/schema";
import type { DriverPerformanceMetrics, PerformanceChartData } from "@shared/performance-types";
import { getPerformanceBadge } from "@shared/performance-types";

interface DriverPerformanceModalProps {
  driver: Driver | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DriverPerformanceModal({ driver, isOpen, onClose }: DriverPerformanceModalProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<"7d" | "30d" | "90d" | "1y">("30d");

  const { data: performanceData, isLoading } = useQuery<DriverPerformanceMetrics>({
    queryKey: ["/api/drivers/performance", driver?.id, selectedPeriod],
    enabled: !!driver?.id && isOpen,
  });

  const { data: chartData } = useQuery<PerformanceChartData[]>({
    queryKey: ["/api/drivers/performance-chart", driver?.id, selectedPeriod],
    enabled: !!driver?.id && isOpen,
  });

  if (!driver) return null;

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white border border-gray-300 shadow-lg">
          <DialogHeader>
            <DialogTitle>Loading Performance Data...</DialogTitle>
          </DialogHeader>
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-200 rounded-lg h-20"></div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const metrics = performanceData || {
    driverId: driver.id,
    driverName: driver.name,
    totalLoads: 0,
    completedLoads: 0,
    completionRate: 0,
    averageRating: 0,
    totalRatings: 0,
    totalRevenue: 0,
    totalMiles: 0,
    revenuePerMile: 0,
    onTimeDeliveries: 0,
    lateDeliveries: 0,
    onTimeRate: 0,
    averageDeliveryTime: 0,
    cancelledLoads: 0,
    cancellationRate: 0,
    currentStreak: 0,
    bestStreak: 0,
    fuelEfficiency: 0,
    maintenanceScore: 100,
    safetyScore: 100,
    overallScore: 0,
    performanceTrend: 'stable' as const,
    recentActivity: 'low' as const
  };

  const performanceBadge = getPerformanceBadge(metrics.overallScore);
  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'down': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <Minus className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActivityBadge = (activity: string) => {
    const configs = {
      high: { label: 'High Activity', className: 'bg-green-100 text-green-800' },
      medium: { label: 'Medium Activity', className: 'bg-yellow-100 text-yellow-800' },
      low: { label: 'Low Activity', className: 'bg-red-100 text-red-800' }
    };
    const config = configs[activity as keyof typeof configs] || configs.low;
    
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatNumber = (num: number, decimals = 0) => 
    new Intl.NumberFormat('en-US', { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    }).format(num);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-white border border-gray-300 shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Performance Dashboard</h2>
              <p className="text-sm text-gray-500">{driver.name}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Overall Score</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{Math.round(metrics.overallScore)}</span>
                      {getTrendIcon(metrics.performanceTrend)}
                    </div>
                  </div>
                  <div className="text-2xl">{performanceBadge.icon}</div>
                </div>
                <Badge className={`bg-${performanceBadge.color}-100 text-${performanceBadge.color}-800 mt-2`}>
                  {performanceBadge.label}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total Revenue</p>
                    <p className="text-2xl font-bold">{formatCurrency(metrics.totalRevenue)}</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {formatCurrency(metrics.revenuePerMile)}/mile
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Completed Loads</p>
                    <p className="text-2xl font-bold">{metrics.completedLoads}</p>
                  </div>
                  <Truck className="w-8 h-8 text-blue-600" />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {Math.round(metrics.completionRate)}% completion rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Current Streak</p>
                    <p className="text-2xl font-bold">{metrics.currentStreak}</p>
                  </div>
                  <Target className="w-8 h-8 text-purple-600" />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Best: {metrics.bestStreak} loads
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="performance" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-gray-100">
              <TabsTrigger value="performance" className="data-[state=active]:bg-white">Performance</TabsTrigger>
              <TabsTrigger value="reliability" className="data-[state=active]:bg-white">Reliability</TabsTrigger>
              <TabsTrigger value="efficiency" className="data-[state=active]:bg-white">Efficiency</TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:bg-white">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="performance" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-yellow-600" />
                      Quality Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Average Rating</span>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star 
                              key={i} 
                              className={`w-4 h-4 ${
                                i < Math.floor(metrics.averageRating) 
                                  ? 'text-yellow-400 fill-yellow-400' 
                                  : 'text-gray-300'
                              }`} 
                            />
                          ))}
                          <span className="text-sm ml-1">
                            {metrics.averageRating.toFixed(1)} ({metrics.totalRatings})
                          </span>
                        </div>
                      </div>
                      <Progress value={(metrics.averageRating / 5) * 100} className="h-2" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">On-Time Rate</span>
                        <span className="text-sm font-semibold">{Math.round(metrics.onTimeRate)}%</span>
                      </div>
                      <Progress value={metrics.onTimeRate} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-blue-600" />
                      Distance & Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Miles</span>
                      <span className="text-sm font-semibold">
                        {formatNumber(metrics.totalMiles)}
                      </span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Revenue per Mile</span>
                      <span className="text-sm font-semibold">
                        {formatCurrency(metrics.revenuePerMile)}
                      </span>
                    </div>

                    <Separator />

                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Avg Delivery Time</span>
                      <span className="text-sm font-semibold">
                        {metrics.averageDeliveryTime.toFixed(1)}h
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="reliability" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Award className="w-5 h-5 text-green-600" />
                      Reliability Scores
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Completion Rate</span>
                        <span className="text-sm font-semibold">{Math.round(metrics.completionRate)}%</span>
                      </div>
                      <Progress value={metrics.completionRate} className="h-2" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Cancellation Rate</span>
                        <span className="text-sm font-semibold">{Math.round(metrics.cancellationRate)}%</span>
                      </div>
                      <Progress value={100 - metrics.cancellationRate} className="h-2" />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Current Streak</span>
                        <span className="text-sm font-semibold">{metrics.currentStreak}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Best Streak</span>
                        <span className="text-sm font-semibold">{metrics.bestStreak}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                      Issue Tracking
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Cancelled Loads</span>
                      <span className="text-sm font-semibold">{metrics.cancelledLoads}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Late Deliveries</span>
                      <span className="text-sm font-semibold">{metrics.lateDeliveries}</span>
                    </div>

                    <Separator />

                    <div className="bg-blue-50 p-3 rounded-lg">
                      <p className="text-xs text-blue-700">
                        Issues tracked help identify areas for improvement and training opportunities.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="efficiency" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-purple-600" />
                      Efficiency Scores
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Fuel Efficiency</span>
                        <span className="text-sm font-semibold">{metrics.fuelEfficiency.toFixed(1)} MPG</span>
                      </div>
                      <Progress value={(metrics.fuelEfficiency / 8) * 100} className="h-2" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Maintenance Score</span>
                        <span className="text-sm font-semibold">{Math.round(metrics.maintenanceScore)}/100</span>
                      </div>
                      <Progress value={metrics.maintenanceScore} className="h-2" />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Safety Score</span>
                        <span className="text-sm font-semibold">{Math.round(metrics.safetyScore)}/100</span>
                      </div>
                      <Progress value={metrics.safetyScore} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Efficiency Insights</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {metrics.fuelEfficiency > 6.5 && (
                        <div className="flex items-center gap-2 text-green-700">
                          <TrendingUp className="w-4 h-4" />
                          <span className="text-sm">Excellent fuel efficiency</span>
                        </div>
                      )}
                      
                      {metrics.maintenanceScore >= 90 && (
                        <div className="flex items-center gap-2 text-green-700">
                          <Award className="w-4 h-4" />
                          <span className="text-sm">Outstanding maintenance record</span>
                        </div>
                      )}

                      {metrics.safetyScore >= 95 && (
                        <div className="flex items-center gap-2 text-green-700">
                          <Star className="w-4 h-4" />
                          <span className="text-sm">Exceptional safety rating</span>
                        </div>
                      )}

                      {metrics.fuelEfficiency < 5 && (
                        <div className="flex items-center gap-2 text-orange-600">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-sm">Consider fuel efficiency training</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-indigo-600" />
                      Recent Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Activity Level</span>
                      {getActivityBadge(metrics.recentActivity)}
                    </div>
                    
                    {metrics.lastLoadDate && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Last Load</span>
                        <span className="text-sm font-semibold">
                          {new Date(metrics.lastLoadDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    {metrics.daysSinceLastLoad !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Days Since Last Load</span>
                        <span className="text-sm font-semibold">{metrics.daysSinceLastLoad}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Activity Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Total Loads</span>
                        <span className="text-sm font-semibold">{metrics.totalLoads}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Load Assignment Rate</span>
                        <span className="text-sm font-semibold">
                          {metrics.totalLoads > 0 ? Math.round((metrics.completedLoads / metrics.totalLoads) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}