import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Menu, 
  X, 
  Home, 
  Truck, 
  FileText, 
  Users, 
  BarChart3, 
  Settings, 
  MapPin,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Headphones,
  Bot,
  MessageSquare,
  UserPlus,
  Brain,
  Wrench,
  Smile,
  Mail,
  Webhook,
  ChevronLeft,
  ChevronRight,
  Radio
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Import page components
import Dashboard from './dashboard';
import Loads from './loads';
import DatLoads from './dat-loads';
import ManualLoadEntry from './manual-load-entry';
import DriverManagement from './driver-management';
import DriverOnboarding from './driver-onboarding';
import SimpleDriverRegistration from './simple-driver-registration';
import Contacts from './contacts';
import LoadmailerControl from './loadmailer-control';
import TelegramDispatching from './telegram-dispatching';
import SmartLoadMatching from './smart-load-matching';
import AnalyticsDashboard from './analytics-dashboard';
import PredictiveMaintenancePage from './predictive-maintenance';
import GPSTracking from './gps-tracking';
import PaymentWorkflow from './payment-workflow';
import PredictionConfidence from './prediction-confidence';
import Templates from './templates';
import ScraperManagement from './scraper-management';
import SmsStatus from './sms-status';
import DebugToken from './debug-token';
import DriverDashboard from './driver-dashboard';
import DispatcherDashboard from './dispatcher-dashboard';
import DispatcherVehicleDashboard from './dispatcher-vehicle-dashboard';
import DocumentManagement from './DocumentManagement';
import DATScraper from './DATScraper';
import DatLogin from './dat-login';
import AdminOverview from './admin-overview';
import ManualDispatch from './manual-dispatch';
import CommunicationDashboard from './communication-dashboard';
import ZelloChannelsDashboard from './zello-channels-dashboard';
import AICommunicationInsights from './ai-communication-insights';
import NotFound from './not-found';
import DriverLocationMap from '@/components/driver-location-map';

interface FinanceMetric {
  title: string;
  value: string;
  target: string;
  percentage: number;
  color: string;
  icon: any;
}

interface SafetyMetric {
  title: string;
  value: number;
  color: string;
  status: 'warning' | 'good' | 'critical';
}

interface AvailabilityMetric {
  title: string;
  available: number;
  unavailable: number;
  total: number;
}

interface Communication {
  id: string;
  threadId: string;
  loadNumber?: string;
  driverId: string;
  message: string;
  messageType: "text" | "image" | "document";
  fileUrl?: string;
  createdAt: string;
  isFromDriver: boolean;
}

interface Driver {
  id: string;
  name: string;
  status: string;
  telegramId?: string;
}

