import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, 
  MessageSquare, 
  TrendingUp, 
  Users, 
  Zap, 
  Target, 
  Clock, 
  CheckCircle,
  Activity,
  BarChart3,
  Eye,
  RefreshCw,
  Lightbulb,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Send
} from "lucide-react";
import { format, subDays } from "date-fns";

// Types
interface RealtimeSummary {
  current: {
    timestamp: string;
    activeThreads: number;
    recentMessages: number;
    aiSuggestionsToday: number;
    acceptanceRate: number;
  };
  trends: {
    weeklyMessages: number;
    weeklyAISuggestions: number;
    avgResponseTime: number;
    driverEngagement: number;
  };
}

interface AIPerformanceMetric {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  totalSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  autoSentMessages: number;
  avgConfidence: number;
  avgProcessingTimeMs: number;
  avgTokensUsed: number;
  avgTimeBetweenSuggestionAndResponseMs: number;
  suggestionAcceptanceRate: number;
}

interface DriverEngagement {
  driverId: string;
  driverName: string;
  messagesReceived: number;
  messagesSent: number;
  attachmentsSent: number;
  avgResponseTime: number;
  threadsParticipated: number;
  lastActiveAt: string;
  engagementScore: number;
  preferredResponseTime: string;
  communicationStyle: string;
}

interface ContextualRecommendation {
  id: string;
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  confidence: number;
  impact: string;
  action: string;
  context: any;
}

