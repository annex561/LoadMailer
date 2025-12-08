import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
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
import ManualDispatch from './manual-dispatch';
import GoogleSheetsImport from './google-sheets-import';
import DriverManagement from './driver-management';
import DriverOnboarding from './driver-onboarding';
import SimpleDriverRegistration from './simple-driver-registration';
import Contacts from './contacts';
import SmsDispatching from './sms-dispatching';
import LoadmailerControl from './loadmailer-control';
import TelegramDispatching from './telegram-dispatching';
import Templates from './templates';
import SmartLoadMatching from './smart-load-matching';
import AnalyticsDashboard from './analytics-dashboard';
import PredictiveMaintenancePage from './predictive-maintenance';
import GPSTracking from './gps-tracking';
import PaymentWorkflow from './payment-workflow';
import PredictionConfidence from './prediction-confidence';
import { MoodTracker } from './mood-tracker';
import ScraperManagement from './scraper-management';
import SmsStatus from './sms-status';
import DebugToken from './debug-token';
import DriverDashboard from './driver-dashboard';
import DispatcherDashboard from './dispatcher-dashboard';
import DispatcherVehicleDashboard from './dispatcher-vehicle-dashboard';
import DocumentManagement from './document-management';
import { TaskMagicStatusPage } from './taskmagic-status';
import DATScraper from './DATScraper';
import DatLogin from './dat-login';
import AdminOverview from './admin-overview';
import CommunicationDashboard from './communication-dashboard';
import AICommunicationInsights from './ai-communication-insights';
import FleetCalculator from './fleet-calculator';
import UnifiedMessaging from './unified-messaging';
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

