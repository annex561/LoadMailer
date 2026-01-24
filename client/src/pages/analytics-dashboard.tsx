import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, TrendingUp, TrendingDown, DollarSign, Truck, Users, MapPin, Clock, Target, Award, AlertCircle, BarChart3, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface DashboardMetrics {
  totalRevenue: number;
  totalLoads: number;
  activeDrivers: number;
  averageDeliveryTime: number;
  onTimeDeliveryRate: number;
  topPerformingDriver: {
    name: string;
    performance: number;
  };
  monthlyGrowth: number;
  recentTrends: {
    revenueChange: number;
    loadChange: number;
    driverUtilization: number;
  };
}

interface DriverPerformance {
  driverId: string;
  driverName: string;
  loadsCompleted: number;
  onTimeDeliveries: number;
  totalRevenue: number;
  efficiency: number;
  rating: number;
  trends: {
    period: string;
    change: number;
  };
}

interface CustomerInsight {
  customerId: string;
  customerName: string;
  totalLoads: number;
  totalRevenue: number;
  averageOrderValue: number;
  lastOrderDate: string;
  loyaltyScore: number;
  growthRate: number;
}

interface RevenueMetrics {
  totalRevenue: number;
  monthOverMonthGrowth: number;
  revenueByPeriod: Array<{
    period: string;
    revenue: number;
  }>;
  topCustomers: Array<{
    customer: string;
    revenue: number;
    percentage: number;
  }>;
}

interface CommunicationInsight {
  id: string;
  insightType: string;
  insightData: any;
  periodStart: string;
  periodEnd: string;
  period: string;
  createdAt: string;
}

interface AiPerformanceMetric {
  id: string;
  threadId: string;
  driverId: string;
  totalSuggestions: number;
  acceptedSuggestions: number;
  totalAutoSends: number;
  averageConfidence: number;
  periodStart: string;
  periodEnd: string;
  period: string;
  createdAt: string;
  suggestionAcceptanceRate?: number;
}

interface DriverEngagementMetric {
  id: string;
  driverId: string;
  totalMessages: number;
  totalResponseTime: number;
  averageResponseTime: number;
  messagesWithMedia: number;
  quickReplyUsage: number;
  periodStart: string;
  periodEnd: string;
  period: string;
  createdAt: string;
}