function CommunicationCard({ thread, drivers, loads, onSendMessage }: { 
  thread: any; 
  drivers: Driver[];
  loads: any[];
  onSendMessage: (driverId: string, message: string) => void;
}) {
  const [messageText, setMessageText] = useState("");
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  
  // Local state for AI configuration to handle updates properly
  const [assistantEnabled, setAssistantEnabled] = useState(thread.assistantEnabled || false);
  const [assistantMode, setAssistantMode] = useState(thread.assistantMode || 'suggest');
  const [autoSendConfidence, setAutoSendConfidence] = useState(thread.autoSendConfidence || 80);
  
  const { toast } = useToast();
  
  const driver = drivers?.find(d => d.id === thread.driverId);
  const load = loads?.find(l => l.id === thread.loadId);
  const unreadCount = thread.unreadDispatchMessages || 0;
  const lastMessage = thread.lastMessage;
  
  const priority = unreadCount > 3 ? "HIGH" : unreadCount > 0 ? "MEDIUM" : "LOW";
  
  const handleSendMessage = () => {
    if (messageText.trim() && thread.driverId) {
      onSendMessage(thread.driverId, messageText.trim());
      setMessageText("");
      setAiSuggestion(null);
    }
  };

  const getAiSuggestion = async () => {
    if (!thread.threadId) return;
    
    setIsLoadingAI(true);
    try {
      const response = await fetch('/api/ai/suggest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.threadId,
          context: lastMessage?.textContent || lastMessage?.message || '',
          messageType: 'response',
          tone: 'professional'
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.suggestion) {
          setAiSuggestion(result.suggestion);
        } else {
          toast({ title: result.error || 'AI assistant unavailable', variant: 'destructive' });
        }
      } else {
        toast({ title: 'AI assistant unavailable', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to get AI suggestion:', error);
      toast({ title: 'AI assistant unavailable', variant: 'destructive' });
    } finally {
      setIsLoadingAI(false);
    }
  };

  const useAiSuggestion = async () => {
    if (!aiSuggestion?.suggestedText || !aiSuggestion?.messageId) return;
    
    try {
      // Approve the AI suggestion in the backend
      const response = await fetch(`/api/ai/approve/${aiSuggestion.messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverId: 'dispatcher' })
      });
      
      if (response.ok) {
        // Fill the input with the approved suggestion
        setMessageText(aiSuggestion.suggestedText);
        setAiSuggestion(null);
        toast({ 
          title: 'AI suggestion approved',
          description: 'The suggestion has been added to your message. Review and send when ready.'
        });
      } else {
        toast({ title: 'Failed to approve suggestion', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to approve AI suggestion:', error);
      toast({ title: 'Failed to approve suggestion', variant: 'destructive' });
    }
  };

  const dismissAiSuggestion = async () => {
    if (!aiSuggestion?.messageId) {
      setAiSuggestion(null);
      return;
    }
    
    try {
      // Reject the AI suggestion in the backend
      const response = await fetch(`/api/ai/reject/${aiSuggestion.messageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectedBy: 'dispatcher' })
      });
      
      if (response.ok) {
        setAiSuggestion(null);
        toast({ 
          title: 'AI suggestion dismissed',
          description: 'The suggestion has been rejected and removed.'
        });
      } else {
        // Even if backend fails, clear the suggestion from UI
        setAiSuggestion(null);
        toast({ title: 'Suggestion dismissed', description: 'Backend update may have failed.' });
      }
    } catch (error) {
      console.error('Failed to reject AI suggestion:', error);
      setAiSuggestion(null);
      toast({ title: 'Suggestion dismissed', description: 'Backend update may have failed.' });
    }
  };

  const toggleAiAssistant = async (enabled: boolean) => {
    try {
      const response = await fetch(`/api/ai/thread/${thread.threadId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          assistantEnabled: enabled,
          assistantMode: assistantMode,
          autoSendConfidence: autoSendConfidence
        })
      });
      
      if (response.ok) {
        setAssistantEnabled(enabled);
        toast({ 
          title: `AI Assistant ${enabled ? 'enabled' : 'disabled'}`,
          description: `AI suggestions are now ${enabled ? 'available' : 'disabled'} for this thread.`
        });
      } else {
        toast({ title: 'Failed to update AI assistant settings', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to toggle AI assistant:', error);
      toast({ title: 'Failed to update AI assistant settings', variant: 'destructive' });
    }
  };

  const updateAssistantMode = async (mode: string) => {
    try {
      const response = await fetch(`/api/ai/thread/${thread.threadId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          assistantEnabled: assistantEnabled,
          assistantMode: mode,
          autoSendConfidence: autoSendConfidence
        })
      });
      
      if (response.ok) {
        setAssistantMode(mode);
        toast({ 
          title: 'AI mode updated',
          description: `AI assistant mode set to ${mode}`
        });
      } else {
        toast({ title: 'Failed to update AI mode', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to update AI mode:', error);
      toast({ title: 'Failed to update AI mode', variant: 'destructive' });
    }
  };

  const updateAutoSendConfidence = async (confidence: number) => {
    try {
      const response = await fetch(`/api/ai/thread/${thread.threadId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          assistantEnabled: assistantEnabled,
          assistantMode: assistantMode,
          autoSendConfidence: confidence
        })
      });
      
      if (response.ok) {
        setAutoSendConfidence(confidence);
      } else {
        toast({ title: 'Failed to update auto-send threshold', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to update auto-send threshold:', error);
      toast({ title: 'Failed to update auto-send threshold', variant: 'destructive' });
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">{thread.loadNumber || thread.threadId}</span>
          <Badge variant={priority === "HIGH" ? "destructive" : priority === "MEDIUM" ? "secondary" : "outline"}>
            {priority}
          </Badge>
          {unreadCount > 0 && (
            <Badge variant="default" className="bg-blue-600">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        
        {/* AI Assistant Toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAiAssistant(!showAiAssistant)}
          className="h-6 px-2 text-xs"
          data-testid={`button-ai-assistant-${thread.threadId}`}
        >
          🤖 AI
        </Button>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-3">
        <div><span className="font-medium">Driver:</span> {driver?.name || "Unknown"}</div>
        <div><span className="font-medium">Load:</span> {thread.loadNumber || "General"}</div>
        <div><span className="font-medium">Messages:</span> {thread.messageCount || 0}</div>
        <div><span className="font-medium">Last Contact:</span> {lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : "No messages"}</div>
      </div>
      
      {lastMessage && (
        <p className="text-sm text-gray-700 mb-3 p-2 bg-gray-50 rounded border-l-4 border-gray-300">
          <span className="font-medium">{lastMessage.isFromDriver ? "Driver: " : "Dispatch: "}</span>
          {lastMessage.message}
        </p>
      )}

      {/* AI Assistant Panel */}
      {showAiAssistant && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-blue-800">AI Communication Assistant</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={getAiSuggestion}
              disabled={isLoadingAI || !assistantEnabled}
              className="h-6 px-2 text-xs bg-white"
              data-testid={`button-get-suggestion-${thread.threadId}`}
            >
              {isLoadingAI ? '🔄' : '💡'} Suggest
            </Button>
          </div>

          {/* AI Assistant Configuration */}
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-blue-700">AI Assistant</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAiAssistant(!assistantEnabled)}
                className={`h-6 px-2 text-xs ${assistantEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                data-testid={`button-toggle-assistant-${thread.threadId}`}
              >
                {assistantEnabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
            
            {assistantEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-blue-700">Mode</label>
                  <select
                    value={assistantMode}
                    onChange={(e) => updateAssistantMode(e.target.value)}
                    className="h-6 px-2 text-xs border border-gray-300 rounded bg-white"
                    data-testid={`select-assistant-mode-${thread.threadId}`}
                  >
                    <option value="off">Off</option>
                    <option value="suggest">Suggest Only</option>
                    <option value="autosend">Auto-Send</option>
                  </select>
                </div>
                
                {assistantMode === 'autosend' && (
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-blue-700">Auto-Send Threshold</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="50"
                        max="95"
                        step="5"
                        value={autoSendConfidence}
                        onChange={(e) => updateAutoSendConfidence(parseInt(e.target.value))}
                        className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        data-testid={`slider-autosend-confidence-${thread.threadId}`}
                      />
                      <span className="text-xs text-blue-600 w-8">{autoSendConfidence}%</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          {!assistantEnabled && (
            <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded mb-2">
              AI assistant is disabled for this thread. Enable it above to get message suggestions.
            </div>
          )}
          
          {aiSuggestion && assistantEnabled && (
            <div className="space-y-2">
              <div className="bg-white p-2 rounded border text-sm">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs text-gray-500">Suggested Response</span>
                  <Badge variant="outline" className="text-xs">
                    {Math.round(aiSuggestion.confidence)}% confidence
                  </Badge>
                </div>
                <p className="text-gray-800">{aiSuggestion.suggestedText}</p>
                {aiSuggestion.reasoning && (
                  <p className="text-xs text-gray-500 mt-1">
                    <em>{aiSuggestion.reasoning}</em>
                  </p>
                )}
                {aiSuggestion.shouldAutoSend && (
                  <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    ⚡ High confidence - would auto-send if enabled
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={useAiSuggestion}
                  className="h-6 px-2 text-xs bg-white"
                  data-testid={`button-use-suggestion-${thread.threadId}`}
                >
                  Use This
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={dismissAiSuggestion}
                  className="h-6 px-2 text-xs bg-white"
                  data-testid={`button-dismiss-suggestion-${thread.threadId}`}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      
      <div className="flex gap-2">
        <input 
          type="text"
          placeholder="Type a message..."
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`message-input-${thread.threadId}`}
        />
        <Button 
          onClick={handleSendMessage}
          disabled={!messageText.trim()}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700"
          data-testid={`send-message-${thread.threadId}`}
        >
          Send Telegram
        </Button>
      </div>
    </div>
  );
}

export default function LoadOpsDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Function to render content based on current route
  const renderContent = () => {
    switch (location) {
      case '/':
      case '/loadops-dashboard':
        return renderDashboardContent();
      case '/dashboard':
        return <Dashboard />;
      case '/loads':
        return <Loads />;
      case '/dat-loads':
        return <DatLoads />;
      case '/manual-load-entry':
        return <ManualLoadEntry />;
      case '/drivers':
        return <DriverManagement />;
      case '/driver-onboarding':
        return <DriverOnboarding />;
      case '/simple-registration':
        return <SimpleDriverRegistration />;
      case '/customers':
        return <Contacts />;
      case '/loadmailer-control':
        return <LoadmailerControl />;
      case '/telegram-dispatching':
        return <TelegramDispatching />;
      case '/smart-load-matching':
        return <SmartLoadMatching />;
      case '/analytics-dashboard':
        return <AnalyticsDashboard />;
      case '/predictive-maintenance':
        return <PredictiveMaintenancePage />;
      case '/gps-tracking':
        return <GPSTracking />;
      case '/payment-workflow':
        return <PaymentWorkflow />;
      case '/prediction-confidence':
        return <PredictionConfidence />;
      case '/templates':
        return <Templates />;
      case '/scraper-management':
        return <ScraperManagement />;
      case '/sms-status':
        return <SmsStatus />;
      case '/debug-token':
        return <DebugToken />;
      case '/driver-dashboard':
        return <DriverDashboard />;
      case '/dispatcher-dashboard':
        return <DispatcherDashboard />;
      case '/dispatcher-vehicle-dashboard':
        return <DispatcherVehicleDashboard />;
      case '/document-management':
        return <DocumentManagement />;
      case '/dat-scraper':
        return <DATScraper />;
      case '/dat-login':
        return <DatLogin />;
      case '/admin-overview':
        return <AdminOverview />;
      case '/manual-dispatch':
        return <ManualDispatch />;
      case '/communication-dashboard':
        return <CommunicationDashboard />;
      case '/zello-channels':
        return <ZelloChannelsDashboard />;
      case '/ai-communication-insights':
        return <AICommunicationInsights />;
      default:
        return <NotFound />;
    }
  };

  // Function to render the main LoadOps dashboard content
  const renderDashboardContent = () => {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Finance Performance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {financeMetrics.map((metric, index) => (
            <Card key={index} className="relative overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{metric.title}</p>
                    <div className="mt-2">
                      <p className={cn("text-2xl font-bold", metric.color)}>{metric.value}</p>
                      <p className="text-xs text-gray-500">{metric.target}</p>
                    </div>
                  </div>
                  <div className={cn("p-3 rounded-full bg-gray-100")}>
                    <metric.icon className={cn("w-6 h-6", metric.color)} />
                  </div>
                </div>
                <div className="mt-4 bg-gray-200 rounded-full h-2">
                  <div 
                    className={cn("h-2 rounded-full", 
                      metric.color.includes('blue') ? 'bg-blue-600' :
                      metric.color.includes('green') ? 'bg-green-600' :
                      metric.color.includes('purple') ? 'bg-purple-600' : 'bg-orange-600'
                    )}
                    style={{ width: `${metric.percentage}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Second Row - Operational Summary, Availability, and Invoices */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trip Operational Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Trip Operational Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600 mb-4">Open Trips</p>
                  <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl font-bold text-blue-600">{loads.length}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Items Available</p>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-gray-600 mb-4">Assigned Trips</p>
                  <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl font-bold text-red-600">
                      {loads.filter((l: any) => l.driverId).length}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Assigned Trips</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Driver & Tractor Availability */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Driver Availability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {availabilityMetrics.map((metric, index) => (
                  <div key={index}>
                    <p className="text-sm text-gray-600 mb-3">{metric.title}</p>
                    <div className="flex justify-center space-x-8">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-lg font-bold text-red-600">{metric.unavailable}</span>
                        </div>
                        <p className="text-xs text-gray-500">Not Available</p>
                      </div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-lg font-bold text-green-600">{metric.available}</span>
                        </div>
                        <p className="text-xs text-gray-500">Available</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Safety Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Safety Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {safetyMetrics.map((metric, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{metric.title}</span>
                    <div className="flex items-center space-x-2">
                      <span className={cn("text-lg font-bold", metric.color)}>
                        {metric.value}
                      </span>
                      <div className={cn("w-3 h-3 rounded-full", 
                        metric.status === 'good' ? 'bg-green-500' :
                        metric.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Communication Dispatch Command Center */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          <Card className="lg:col-span-2 xl:col-span-2">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Active Communication Threads
              </CardTitle>
            </CardHeader>
            <CardContent>
              {threads.length > 0 ? (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {threads.slice(0, 6).map((thread: any) => (
                    <CommunicationCard 
                      key={thread.threadId} 
                      thread={thread} 
                      drivers={drivers}
                      loads={loads}
                      onSendMessage={(driverId: string, message: string) => 
                        sendMessageMutation.mutate({ driverId, message })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No active communication threads</p>
                  <p className="text-sm mt-2">Threads will appear when drivers send messages</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dispatch Quick Stats */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Headphones className="w-5 h-5" />
                Dispatch Center Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-medium">Active Threads</span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">
                    {threads.filter((t: any) => t.unreadCount > 0).length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium">Available Drivers</span>
                  </div>
                  <span className="text-lg font-bold text-green-600">
                    {drivers.filter((d: any) => d.status === "available").length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-orange-600" />
                    <span className="text-sm font-medium">Total Messages</span>
                  </div>
                  <span className="text-lg font-bold text-orange-600">
                    {threads.reduce((sum: number, t: any) => sum + (t.messageCount || 0), 0)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    <span className="text-sm font-medium">En Route</span>
                  </div>
                  <span className="text-lg font-bold text-purple-600">
                    {drivers.filter((d: any) => d.status === "on_route").length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Driver Location Map */}
        <div className="mt-8">
          <DriverLocationMap />
        </div>
      </div>
    );
  };

  // Fetch dashboard data
  const { data: dashboardStats } = useQuery({
    queryKey: ['/api/dashboard-stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard-stats');
      return response.json();
    }
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }
  });

  const { data: loads = [] } = useQuery({
    queryKey: ['/api/loads'],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }
  });

  const { data: driverLocations } = useQuery({
    queryKey: ['/api/driver-locations/active'],
    queryFn: async () => {
      const response = await fetch('/api/driver-locations/active');
      return response.json();
    },
    refetchInterval: 30000
  });

  // Fetch load communication threads for dispatch command center
  const { data: threads = [] } = useQuery({
    queryKey: ['/api/communication/threads'],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  // Send message mutation - now load-specific
  const sendMessageMutation = useMutation({
    mutationFn: async ({ driverId, message }: { driverId: string; message: string }) => {
      // Find the active load for this driver to get loadId
      const driverLoad = loads?.find((load: any) => load.driverId === driverId && load.status === 'assigned');
      if (!driverLoad) {
        throw new Error('No active load found for this driver');
      }
      
      return apiRequest(`/api/communication/send-message`, {
        method: "POST",
        body: { loadId: driverLoad.id, message, messageType: "text" }
      });
    },
    onSuccess: () => {
      toast({
        title: "Message sent via Telegram",
        description: "Your message has been sent to the driver and logged to the load thread",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/communication/threads"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Sample data for finance metrics
  const financeMetrics: FinanceMetric[] = [
    {
      title: "Total Revenue",
      value: "$234,567",
      target: "Target: $250,000",
      percentage: 94,
      color: "text-blue-600",
      icon: DollarSign
    },
    {
      title: "Active Loads",
      value: dashboardStats?.activeLoads?.toString() || "0",
      target: "In Progress",
      percentage: 75,
      color: "text-green-600",
      icon: Truck
    },
    {
      title: "Driver Utilization",
      value: "87%",
      target: "Target: 90%",
      percentage: 87,
      color: "text-purple-600",
      icon: User
    },
    {
      title: "Fuel Efficiency",
      value: "6.8 MPG",
      target: "Target: 7.0 MPG",
      percentage: 97,
      color: "text-orange-600",
      icon: TrendingUp
    }
  ];

  // Sample safety metrics
  const safetyMetrics: SafetyMetric[] = [
    {
      title: "Safety Score",
      value: 98,
      color: "text-green-600",
      status: "good"
    },
    {
      title: "Accidents (30d)",
      value: 0,
      color: "text-green-600",
      status: "good"
    },
    {
      title: "Violations",
      value: 2,
      color: "text-yellow-600",
      status: "warning"
    }
  ];

  // Sample availability metrics
  const availabilityMetrics: AvailabilityMetric[] = [
    {
      title: "Drivers",
      available: drivers.filter((d: any) => d.status === 'available').length,
      unavailable: drivers.filter((d: any) => d.status !== 'available').length,
      total: drivers.length
    },
    {
      title: "Tractors",
      available: 8,
      unavailable: 2,
      total: 10
    }
  ];

  // Navigation items organized by sections
  const navigation = [
    // Core Operations
    { name: 'LoadOps Dashboard', href: '/loadops-dashboard', icon: Home, section: 'core' },
    { name: 'Dashboard', href: '/dashboard', icon: BarChart3, section: 'core' },
    { name: 'Loads', href: '/loads', icon: FileText, section: 'core' },
    { name: 'DAT Loads', href: '/dat-loads', icon: Truck, section: 'core' },
    { name: 'Manual Load Entry', href: '/manual-load-entry', icon: FileText, section: 'core' },
    
    // Driver Management
    { name: 'Driver Management', href: '/drivers', icon: Users, section: 'drivers' },
    { name: 'Driver Onboarding', href: '/driver-onboarding', icon: UserPlus, section: 'drivers' },
    { name: 'Simple Registration', href: '/simple-registration', icon: User, section: 'drivers' },
    { name: 'Driver Dashboard', href: '/driver-dashboard', icon: User, section: 'drivers' },
    { name: 'GPS Tracking', href: '/gps-tracking', icon: MapPin, section: 'drivers' },
    
    // Customer & Communication
    { name: 'Customers', href: '/customers', icon: Users, section: 'comm' },
    { name: 'Communication Dashboard', href: '/communication-dashboard', icon: MessageSquare, section: 'comm' },
    { name: 'Zello Channels', href: '/zello-channels', icon: Radio, section: 'comm' },
    { name: 'AI Communication Insights', href: '/ai-communication-insights', icon: Brain, section: 'comm' },
    { name: 'LoadMailer Control', href: '/loadmailer-control', icon: Mail, section: 'comm' },
    { name: 'Telegram Dispatching', href: '/telegram-dispatching', icon: MessageSquare, section: 'comm' },
    { name: 'SMS Status', href: '/sms-status', icon: MessageSquare, section: 'comm' },
    
    // AI & Smart Features
    { name: 'Smart Load Matching', href: '/smart-load-matching', icon: Brain, section: 'smart' },
    { name: 'Analytics Dashboard', href: '/analytics-dashboard', icon: BarChart3, section: 'smart' },
    { name: 'Predictive Maintenance', href: '/predictive-maintenance', icon: Wrench, section: 'smart' },
    { name: 'Prediction Confidence', href: '/prediction-confidence', icon: Brain, section: 'smart' },
    
    // System & Reports
    { name: 'Admin Overview', href: '/admin-overview', icon: Settings, section: 'system' },
    { name: 'Payment Workflow', href: '/payment-workflow', icon: DollarSign, section: 'system' },
    { name: 'Templates', href: '/templates', icon: FileText, section: 'system' },
    { name: 'Scraper Management', href: '/scraper-management', icon: Bot, section: 'system' },
    { name: 'Debug Token', href: '/debug-token', icon: Wrench, section: 'system' },
    { name: 'Dispatcher Dashboard', href: '/dispatcher-dashboard', icon: Headphones, section: 'system' },
    { name: 'Dispatcher Vehicle Dashboard', href: '/dispatcher-vehicle-dashboard', icon: Truck, section: 'system' },
    { name: 'Document Management', href: '/document-management', icon: FileText, section: 'system' },
    { name: 'DAT Scraper', href: '/dat-scraper', icon: Bot, section: 'system' },
    { name: 'DAT Login', href: '/dat-login', icon: Webhook, section: 'system' },
    { name: 'Settings', href: '/settings', icon: Settings, section: 'system' }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-64"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          {!sidebarCollapsed && (
            <h2 className="text-xl font-semibold text-gray-900">Load Signal</h2>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {/* Core Operations Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Core Operations</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "core").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Driver Management Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Driver Management</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "drivers").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Customer & Communication Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Communication</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "comm").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* AI & Smart Features Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI & Smart Features</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "smart").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* System & Reports Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">System & Reports</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "system").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col overflow-hidden", sidebarCollapsed ? "ml-16" : "ml-64")}>
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Finance Performance for Company</h1>
              <p className="text-sm text-gray-500">Aug 19, 2025 - Aug 19, 2025</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" size="sm" data-testid="button-quick-reminder">
                Quick Reminder
              </Button>
              <Button variant="outline" size="sm" data-testid="button-last-revenue">
                Last Revenue
              </Button>
              <Button size="sm" data-testid="button-actual">
                Actual
              </Button>
              <Button variant="outline" size="sm" data-testid="button-projected">
                Projected
              </Button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-6">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}