const CommunicationCard: React.FC<{ 
  thread: any; 
  drivers: Driver[];
  loads: any[];
  onSendMessage: (driverId: string, message: string) => void;
}> = ({ thread, drivers, loads, onSendMessage }) => {
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
    if (!thread.id) return;
    
    setIsLoadingAI(true);
    try {
      const response = await fetch('/api/ai/suggest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
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
      const response = await fetch(`/api/ai/thread/${thread.id}/settings`, {
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
      const response = await fetch(`/api/ai/thread/${thread.id}/settings`, {
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
      const response = await fetch(`/api/ai/thread/${thread.id}/settings`, {
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
    <div className="border border-border rounded-lg p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">{driver?.name || "Unknown Driver"}</span>
          <Badge variant={priority === "HIGH" ? "destructive" : priority === "MEDIUM" ? "secondary" : "outline"}>
            {priority}
          </Badge>
          {unreadCount > 0 && (
            <Badge variant="default" className="bg-primary">
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
          data-testid={`button-ai-assistant-${thread.id}`}
        >
          🤖 AI
        </Button>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground mb-3">
        <div><span className="font-medium text-foreground">Phone:</span> {driver?.phone || "Not provided"}</div>
        <div><span className="font-medium text-foreground">Status:</span> {driver?.status || "Unknown"}</div>
        <div><span className="font-medium text-foreground">Total Messages:</span> {thread.messageCount || 0}</div>
        <div><span className="font-medium text-foreground">Last Contact:</span> {lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : "No messages"}</div>
      </div>
      
      {lastMessage && (
        <div className="text-sm text-muted-foreground mb-3 p-2 bg-muted/50 rounded border-l-4 border-primary/30">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-foreground">{lastMessage.isFromDriver ? "Driver" : "Dispatch"}</span>
            {lastMessage.loadNumber && (
              <Badge variant="outline" className="text-xs">
                Load: {lastMessage.loadNumber}
              </Badge>
            )}
          </div>
          <p className="text-foreground">{lastMessage.message}</p>
        </div>
      )}

      {/* AI Assistant Panel */}
      {showAiAssistant && (
        <div className="mb-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-foreground">AI Communication Assistant</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={getAiSuggestion}
              disabled={isLoadingAI || !assistantEnabled}
              className="h-6 px-2 text-xs bg-card"
              data-testid={`button-get-suggestion-${thread.id}`}
            >
              {isLoadingAI ? '🔄' : '💡'} Suggest
            </Button>
          </div>

          {/* AI Assistant Configuration */}
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">AI Assistant</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAiAssistant(!assistantEnabled)}
                className={`h-6 px-2 text-xs ${assistantEnabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                data-testid={`button-toggle-assistant-${thread.id}`}
              >
                {assistantEnabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
            
            {assistantEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Mode</label>
                  <select
                    value={assistantMode}
                    onChange={(e) => updateAssistantMode(e.target.value)}
                    className="h-6 px-2 text-xs border border-border rounded bg-card text-foreground"
                    data-testid={`select-assistant-mode-${thread.id}`}
                  >
                    <option value="off">Off</option>
                    <option value="suggest">Suggest Only</option>
                    <option value="autosend">Auto-Send</option>
                  </select>
                </div>
                
                {assistantMode === 'autosend' && (
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Auto-Send Threshold</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="50"
                        max="95"
                        step="5"
                        value={autoSendConfidence}
                        onChange={(e) => updateAutoSendConfidence(parseInt(e.target.value))}
                        className="w-16 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                        data-testid={`slider-autosend-confidence-${thread.id}`}
                      />
                      <span className="text-xs text-primary w-8">{autoSendConfidence}%</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          {!assistantEnabled && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded mb-2">
              AI assistant is disabled for this thread. Enable it above to get message suggestions.
            </div>
          )}
          
          {aiSuggestion && assistantEnabled && (
            <div className="space-y-2">
              <div className="bg-card p-2 rounded border border-border text-sm">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Suggested Response</span>
                  <Badge variant="outline" className="text-xs">
                    {Math.round(aiSuggestion.confidence)}% confidence
                  </Badge>
                </div>
                <p className="text-foreground">{aiSuggestion.suggestedText}</p>
                {aiSuggestion.reasoning && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <em>{aiSuggestion.reasoning}</em>
                  </p>
                )}
                {aiSuggestion.shouldAutoSend && (
                  <div className="text-xs text-success mt-1 flex items-center gap-1">
                    ⚡ High confidence - would auto-send if enabled
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={useAiSuggestion}
                  className="h-6 px-2 text-xs bg-card"
                  data-testid={`button-use-suggestion-${thread.id}`}
                >
                  Use This
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={dismissAiSuggestion}
                  className="h-6 px-2 text-xs bg-card"
                  data-testid={`button-dismiss-suggestion-${thread.id}`}
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
          className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          data-testid={`message-input-${thread.id}`}
        />
        <Button 
          onClick={handleSendMessage}
          disabled={!messageText.trim()}
          size="sm"
          className="bg-primary hover:bg-primary/90"
          data-testid={`send-message-${thread.id}`}
        >
          Send SMS
        </Button>
      </div>
    </div>
  );
};

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
      case '/manual-dispatch':
        return <ManualDispatch />;
      case '/google-sheets-import':
        return <GoogleSheetsImport />;
      case '/driver-management':
        return <DriverManagement />;
      case '/contacts':
        return <Contacts />;
      case '/sms-dispatching':
        return <SmsDispatching />;
      case '/loadmailer-control':
        return <LoadmailerControl />;
      case '/telegram-dispatching':
        return <TelegramDispatching />;
      case '/templates':
        return <Templates />;
      case '/dispatcher-vehicle-dashboard':
        return <DispatcherVehicleDashboard />;
      case '/gps-tracking':
        return <GPSTracking />;
      case '/smart-load-matching':
        return <SmartLoadMatching />;
      case '/prediction-confidence':
        return <PredictionConfidence />;
      case '/predictive-maintenance':
        return <PredictiveMaintenancePage />;
      case '/mood-tracker':
        return <MoodTracker />;
      case '/payments':
        return <PaymentWorkflow />;
      case '/document-management':
        return <DocumentManagement />;
      case '/taskmagic-status':
        return <TaskMagicStatusPage />;
      case '/analytics':
        return <AnalyticsDashboard />;
      case '/fleet-calculator':
        return <FleetCalculator />;
      case '/scrapers':
        return <ScraperManagement />;
      case '/sms-status':
        return <SmsStatus />;
      case '/debug-token':
        return <DebugToken />;
      case '/dispatcher':
      case '/dispatcher-dashboard':
        return <DispatcherDashboard />;
      case '/dat-scraper':
        return <DATScraper />;
      case '/dat-login':
        return <DatLogin />;
      case '/admin-overview':
        return <AdminOverview />;
      case '/communication-dashboard':
        return <CommunicationDashboard />;
      case '/ai-communication-insights':
        return <AICommunicationInsights />;
      case '/unified-messaging':
        return <UnifiedMessaging />;
      case '/twilio-settings':
        return <div className="p-6"><h1 className="text-2xl font-bold">Twilio Settings</h1><p className="mt-4 text-muted-foreground">Twilio configuration page coming soon.</p></div>;
      case '/driver-tracker':
        return <div className="p-6"><h1 className="text-2xl font-bold">Driver Tracker</h1><p className="mt-4 text-muted-foreground">Driver tracking page coming soon.</p></div>;
      case '/driver-profile':
        return <div className="p-6"><h1 className="text-2xl font-bold">Driver Profile</h1><p className="mt-4 text-muted-foreground">Driver profile page coming soon.</p></div>;
      default:
        return <NotFound />;
    }
  };

  // Function to render the main LoadOps dashboard content
  const renderDashboardContent = () => {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Finance Performance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {financeMetrics.map((metric, index) => {
            const colorMap: Record<string, string> = {
              'text-blue-600': 'primary',
              'text-green-600': 'success',
              'text-purple-600': 'primary',
              'text-orange-600': 'warning'
            };
            const colorKey = colorMap[metric.color] || 'primary';
            const bgColors: Record<string, string> = {
              primary: 'bg-primary/10',
              success: 'bg-success/10',
              warning: 'bg-warning/10'
            };
            const textColors: Record<string, string> = {
              primary: 'text-primary',
              success: 'text-success',
              warning: 'text-warning'
            };
            const barColors: Record<string, string> = {
              primary: 'bg-primary',
              success: 'bg-success',
              warning: 'bg-warning'
            };
            return (
              <Card key={index} className="relative overflow-hidden border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{metric.title}</p>
                      <div className="mt-2">
                        <p className={cn("text-2xl font-bold", textColors[colorKey])}>{metric.value}</p>
                        <p className="text-xs text-muted-foreground">{metric.target}</p>
                      </div>
                    </div>
                    <div className={cn("p-3 rounded-xl", bgColors[colorKey])}>
                      <metric.icon className={cn("w-6 h-6", textColors[colorKey])} />
                    </div>
                  </div>
                  <div className="mt-4 bg-muted rounded-full h-2">
                    <div 
                      className={cn("h-2 rounded-full transition-all duration-500", barColors[colorKey])}
                      style={{ width: `${metric.percentage}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Second Row - Operational Summary, Availability, and Safety */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Trip Operational Summary */}
          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Trip Operational Summary</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-3">Open Trips</p>
                  <div className="w-24 h-24 mx-auto bg-primary/10 rounded-full flex items-center justify-center border-4 border-primary/20">
                    <span className="text-3xl font-bold text-primary">{loads.length}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Items Available</p>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-3">Assigned Trips</p>
                  <div className="w-24 h-24 mx-auto bg-success/10 rounded-full flex items-center justify-center border-4 border-success/20">
                    <span className="text-3xl font-bold text-success">
                      {loads.filter((l: any) => l.driverId).length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Assigned Trips</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Driver & Tractor Availability */}
          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Driver Availability</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-6">
                {availabilityMetrics.map((metric, index) => (
                  <div key={index}>
                    <p className="text-sm font-medium text-muted-foreground mb-3">{metric.title}</p>
                    <div className="flex justify-center gap-8">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mb-2 border-2 border-destructive/30">
                          <span className="text-base font-bold text-destructive">{metric.unavailable}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Not Available</p>
                      </div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mb-2 border-2 border-success/30">
                          <span className="text-base font-bold text-success">{metric.available}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Available</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Safety Metrics */}
          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Safety Metrics</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-4">
                {safetyMetrics.map((metric, index) => (
                  <div key={index} className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">{metric.title}</span>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-lg font-bold",
                        metric.status === 'good' ? 'text-foreground' :
                        metric.status === 'warning' ? 'text-foreground' : 'text-foreground'
                      )}>
                        {metric.value}
                      </span>
                      <div className={cn("w-3 h-3 rounded-full", 
                        metric.status === 'good' ? 'bg-success' :
                        metric.status === 'warning' ? 'bg-warning' : 'bg-destructive'
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Communication Dispatch Command Center */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          <Card className="lg:col-span-2 xl:col-span-2 border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Driver Conversations (Unified Messaging)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {threads.length > 0 ? (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {threads.slice(0, 6).map((thread: any) => (
                    <CommunicationCard 
                      key={thread.id} 
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
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                  <p>No driver conversations yet</p>
                  <p className="text-sm mt-2">Unified conversations will appear when drivers send messages</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dispatch Quick Stats */}
          <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Headphones className="w-5 h-5 text-primary" />
                Dispatch Center Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/10">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-primary rounded-full" />
                    <span className="text-sm font-medium text-muted-foreground">Active Threads</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">
                    {threads.filter((t: any) => t.unreadCount > 0).length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-success/5 rounded-lg border border-success/10">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-success rounded-full" />
                    <span className="text-sm font-medium text-muted-foreground">Available Drivers</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">
                    {drivers.filter((d: any) => d.status === "available").length}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-warning/5 rounded-lg border border-warning/10">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-warning rounded-full" />
                    <span className="text-sm font-medium text-muted-foreground">Total Messages</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">
                    {threads.reduce((sum: number, t: any) => sum + (t.messageCount || 0), 0)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/10">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-primary rounded-full" />
                    <span className="text-sm font-medium text-muted-foreground">En Route</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">
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
      // Find or create communication thread for this driver
      const thread = threads?.find((t: any) => t.driverId === driverId);
      
      if (!thread) {
        throw new Error('No communication thread found for this driver');
      }
      
      return apiRequest("POST", "/api/communication/messages", {
        threadId: thread.id,
        content: message,
        sender: "dispatch"
      });
    },
    onSuccess: () => {
      toast({
        title: "Message sent via SMS",
        description: "Your message has been sent to the driver and logged to the thread",
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
    { name: 'Main Dashboard', href: '/loadops-dashboard', icon: Home, section: 'core' },
    { name: 'Loads', href: '/loads', icon: FileText, section: 'core' },
    { name: 'DAT Loads', href: '/dat-loads', icon: Truck, section: 'core' },
    { name: 'Manual Load Entry', href: '/manual-load-entry', icon: FileText, section: 'core' },
    
    // Driver Management
    { name: 'Driver Management', href: '/driver-management', icon: Users, section: 'drivers' },
    { name: 'Driver Onboarding', href: '/driver-onboarding', icon: UserPlus, section: 'drivers' },
    { name: 'Simple Registration', href: '/simple-registration', icon: User, section: 'drivers' },
    { name: 'Driver Dashboard', href: '/driver-dashboard', icon: User, section: 'drivers' },
    { name: 'GPS Tracking', href: '/gps-tracking', icon: MapPin, section: 'drivers' },
    
    // Customer & Communication
    { name: 'Customers', href: '/contacts', icon: Users, section: 'comm' },
    { name: 'Driver Messages', href: '/communication-dashboard', icon: MessageSquare, section: 'comm' },
    { name: 'AI Communication Insights', href: '/ai-communication-insights', icon: Brain, section: 'comm' },
    { name: 'LoadMailer Control', href: '/loadmailer-control', icon: Mail, section: 'comm' },
    { name: 'Telegram Dispatching', href: '/telegram-dispatching', icon: MessageSquare, section: 'comm' },
    { name: 'SMS Status', href: '/sms-status', icon: MessageSquare, section: 'comm' },
    
    // AI & Smart Features
    { name: 'Smart Load Matching', href: '/smart-load-matching', icon: Brain, section: 'smart' },
    { name: 'Analytics Dashboard', href: '/analytics', icon: BarChart3, section: 'smart' },
    { name: 'Fleet Profit Calculator', href: '/fleet-calculator', icon: DollarSign, section: 'smart' },
    { name: 'Predictive Maintenance', href: '/predictive-maintenance', icon: Wrench, section: 'smart' },
    { name: 'Prediction Confidence', href: '/prediction-confidence', icon: Brain, section: 'smart' },
    
    // System & Reports
    { name: 'Admin Overview', href: '/admin-overview', icon: Settings, section: 'system' },
    { name: 'Payment Workflow', href: '/payments', icon: DollarSign, section: 'system' },
    { name: 'Templates', href: '/templates', icon: FileText, section: 'system' },
    { name: 'Scraper Management', href: '/scrapers', icon: Bot, section: 'system' },
    { name: 'Debug Token', href: '/debug-token', icon: Wrench, section: 'system' },
    { name: 'Dispatcher Dashboard', href: '/dispatcher', icon: Headphones, section: 'system' },
    { name: 'Dispatcher Vehicle Dashboard', href: '/dispatcher-vehicle-dashboard', icon: Truck, section: 'system' },
    { name: 'Document Management', href: '/document-management', icon: FileText, section: 'system' },
    { name: 'DAT Scraper', href: '/dat-scraper', icon: Bot, section: 'system' },
    { name: 'DAT Login', href: '/dat-login', icon: Webhook, section: 'system' },
    { name: 'SMS Dispatching', href: '/sms-dispatching', icon: MessageSquare, section: 'system' },
    { name: 'TaskMagic Status', href: '/taskmagic-status', icon: Webhook, section: 'system' }
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-[hsl(var(--sidebar))] border-r border-[hsl(var(--sidebar-border))] transition-all duration-300 flex flex-col shadow-xl",
          sidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sidebar-border">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3">
              <img src="/traq-logo.png" alt="TRAQ IQ" className="w-8 h-8 object-contain" />
              <h2 className="text-xl font-bold text-sidebar-foreground">TRAQ IQ</h2>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 text-sidebar-foreground hover:text-primary hover:bg-sidebar-accent"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto py-4">
          {/* Core Operations Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2">
              <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wide">Core Operations</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "core").map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-all duration-200 relative group rounded-lg",
                      sidebarCollapsed 
                        ? "px-2 justify-center mx-2" 
                        : "px-4 mx-2",
                      isActive
                        ? "text-primary bg-sidebar-accent border-r-3 border-primary shadow-md"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3",
                      isActive && "text-primary"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Driver Management Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wide">Driver Management</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "drivers").map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-all duration-200 relative group rounded-lg",
                      sidebarCollapsed 
                        ? "px-2 justify-center mx-2" 
                        : "px-4 mx-2",
                      isActive
                        ? "text-primary bg-sidebar-accent border-r-3 border-primary shadow-md"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3",
                      isActive && "text-primary"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Customer & Communication Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wide">Communication</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "comm").map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-all duration-200 relative group rounded-lg",
                      sidebarCollapsed 
                        ? "px-2 justify-center mx-2" 
                        : "px-4 mx-2",
                      isActive
                        ? "text-primary bg-sidebar-accent border-r-3 border-primary shadow-md"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3",
                      isActive && "text-primary"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* AI & Smart Features Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wide">AI & Smart Features</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "smart").map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-all duration-200 relative group rounded-lg",
                      sidebarCollapsed 
                        ? "px-2 justify-center mx-2" 
                        : "px-4 mx-2",
                      isActive
                        ? "text-primary bg-sidebar-accent border-r-3 border-primary shadow-md"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3",
                      isActive && "text-primary"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* System & Reports Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wide">System & Reports</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "system").map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-all duration-200 relative group rounded-lg",
                      sidebarCollapsed 
                        ? "px-2 justify-center mx-2" 
                        : "px-4 mx-2",
                      isActive
                        ? "text-primary bg-sidebar-accent border-r-3 border-primary shadow-md"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3",
                      isActive && "text-primary"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col", sidebarCollapsed ? "ml-16" : "ml-64")}>
        {/* Top Header - Only show on dashboard */}
        {(location === '/' || location === '/loadops-dashboard') && (
          <header className="h-16 bg-card border-b border-border px-6 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Finance Performance</h1>
              <p className="text-xs text-muted-foreground">Aug 19, 2025 - Aug 19, 2025</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="button-quick-reminder">
                Quick Reminder
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="button-last-revenue">
                Last Revenue
              </Button>
              <Button size="sm" className="h-8 text-xs" data-testid="button-actual">
                Actual
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="button-projected">
                Projected
              </Button>
            </div>
          </header>
        )}

        {/* Page Content */}
        <main className={cn("flex-1 overflow-auto bg-background", (location === '/' || location === '/loadops-dashboard') ? "p-6" : "")}>
          {renderContent()}
        </main>
      </div>
    </div>
  );
}