export default function AICommunicationInsights() {
  const [selectedDateRange, setSelectedDateRange] = useState(7); // days
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Real-time summary data
  const { data: realtimeSummary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['/api/ai-insights/realtime-summary'],
    refetchInterval: autoRefresh ? 30000 : false, // 30 seconds
  });

  // AI Performance metrics
  const { data: performanceData, isLoading: performanceLoading } = useQuery({
    queryKey: ['/api/ai-insights/performance-metrics', { 
      startDate: subDays(new Date(), selectedDateRange).toISOString(),
      endDate: new Date().toISOString() 
    }],
    refetchInterval: autoRefresh ? 60000 : false, // 1 minute
  });

  // Driver engagement data
  const { data: engagementData, isLoading: engagementLoading } = useQuery({
    queryKey: ['/api/ai-insights/driver-engagement', {
      startDate: subDays(new Date(), selectedDateRange).toISOString(),
      endDate: new Date().toISOString()
    }],
    refetchInterval: autoRefresh ? 60000 : false, // 1 minute
  });

  // Contextual recommendations
  const { data: recommendationsData, isLoading: recommendationsLoading } = useQuery({
    queryKey: ['/api/ai-insights/contextual-recommendations'],
    refetchInterval: autoRefresh ? 120000 : false, // 2 minutes
  });

  const summary = realtimeSummary as RealtimeSummary | undefined;
  const performance = performanceData?.metrics as AIPerformanceMetric[] | undefined;
  const engagement = engagementData?.engagement as DriverEngagement[] | undefined;
  const recommendations = recommendationsData?.recommendations as ContextualRecommendation[] | undefined;

  const formatMetric = (value: number, suffix: string = '') => {
    if (value === null || value === undefined) return 'N/A';
    return typeof value === 'number' ? `${value.toLocaleString()}${suffix}` : 'N/A';
  };

  const formatDuration = (ms: number) => {
    if (!ms) return 'N/A';
    const minutes = Math.floor(ms / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getEngagementColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="space-y-6 p-6" data-testid="ai-insights-dashboard">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3" data-testid="page-title">
            <Brain className="h-8 w-8 text-blue-600" />
            AI Communication Insights
          </h1>
          <p className="text-gray-600 mt-1">
            Advanced analytics and contextual insights for AI-powered communication
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="toggle-auto-refresh"
          >
            <Activity className="h-4 w-4 mr-2" />
            Auto Refresh {autoRefresh ? 'On' : 'Off'}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetchSummary()}
            data-testid="manual-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Real-time Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-active-threads">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Threads</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="metric-active-threads">
              {summaryLoading ? 'Loading...' : formatMetric(summary?.current.activeThreads || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summaryLoading ? '' : `Weekly: ${formatMetric(summary?.trends.driverEngagement || 0)} drivers`}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-ai-suggestions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Suggestions Today</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="metric-ai-suggestions">
              {summaryLoading ? 'Loading...' : formatMetric(summary?.current.aiSuggestionsToday || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summaryLoading ? '' : `Weekly: ${formatMetric(summary?.trends.weeklyAISuggestions || 0)} total`}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-acceptance-rate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Acceptance Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="metric-acceptance-rate">
              {summaryLoading ? 'Loading...' : formatMetric(summary?.current.acceptanceRate || 0, '%')}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min(summary?.current.acceptanceRate || 0, 100)}%` }}
              ></div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-response-time">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="metric-response-time">
              {summaryLoading ? 'Loading...' : formatMetric(summary?.trends.avgResponseTime || 0, ' min')}
            </div>
            <p className="text-xs text-muted-foreground">
              {summaryLoading ? '' : `Messages: ${formatMetric(summary?.trends.weeklyMessages || 0)}`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4" data-testid="main-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">AI Performance</TabsTrigger>
          <TabsTrigger value="engagement" data-testid="tab-engagement">Driver Engagement</TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">Recommendations</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* AI Performance Summary */}
            <Card data-testid="overview-ai-performance">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-600" />
                  AI Performance Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {performanceLoading ? (
                  <div>Loading performance data...</div>
                ) : performance && performance.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total Suggestions</span>
                      <span className="font-semibold">{performance[0].totalSuggestions}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Acceptance Rate</span>
                      <span className="font-semibold">{performance[0].suggestionAcceptanceRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Avg Confidence</span>
                      <span className="font-semibold">{performance[0].avgConfidence.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Processing Time</span>
                      <span className="font-semibold">{formatDuration(performance[0].avgProcessingTimeMs)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    No performance data available for the selected period
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Performers */}
            <Card data-testid="overview-top-performers">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-green-600" />
                  Driver Engagement Leaders
                </CardTitle>
              </CardHeader>
              <CardContent>
                {engagementLoading ? (
                  <div>Loading engagement data...</div>
                ) : engagement && engagement.length > 0 ? (
                  <ScrollArea className="h-64">
                    <div className="space-y-3">
                      {engagement
                        .sort((a, b) => b.engagementScore - a.engagementScore)
                        .slice(0, 5)
                        .map((driver) => (
                          <div key={driver.driverId} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                            <div>
                              <div className="font-medium">{driver.driverName}</div>
                              <div className="text-sm text-gray-600">
                                {driver.messagesSent} messages • {driver.threadsParticipated} threads
                              </div>
                            </div>
                            <Badge className={getEngagementColor(driver.engagementScore)}>
                              {driver.engagementScore.toFixed(0)}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    No engagement data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* AI Performance Tab */}
        <TabsContent value="performance" className="space-y-6">
          <Card data-testid="performance-detailed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                Detailed AI Performance Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {performanceLoading ? (
                <div className="flex justify-center py-8">Loading detailed performance data...</div>
              ) : performance && performance.length > 0 ? (
                <div className="space-y-6">
                  {performance.map((metric, index) => (
                    <div key={metric.id || index} className="border rounded-lg p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="font-semibold capitalize">{metric.period} Period</h4>
                        <span className="text-sm text-gray-600">
                          {format(new Date(metric.periodStart), 'MMM d')} - {format(new Date(metric.periodEnd), 'MMM d')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">{metric.totalSuggestions}</div>
                          <div className="text-sm text-gray-600">Suggestions</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">{metric.acceptedSuggestions}</div>
                          <div className="text-sm text-gray-600">Accepted</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-600">{metric.rejectedSuggestions}</div>
                          <div className="text-sm text-gray-600">Rejected</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">{metric.autoSentMessages}</div>
                          <div className="text-sm text-gray-600">Auto-sent</div>
                        </div>
                      </div>
                      <Separator className="my-4" />
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Acceptance Rate:</span>
                          <span className="font-semibold ml-2">{metric.suggestionAcceptanceRate.toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Avg Confidence:</span>
                          <span className="font-semibold ml-2">{metric.avgConfidence.toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Processing Time:</span>
                          <span className="font-semibold ml-2">{formatDuration(metric.avgProcessingTimeMs)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No performance data available for the selected period
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Driver Engagement Tab */}
        <TabsContent value="engagement" className="space-y-6">
          <Card data-testid="engagement-detailed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-green-600" />
                Driver Communication Engagement
              </CardTitle>
            </CardHeader>
            <CardContent>
              {engagementLoading ? (
                <div className="flex justify-center py-8">Loading engagement data...</div>
              ) : engagement && engagement.length > 0 ? (
                <div className="space-y-4">
                  {engagement
                    .sort((a, b) => b.engagementScore - a.engagementScore)
                    .map((driver) => (
                      <div key={driver.driverId} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-semibold">{driver.driverName}</h4>
                            <p className="text-sm text-gray-600">
                              Last active: {format(new Date(driver.lastActiveAt), 'MMM d, h:mm a')}
                            </p>
                          </div>
                          <Badge className={getEngagementColor(driver.engagementScore)}>
                            {driver.engagementScore.toFixed(0)} score
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Messages Sent:</span>
                            <span className="font-semibold ml-2">{driver.messagesSent}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Messages Received:</span>
                            <span className="font-semibold ml-2">{driver.messagesReceived}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Threads:</span>
                            <span className="font-semibold ml-2">{driver.threadsParticipated}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Attachments:</span>
                            <span className="font-semibold ml-2">{driver.attachmentsSent}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Response Time:</span>
                            <span className="font-semibold ml-2">{formatDuration(driver.avgResponseTime)}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Style:</span>
                            <Badge variant="outline" className="ml-2">{driver.communicationStyle}</Badge>
                          </div>
                          <div>
                            <span className="text-gray-600">Best Time:</span>
                            <Badge variant="outline" className="ml-2">{driver.preferredResponseTime}</Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No engagement data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-6">
          <Card data-testid="recommendations-detailed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-orange-600" />
                Contextual Communication Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recommendationsLoading ? (
                <div className="flex justify-center py-8">Loading recommendations...</div>
              ) : recommendations && recommendations.length > 0 ? (
                <div className="space-y-4">
                  {recommendations.map((rec) => (
                    <div key={rec.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold">{rec.title}</h4>
                            <Badge className={getPriorityColor(rec.priority)}>
                              {rec.priority}
                            </Badge>
                            <Badge variant="outline">
                              {rec.confidence}% confident
                            </Badge>
                          </div>
                          <p className="text-gray-600 mb-2">{rec.description}</p>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-green-600" />
                              <span className="text-green-600">{rec.impact}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Target className="h-4 w-4 text-blue-600" />
                              <span>{rec.action}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 ml-4">
                          <Button size="sm" variant="default" data-testid={`apply-recommendation-${rec.id}`}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Apply
                          </Button>
                          <Button size="sm" variant="outline" data-testid={`dismiss-recommendation-${rec.id}`}>
                            Dismiss
                          </Button>
                        </div>
                      </div>
                      {rec.context && Object.keys(rec.context).length > 0 && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
                          <div className="font-medium mb-1">Context:</div>
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(rec.context).map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                                <span className="font-medium">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No recommendations available at this time
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}