export default function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [timePeriod, setTimePeriod] = useState("monthly");
  const [selectedTab, setSelectedTab] = useState("overview");

  // Dashboard Overview Data
  const { data: dashboardData, isLoading: dashboardLoading, refetch: refetchDashboard } = useQuery<DashboardMetrics>({
    queryKey: ["/api/analytics/dashboard"],
    refetchInterval: 30000, // Refresh every 30 seconds for real-time data
  });

  // Driver Performance Data
  const { data: driverPerformance = [], isLoading: driverLoading, refetch: refetchDrivers } = useQuery<DriverPerformance[]>({
    queryKey: ["/api/analytics/driver-performance", timePeriod, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const params = new URLSearchParams({ period: timePeriod });
      if (dateRange?.from) params.append('startDate', dateRange.from.toISOString());
      if (dateRange?.to) params.append('endDate', dateRange.to.toISOString());
      
      return fetch(`/api/analytics/driver-performance?${params}`)
        .then(res => res.json());
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Customer Insights Data
  const { data: customerInsights = [], isLoading: customerLoading, refetch: refetchCustomers } = useQuery<CustomerInsight[]>({
    queryKey: ["/api/analytics/customer-insights", timePeriod, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const params = new URLSearchParams({ period: timePeriod });
      if (dateRange?.from) params.append('startDate', dateRange.from.toISOString());
      if (dateRange?.to) params.append('endDate', dateRange.to.toISOString());
      
      return fetch(`/api/analytics/customer-insights?${params}`)
        .then(res => res.json());
    },
    refetchInterval: 60000,
  });

  // Revenue Analytics Data
  const { data: revenueData, isLoading: revenueLoading, refetch: refetchRevenue } = useQuery<RevenueMetrics>({
    queryKey: ["/api/analytics/revenue", timePeriod, dateRange?.from, dateRange?.to],
    queryFn: () => {
      const params = new URLSearchParams({ period: timePeriod });
      if (dateRange?.from) params.append('startDate', dateRange.from.toISOString());
      if (dateRange?.to) params.append('endDate', dateRange.to.toISOString());
      
      return fetch(`/api/analytics/revenue?${params}`)
        .then(res => res.json());
    },
    refetchInterval: 60000,
  });

  // Load Trends Data
  const { data: loadTrends, isLoading: trendsLoading, refetch: refetchTrends } = useQuery({
    queryKey: ["/api/analytics/load-trends", 30],
    queryFn: () => fetch(`/api/analytics/load-trends?days=30`).then(res => res.json()),
    refetchInterval: 60000,
  });

  // Communication Insights Data
  const { data: communicationInsights = [], isLoading: commInsightsLoading, refetch: refetchCommInsights } = useQuery<CommunicationInsight[]>({
    queryKey: ["/api/communication/insights", dateRange?.from, dateRange?.to],
    queryFn: () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDate = dateRange?.from || thirtyDaysAgo;
      const endDate = dateRange?.to || now;
      
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      return fetch(`/api/communication/insights?${params}`)
        .then(res => res.json())
        .then(data => data.insights || []);
    },
    refetchInterval: 60000,
  });

  // AI Performance Metrics Data
  const { data: aiPerformanceMetrics = [], isLoading: aiPerfLoading, refetch: refetchAiPerf } = useQuery<AiPerformanceMetric[]>({
    queryKey: ["/api/communication/ai-performance", dateRange?.from, dateRange?.to],
    queryFn: () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDate = dateRange?.from || thirtyDaysAgo;
      const endDate = dateRange?.to || now;
      
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      return fetch(`/api/communication/ai-performance?${params}`)
        .then(res => res.json())
        .then(data => data.metrics || []);
    },
    refetchInterval: 60000,
  });

  // Driver Engagement Metrics Data
  const { data: driverEngagementMetrics = [], isLoading: driverEngLoading, refetch: refetchDriverEng } = useQuery<DriverEngagementMetric[]>({
    queryKey: ["/api/communication/driver-engagement", dateRange?.from, dateRange?.to],
    queryFn: () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDate = dateRange?.from || thirtyDaysAgo;
      const endDate = dateRange?.to || now;
      
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      return fetch(`/api/communication/driver-engagement?${params}`)
        .then(res => res.json())
        .then(data => data.metrics || []);
    },
    refetchInterval: 60000,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const formatPercentage = (value: number) => {
    return `${(value || 0).toFixed(1)}%`;
  };

  const getPerformanceColor = (score: number) => {
    if (score >= 85) return "text-green-600 bg-green-50 border-green-200";
    if (score >= 70) return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  const getTrendIcon = (change: number) => {
    return change >= 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />;
  };

  const refreshAllData = () => {
    refetchDashboard();
    refetchDrivers();
    refetchCustomers();
    refetchRevenue();
    refetchTrends();
    refetchCommInsights();
    refetchAiPerf();
    refetchDriverEng();
  };

  const isLoading = dashboardLoading || driverLoading || customerLoading || revenueLoading || trendsLoading || commInsightsLoading || aiPerfLoading || driverEngLoading;

  return (
    <div className="p-6 space-y-6" data-testid="analytics-dashboard">
      {/* Header Section */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Fleet Analytics Dashboard</h1>
          <p className="text-gray-500 mt-1">Real-time insights and performance metrics</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Select value={timePeriod} onValueChange={setTimePeriod}>
              <SelectTrigger className="w-40 bg-white border border-gray-300" data-testid="select-time-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="bg-white border border-gray-300" data-testid="button-date-range">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white border border-gray-300 shadow-lg" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>

          <Button 
            onClick={refreshAllData}
            variant="outline" 
            size="sm" 
            disabled={isLoading}
            className="bg-white border border-gray-300"
            data-testid="button-refresh-data"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-white border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900" data-testid="metric-total-revenue">
                  {formatCurrency(dashboardData?.totalRevenue || 0)}
                </p>
                <div className="flex items-center mt-1">
                  {getTrendIcon(dashboardData?.recentTrends?.revenueChange || 0)}
                  <span className="text-sm ml-1 text-gray-500">
                    {formatPercentage(Math.abs(dashboardData?.recentTrends?.revenueChange || 0))} vs last month
                  </span>
                </div>
              </div>
              <div className="h-12 w-12 bg-blue-500 rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Drivers</p>
                <p className="text-2xl font-bold text-gray-900" data-testid="metric-active-drivers">
                  {dashboardData?.activeDrivers || 0}
                </p>
                <div className="flex items-center mt-1">
                  <div className="flex -space-x-1">
                    <div className="w-3 h-3 bg-green-500 rounded-full border border-white"></div>
                    <div className="w-3 h-3 bg-blue-500 rounded-full border border-white"></div>
                    <div className="w-3 h-3 bg-orange-500 rounded-full border border-white"></div>
                  </div>
                  <span className="text-sm ml-2 text-gray-500">
                    {formatPercentage(dashboardData?.recentTrends?.driverUtilization || 0)} utilization
                  </span>
                </div>
              </div>
              <div className="h-12 w-12 bg-green-500 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed Loads</p>
                <p className="text-2xl font-bold text-gray-900" data-testid="metric-completed-loads">
                  {dashboardData?.totalLoads || 0}
                </p>
                <div className="flex items-center mt-1">
                  {getTrendIcon(dashboardData?.recentTrends?.loadChange || 0)}
                  <span className="text-sm ml-1 text-gray-500">
                    {formatPercentage(Math.abs(dashboardData?.recentTrends?.loadChange || 0))} vs last month
                  </span>
                </div>
              </div>
              <div className="h-12 w-12 bg-purple-500 rounded-lg flex items-center justify-center">
                <Truck className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">On-Time Rate</p>
                <p className="text-2xl font-bold text-gray-900" data-testid="metric-ontime-rate">
                  {formatPercentage(dashboardData?.onTimeDeliveryRate || 0)}
                </p>
                <div className="mt-1">
                  <Progress 
                    value={dashboardData?.onTimeDeliveryRate || 0} 
                    className="w-full h-2"
                  />
                </div>
              </div>
              <div className="h-12 w-12 bg-orange-500 rounded-lg flex items-center justify-center">
                <Clock className="w-6 h-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 bg-white border border-gray-200">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="drivers" data-testid="tab-drivers">Driver Performance</TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customers">Customer Insights</TabsTrigger>
          <TabsTrigger value="revenue" data-testid="tab-revenue">Revenue Analysis</TabsTrigger>
          <TabsTrigger value="communication" data-testid="tab-communication">Communication AI</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top Performing Driver */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-yellow-500" />
                  Top Performer
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashboardData?.topPerformingDriver ? (
                  <div className="text-center">
                    <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Award className="w-8 h-8 text-yellow-600" />
                    </div>
                    <p className="font-semibold text-lg" data-testid="top-performer-name">
                      {dashboardData.topPerformingDriver.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {formatPercentage(dashboardData.topPerformingDriver.performance)} efficiency
                    </p>
                    <Badge className="mt-2 bg-yellow-100 text-yellow-800 border-yellow-200">
                      Champion
                    </Badge>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    <Award className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No data available</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Load Trends Summary */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  30-Day Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadTrends?.summary ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Loads</span>
                      <span className="font-medium" data-testid="summary-total-loads">
                        {loadTrends.summary.totalLoads}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Daily Average</span>
                      <span className="font-medium" data-testid="summary-daily-average">
                        {Math.round(loadTrends.summary.averageDaily)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Completion Rate</span>
                      <span className="font-medium" data-testid="summary-completion-rate">
                        {formatPercentage(loadTrends.summary.completionRate)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Total Revenue</span>
                      <span className="font-medium text-green-600" data-testid="summary-total-revenue">
                        {formatCurrency(loadTrends.summary.totalRevenue)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>Loading trends...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Alert Section */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                  Alerts & Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dashboardData?.onTimeDeliveryRate && dashboardData.onTimeDeliveryRate < 85 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-red-800">Low On-Time Rate</p>
                          <p className="text-xs text-red-600">
                            Current rate: {formatPercentage(dashboardData.onTimeDeliveryRate)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {dashboardData?.recentTrends?.revenueChange && dashboardData.recentTrends.revenueChange < -10 && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <TrendingDown className="w-4 h-4 text-yellow-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800">Revenue Decline</p>
                          <p className="text-xs text-yellow-600">
                            Down {formatPercentage(Math.abs(dashboardData.recentTrends.revenueChange))} this month
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {dashboardData?.recentTrends?.driverUtilization && dashboardData.recentTrends.driverUtilization > 85 && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Target className="w-4 h-4 text-green-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-green-800">Excellent Utilization</p>
                          <p className="text-xs text-green-600">
                            {formatPercentage(dashboardData.recentTrends.driverUtilization)} driver efficiency
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="drivers" className="space-y-6">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle>Driver Performance Ranking</CardTitle>
              <p className="text-sm text-gray-500">
                Performance based on efficiency, on-time delivery, and revenue generation
              </p>
            </CardHeader>
            <CardContent>
              {driverPerformance.length > 0 ? (
                <div className="space-y-4">
                  {driverPerformance.slice(0, 10).map((driver, index) => (
                    <div 
                      key={driver.driverId} 
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                      data-testid={`driver-performance-${index}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-sm font-medium">
                          #{index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{driver.driverName}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span>{driver.loadsCompleted} loads</span>
                            <span>
                              {formatPercentage((driver.onTimeDeliveries / driver.loadsCompleted) * 100)} on-time
                            </span>
                            <span>{formatCurrency(driver.totalRevenue)} revenue</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-medium">{formatPercentage(driver.efficiency)}</p>
                          <div className="flex items-center gap-1">
                            {getTrendIcon(driver.trends.change)}
                            <span className="text-xs text-gray-500">
                              {formatPercentage(Math.abs(driver.trends.change))}
                            </span>
                          </div>
                        </div>
                        <Badge className={getPerformanceColor(driver.efficiency)}>
                          {driver.efficiency >= 85 ? 'Excellent' : driver.efficiency >= 70 ? 'Good' : 'Needs Attention'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No driver performance data available</p>
                  <p className="text-sm">Complete some loads to see performance metrics</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Customers by Revenue */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle>Top Customers by Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                {customerInsights.length > 0 ? (
                  <div className="space-y-3">
                    {customerInsights.slice(0, 5).map((customer, index) => (
                      <div 
                        key={customer.customerId}
                        className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                        data-testid={`top-customer-${index}`}
                      >
                        <div>
                          <p className="font-medium">{customer.customerName}</p>
                          <div className="flex items-center gap-3 text-sm text-gray-500">
                            <span>{customer.totalLoads} loads</span>
                            <span>{formatCurrency(customer.averageOrderValue)} avg</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-green-600">
                            {formatCurrency(customer.totalRevenue)}
                          </p>
                          <div className="flex items-center gap-1">
                            {getTrendIcon(customer.growthRate)}
                            <span className="text-xs text-gray-500">
                              {formatPercentage(Math.abs(customer.growthRate))}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No customer data available</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Loyalty Scores */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle>Customer Loyalty Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                {customerInsights.length > 0 ? (
                  <div className="space-y-4">
                    {customerInsights
                      .sort((a, b) => b.loyaltyScore - a.loyaltyScore)
                      .slice(0, 5)
                      .map((customer, index) => (
                      <div 
                        key={customer.customerId}
                        className="space-y-2"
                        data-testid={`loyal-customer-${index}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{customer.customerName}</span>
                          <span className="text-sm text-gray-500">
                            Score: {customer.loyaltyScore.toFixed(1)}
                          </span>
                        </div>
                        <Progress value={customer.loyaltyScore} className="h-2" />
                        <p className="text-xs text-gray-500">
                          Last order: {format(new Date(customer.lastOrderDate), "MMM dd, yyyy")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No loyalty data available</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="revenue" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Revenue Growth */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                  Revenue Growth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900" data-testid="revenue-growth">
                    {formatPercentage(revenueData?.monthOverMonthGrowth || 0)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Month over Month</p>
                  <div className="flex items-center justify-center mt-2">
                    {getTrendIcon(revenueData?.monthOverMonthGrowth || 0)}
                    <span className="text-sm ml-1">
                      {(revenueData?.monthOverMonthGrowth || 0) >= 0 ? 'Growth' : 'Decline'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total Revenue */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-blue-500" />
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600" data-testid="total-revenue">
                    {formatCurrency(revenueData?.totalRevenue || 0)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Current Period</p>
                </div>
              </CardContent>
            </Card>

            {/* Revenue Per Customer */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-500" />
                  Avg per Customer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-600" data-testid="avg-per-customer">
                    {formatCurrency(
                      revenueData?.topCustomers?.length 
                        ? revenueData.totalRevenue / revenueData.topCustomers.length 
                        : 0
                    )}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Average Value</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Revenue Customers */}
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle>Revenue Breakdown by Customer</CardTitle>
            </CardHeader>
            <CardContent>
              {revenueData?.topCustomers?.length ? (
                <div className="space-y-4">
                  {revenueData.topCustomers.slice(0, 8).map((customer, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between"
                      data-testid={`revenue-customer-${index}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{customer.customer}</span>
                          <span className="text-sm text-gray-500">
                            {formatPercentage(customer.percentage)}
                          </span>
                        </div>
                        <Progress value={customer.percentage} className="h-2" />
                      </div>
                      <div className="ml-4 text-right">
                        <span className="font-medium text-green-600">
                          {formatCurrency(customer.revenue)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No revenue data available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communication" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* AI Performance Summary */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-500" />
                  AI Communication Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aiPerformanceMetrics.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Total Suggestions</p>
                        <p className="text-2xl font-bold text-gray-900" data-testid="ai-total-suggestions">
                          {aiPerformanceMetrics.reduce((sum, metric) => sum + metric.totalSuggestions, 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Accepted</p>
                        <p className="text-2xl font-bold text-green-600" data-testid="ai-accepted-suggestions">
                          {aiPerformanceMetrics.reduce((sum, metric) => sum + metric.acceptedSuggestions, 0)}
                        </p>
                      </div>
                    </div>
                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Acceptance Rate</span>
                        <span className="text-sm font-medium">
                          {formatPercentage(
                            aiPerformanceMetrics.reduce((sum, metric) => sum + metric.totalSuggestions, 0) > 0
                              ? (aiPerformanceMetrics.reduce((sum, metric) => sum + metric.acceptedSuggestions, 0) / 
                                 aiPerformanceMetrics.reduce((sum, metric) => sum + metric.totalSuggestions, 0)) * 100
                              : 0
                          )}
                        </span>
                      </div>
                      <Progress 
                        value={
                          aiPerformanceMetrics.reduce((sum, metric) => sum + metric.totalSuggestions, 0) > 0
                            ? (aiPerformanceMetrics.reduce((sum, metric) => sum + metric.acceptedSuggestions, 0) / 
                               aiPerformanceMetrics.reduce((sum, metric) => sum + metric.totalSuggestions, 0)) * 100
                            : 0
                        } 
                        className="h-2" 
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No AI performance data available</p>
                    <p className="text-xs mt-1">Start using AI suggestions to see metrics</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Driver Engagement Summary */}
            <Card className="bg-white border border-gray-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-500" />
                  Driver Communication Engagement
                </CardTitle>
              </CardHeader>
              <CardContent>
                {driverEngagementMetrics.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Total Messages</p>
                        <p className="text-2xl font-bold text-gray-900" data-testid="driver-total-messages">
                          {driverEngagementMetrics.reduce((sum, metric) => sum + metric.totalMessages, 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Avg Response Time</p>
                        <p className="text-2xl font-bold text-blue-600" data-testid="driver-avg-response-time">
                          {driverEngagementMetrics.length > 0 
                            ? Math.round(
                                driverEngagementMetrics.reduce((sum, metric) => sum + metric.averageResponseTime, 0) / 
                                driverEngagementMetrics.length / 60
                              )
                            : 0}m
                        </p>
                      </div>
                    </div>
                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Media Usage</span>
                        <span className="text-sm font-medium">
                          {driverEngagementMetrics.reduce((sum, metric) => sum + metric.messagesWithMedia, 0)} attachments
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Quick Reply Usage</span>
                        <span className="text-sm font-medium">
                          {driverEngagementMetrics.reduce((sum, metric) => sum + metric.quickReplyUsage, 0)} used
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No engagement data available</p>
                    <p className="text-xs mt-1">Communication activity will appear here</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Communication Insights List */}
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-500" />
                Communication Insights & Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {communicationInsights.length > 0 ? (
                <div className="space-y-4">
                  {communicationInsights.map((insight) => (
                    <div 
                      key={insight.id}
                      className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                      data-testid={`insight-${insight.id}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">
                              {insight.insightType}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {insight.period} period
                            </span>
                          </div>
                          <div className="text-sm text-gray-800 mb-2">
                            <strong>Period:</strong> {format(new Date(insight.periodStart), 'MMM dd, yyyy')} - {format(new Date(insight.periodEnd), 'MMM dd, yyyy')}
                          </div>
                          {insight.insightData && (
                            <div className="text-sm text-gray-600 bg-gray-50 rounded p-2">
                              <pre className="whitespace-pre-wrap text-xs">
                                {typeof insight.insightData === 'string' 
                                  ? insight.insightData 
                                  : JSON.stringify(insight.insightData, null, 2)
                                }
                              </pre>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 ml-4">
                          {format(new Date(insight.createdAt), 'MMM dd, HH:mm')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No communication insights available</p>
                  <p className="text-xs mt-1">Insights will be generated as communication data is processed</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}