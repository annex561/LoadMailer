import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  MessageSquare, 
  Send, 
  Phone, 
  Mail, 
  MapPin, 
  Clock, 
  Truck, 
  User, 
  Search,
  RefreshCw,
  CheckCircle,
  Circle,
  AlertCircle,
  Camera,
  Paperclip,
  Mic,
  MoreVertical,
  Brain,
  Lightbulb,
  Zap,
  ThumbsUp,
  ThumbsDown,
  Settings,
  Sparkles,
  TrendingUp,
  Target,
  UserPlus,
  AlertTriangle,
  X
} from "lucide-react";
import { format } from "date-fns";

// Types
interface LoadCommunicationThread {
  id: string;
  loadId: string;
  driverId: string;
  driverName: string;
  driverPhone?: string;
  loadNumber: string;
  loadOrigin: string;
  loadDestination: string;
  status: 'active' | 'closed' | 'archived';
  messageCount: number;
  unreadDriverMessages: number;
  unreadDispatchMessages: number;
  lastMessageAt: string;
  lastMessageText?: string;
  lastMessageSender?: 'driver' | 'dispatch';
  assistantEnabled?: boolean;
  assistantMode?: 'suggest' | 'autosend' | 'off';
  createdAt: string;
  updatedAt: string;
}

interface LoadMessage {
  id: string;
  threadId: string;
  content: string;
  sender: 'driver' | 'dispatch';
  isRead: boolean;
  isSuggested?: boolean;
  isSent?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
}

interface QuickReplyTemplate {
  id: string;
  templateKey: string;
  displayText: string;
  messageTemplate: string;
  category: string;
  order: number;
  isActive: boolean;
  isForDriver: boolean;
  isForDispatch: boolean;
}

interface AiMessageSuggestion {
  id: string;
  threadId: string;
  suggestedText: string;
  confidence: number;
  reasoning: string;
  messageType: string;
  tone: string;
  autoSend: boolean;
  createdAt: string;
}

interface AiThreadSettings {
  assistantEnabled: boolean;
  assistantMode: 'suggest' | 'autosend' | 'off';
  autoSendConfidence: number;
  systemPrompt?: string;
}

interface ConversationInsight {
  sentiment: string;
  urgency: string;
  nextAction: string;
  estimatedResponseTime: string;
  driverMood: string;
}

interface UnassignedLoad {
  id: string;
  loadNumber: string;
  pickupAddress: string;
  deliveryAddress: string;
  status: string;
  rate?: number;
  miles?: number;
  equipmentType: string;
  priority: string;
  createdAt: string;
}

interface Driver {
  id: string;
  name: string;
  phone?: string;
  status: 'available' | 'on_route' | 'unavailable';
  equipmentType: string;
}

export default function CommunicationDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [selectedThread, setSelectedThread] = useState<LoadCommunicationThread | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showAiPanel, setShowAiPanel] = useState(true);
  const [aiComposing, setAiComposing] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showUnassignedLoads, setShowUnassignedLoads] = useState(false);
  const [selectedLoadForAssignment, setSelectedLoadForAssignment] = useState<UnassignedLoad | null>(null);
  
  // Fetch communication threads
  const { data: threads = [], isLoading: threadsLoading, refetch: refetchThreads } = useQuery<LoadCommunicationThread[]>({
    queryKey: ['/api/communication/threads'],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  // Debug logging
  useEffect(() => {
    console.log('Communication Dashboard - Threads data:', threads);
    console.log('Communication Dashboard - Threads count:', threads.length);
    if (threads.length > 0) {
      console.log('Communication Dashboard - First thread:', threads[0]);
    }
  }, [threads]);

  // Fetch messages for selected thread
  const { data: rawMessages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<any[]>({
    queryKey: ['/api/communication/messages', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return [];
      const response = await fetch(`/api/communication/messages/${selectedThread.id}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      return response.json();
    },
    enabled: !!selectedThread?.id,
    refetchInterval: 2000, // Refresh every 2 seconds for real-time chat
  });

  // Transform API response to frontend format
  const messages: LoadMessage[] = rawMessages.map(msg => ({
    id: msg.id,
    threadId: msg.threadId,
    content: msg.textContent, // ✅ Map textContent to content
    sender: msg.senderRole, // ✅ Map senderRole to sender  
    isRead: msg.isRead,
    isSuggested: msg.isSuggested,
    isSent: msg.isSent,
    approvedBy: msg.approvedBy,
    approvedAt: msg.approvedAt,
    mediaUrl: msg.mediaUrl,
    mediaType: msg.mediaType,
    createdAt: msg.createdAt
  }));

  // Fetch quick reply templates
  const { data: templates = [] } = useQuery<QuickReplyTemplate[]>({
    queryKey: ['/api/communication/quick-replies'],
    queryFn: async () => {
      const response = await fetch('/api/communication/quick-replies?role=dispatch');
      if (!response.ok) {
        console.warn('Quick replies endpoint failed, using fallback empty array');
        return []; // Return empty array if endpoint fails
      }
      const data = await response.json();
      return data.templates || data; // Handle both response formats
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      const response = await fetch(`/api/communication/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, content, sender: 'dispatch' })
      });
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    },
    onSuccess: () => {
      setNewMessage("");
      refetchMessages();
      refetchThreads();
      toast({ title: "Message sent successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to send message", description: error.message, variant: "destructive" });
    }
  });

  // Mark messages as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async ({ threadId, role }: { threadId: string; role: 'dispatch' | 'driver' }) => {
      const response = await fetch(`/api/communication/threads/${threadId}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      if (!response.ok) throw new Error('Failed to mark as read');
      return response.json();
    },
    onSuccess: () => {
      refetchThreads();
    }
  });

  // Fetch AI suggestions for selected thread
  const { data: aiSuggestions = [], isLoading: aiSuggestionsLoading, refetch: refetchAiSuggestions } = useQuery<AiMessageSuggestion[]>({
    queryKey: ['/api/ai/suggestions', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return [];
      const response = await fetch(`/api/ai/suggestions/${selectedThread.id}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedThread?.id && selectedThread?.assistantEnabled,
    refetchInterval: 5000, // Refresh AI suggestions every 5 seconds
  });

  // Get conversation insights
  const { data: conversationInsights, isLoading: insightsLoading } = useQuery<ConversationInsight>({
    queryKey: ['/api/ai/conversation-insights', selectedThread?.id],
    queryFn: async () => {
      if (!selectedThread?.id) return null;
      const response = await fetch(`/api/ai/conversation-insights/${selectedThread.id}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!selectedThread?.id && selectedThread?.assistantEnabled,
    refetchInterval: 10000, // Refresh insights every 10 seconds
  });

  // Generate AI suggestion mutation
  const generateAiSuggestionMutation = useMutation({
    mutationFn: async ({ threadId, context, messageType, tone }: { 
      threadId: string; 
      context?: string; 
      messageType?: string; 
      tone?: string; 
    }) => {
      const response = await fetch('/api/ai/suggest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, context, messageType, tone })
      });
      if (!response.ok) throw new Error('Failed to generate AI suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      toast({ title: "AI suggestion generated", description: "New suggestion available below" });
    },
    onError: (error) => {
      toast({ title: "Failed to generate AI suggestion", description: error.message, variant: "destructive" });
    }
  });

  // Approve AI suggestion mutation
  const approveAiSuggestionMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(`/api/ai/approve/${messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approverId: 'dispatcher' })
      });
      if (!response.ok) throw new Error('Failed to approve suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      refetchMessages();
      refetchThreads();
      toast({ title: "Message sent", description: "AI suggestion approved and sent" });
    },
    onError: (error) => {
      toast({ title: "Failed to send message", description: error.message, variant: "destructive" });
    }
  });

  // Reject AI suggestion mutation
  const rejectAiSuggestionMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(`/api/ai/reject/${messageId}`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to reject suggestion');
      return response.json();
    },
    onSuccess: () => {
      refetchAiSuggestions();
      toast({ title: "Suggestion dismissed" });
    }
  });

  // Fetch unassigned loads
  const { data: unassignedLoads = [], isLoading: unassignedLoadsLoading, refetch: refetchUnassignedLoads } = useQuery<UnassignedLoad[]>({
    queryKey: ['/api/loads/unassigned'],
    queryFn: async () => {
      const response = await fetch('/api/loads?status=unassigned');
      if (!response.ok) return [];
      const data = await response.json();
      return data.filter((load: any) => !load.driverId);
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch all drivers
  const { data: availableDrivers = [] } = useQuery<Driver[]>({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      if (!response.ok) return [];
      const data = await response.json();
      return data.filter((driver: any) => driver.status === 'available');
    },
  });

  // Assign driver to load mutation
  const assignDriverMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      const response = await fetch(`/api/loads/${loadId}/book-for-driver/${driverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to assign driver');
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Driver assigned successfully", description: `${data.driverName} assigned to load ${data.loadNumber}` });
      refetchUnassignedLoads();
      refetchThreads();
      setSelectedLoadForAssignment(null);
    },
    onError: (error) => {
      toast({ title: "Failed to assign driver", description: error.message, variant: "destructive" });
    }
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages as read when thread is selected
  useEffect(() => {
    if (selectedThread && selectedThread.unreadDispatchMessages > 0) {
      markAsReadMutation.mutate({ threadId: selectedThread.id, role: 'dispatch' });
    }
  }, [selectedThread]);

  // Filter and search threads
  const filteredThreads = threads.filter(thread => {
    const matchesSearch = searchTerm === "" || 
      thread.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thread.loadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thread.loadOrigin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thread.loadDestination.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || 
      (filterStatus === "active" && thread.status === "active") ||
      (filterStatus === "unread" && thread.unreadDispatchMessages > 0) ||
      (filterStatus === "archived" && thread.status === "archived");
    
    return matchesSearch && matchesStatus;
  });

  const handleSendMessage = () => {
    if (!selectedThread || !newMessage.trim()) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content: newMessage.trim() });
  };

  const handleQuickReply = (template: QuickReplyTemplate) => {
    if (!selectedThread) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content: template.messageTemplate });
  };

  const handleQuickMessage = (content: string) => {
    if (!selectedThread) return;
    sendMessageMutation.mutate({ threadId: selectedThread.id, content });
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return format(date, 'HH:mm');
    } else {
      return format(date, 'MMM dd, HH:mm');
    }
  };

  const getThreadStatusBadge = (thread: LoadCommunicationThread) => {
    if (thread.unreadDispatchMessages > 0) {
      return <Badge className="bg-red-100 text-red-800 border-red-200">{thread.unreadDispatchMessages} unread</Badge>;
    }
    if (thread.status === 'active') {
      return <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-800 border-gray-200">Archived</Badge>;
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-gray-50" data-testid="communication-dashboard">
      {/* Thread List Sidebar */}
      <div className="w-1/3 border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Communication Center</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnassignedLoads(!showUnassignedLoads)}
                className={showUnassignedLoads ? 'bg-blue-50 border-blue-300' : ''}
                data-testid="button-toggle-unassigned"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Unassigned ({unassignedLoads.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refetchThreads();
                  refetchMessages();
                  refetchUnassignedLoads();
                }}
                disabled={threadsLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 ${threadsLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          
          {/* Search and Filter */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search loads, drivers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-white border border-gray-300" data-testid="select-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Conversations</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="unread">Unread Messages</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Thread List */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {filteredThreads.map((thread) => (
              <Card
                key={thread.id}
                className={`mb-2 cursor-pointer transition-colors hover:bg-gray-50 ${
                  selectedThread?.id === thread.id ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                }`}
                onClick={() => setSelectedThread(thread)}
                data-testid={`thread-${thread.id}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-sm text-gray-900">{thread.loadNumber}</h4>
                        {getThreadStatusBadge(thread)}
                      </div>
                      <p className="text-xs text-gray-600">{thread.driverName}</p>
                      <p className="text-xs text-gray-500">
                        {thread.loadOrigin} → {thread.loadDestination}
                      </p>
                    </div>
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs bg-gray-200">
                        {thread.driverName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  
                  {thread.lastMessageText && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-600 truncate">
                        {thread.lastMessageSender === 'dispatch' ? 'You: ' : ''}
                        {thread.lastMessageText}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatMessageTime(thread.lastMessageAt)}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            
            {filteredThreads.length === 0 && !threadsLoading && (
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No conversations found</p>
                <p className="text-xs mt-1">Start communicating with drivers about their loads</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Interface */}
      <div className="flex-1 flex flex-col">
        {selectedThread ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-blue-100 text-blue-600">
                      {selectedThread.driverName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-medium text-gray-900">{selectedThread.driverName}</h3>
                    <p className="text-sm text-gray-600">Load {selectedThread.loadNumber}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {selectedThread.driverPhone && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`tel:${selectedThread.driverPhone}`, '_self')}
                      data-testid="button-call-driver"
                    >
                      <Phone className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-more-actions"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {/* Load Info & AI Controls */}
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{selectedThread.loadOrigin} → {selectedThread.loadDestination}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Truck className="w-4 h-4" />
                      <span>{selectedThread.messageCount} messages</span>
                    </div>
                  </div>
                  
                  {/* AI Assistant Controls */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant={selectedThread?.assistantEnabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        // Toggle AI assistant for this thread
                        toast({ title: "AI Assistant", description: selectedThread?.assistantEnabled ? "Disabled" : "Enabled" });
                      }}
                      data-testid="toggle-ai-assistant"
                    >
                      <Brain className="w-4 h-4 mr-1" />
                      AI {selectedThread?.assistantEnabled ? 'On' : 'Off'}
                    </Button>
                  </div>
                </div>
                
                {/* Conversation Insights */}
                {selectedThread?.assistantEnabled && conversationInsights && !insightsLoading && (
                  <div className="border-t pt-2 mt-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>AI Insights</span>
                      <Sparkles className="w-3 h-3" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <span>Sentiment: {conversationInsights.sentiment}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-orange-500" />
                        <span>Urgency: {conversationInsights.urgency}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-green-500" />
                        <span>Response: {conversationInsights.estimatedResponseTime}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3 text-purple-500" />
                        <span>Mood: {conversationInsights.driverMood}</span>
                      </div>
                    </div>
                    {conversationInsights.nextAction && (
                      <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
                        <strong>Suggested Action:</strong> {conversationInsights.nextAction}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'dispatch' ? 'justify-end' : 'justify-start'}`}
                    data-testid={`message-${message.id}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.sender === 'dispatch'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-900'
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <div className={`flex items-center justify-between mt-1 text-xs ${
                        message.sender === 'dispatch' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        <span>{formatMessageTime(message.createdAt)}</span>
                        {message.sender === 'dispatch' && (
                          <div className="flex items-center gap-1">
                            {message.isRead ? (
                              <CheckCircle className="w-3 h-3" />
                            ) : (
                              <Circle className="w-3 h-3" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* AI Suggestions Panel */}
            {selectedThread?.assistantEnabled && showAiPanel && aiSuggestions.length > 0 && (
              <div className="border-t border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-600" />
                    <h4 className="text-sm font-medium text-gray-800">AI Suggestions</h4>
                    <Badge variant="outline" className="text-xs">
                      {aiSuggestions.length} available
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAiPanel(false)}
                    data-testid="close-ai-panel"
                  >
                    ×
                  </Button>
                </div>
                
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {aiSuggestions.slice(0, 3).map((suggestion) => (
                    <div key={suggestion.id} className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-gray-800 mb-1">{suggestion.suggestedText}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Badge className="bg-blue-100 text-blue-800 text-xs">
                              {suggestion.confidence}% confident
                            </Badge>
                            <span>{suggestion.messageType}</span>
                            <span>•</span>
                            <span>{suggestion.tone}</span>
                          </div>
                          {suggestion.reasoning && (
                            <p className="text-xs text-gray-600 mt-1 italic">{suggestion.reasoning}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => approveAiSuggestionMutation.mutate(suggestion.id)}
                            disabled={approveAiSuggestionMutation.isPending}
                            data-testid={`approve-suggestion-${suggestion.id}`}
                          >
                            <ThumbsUp className="w-3 h-3 mr-1" />
                            Send
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => rejectAiSuggestionMutation.mutate(suggestion.id)}
                            disabled={rejectAiSuggestionMutation.isPending}
                            data-testid={`reject-suggestion-${suggestion.id}`}
                          >
                            <ThumbsDown className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Replies */}
            <div className="p-3 border-t border-gray-200 bg-gray-50">
              <h4 className="text-xs font-medium text-gray-700 mb-2">Quick Messages</h4>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {/* Common Dispatcher Messages */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Hi! Just a friendly reminder about your pickup today. Please confirm when you arrive at the pickup location. Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-pickup-reminder"
                >
                  📍 Pickup Reminder
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please provide an ETA for delivery. Customer is asking for updates. Thank you!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-delivery-update"
                >
                  🚚 Delivery ETA
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Hi! Can you please provide a quick status update on this load? Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-status-check"
                >
                  ❓ Status Check
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Great! Load confirmed. Please proceed to pickup location and keep me updated. Safe travels!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-load-confirmed"
                >
                  ✅ Load Confirmed
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please remember to get all required paperwork signed and send photos when pickup/delivery is complete.')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-paperwork"
                >
                  📋 Paperwork
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickMessage('Please contact the customer before arrival. Their contact info is in the load details. Thanks!')}
                  className="whitespace-nowrap text-xs"
                  data-testid="quick-reply-contact-customer"
                >
                  📞 Call Customer
                </Button>
              </div>

              {/* Show existing templates if any */}
              {templates.filter(t => t.isForDispatch && t.isActive).length > 0 && (
                <div>
                  <h5 className="text-xs font-medium text-gray-600 mb-2">Saved Templates</h5>
                  <div className="flex gap-2 overflow-x-auto">
                    {templates
                      .filter(t => t.isForDispatch && t.isActive)
                      .map((template) => (
                      <Button
                        key={template.id}
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickReply(template)}
                        className="whitespace-nowrap text-xs"
                        data-testid={`quick-reply-${template.templateKey}`}
                      >
                        {template.displayText}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Message Input with AI Smart Compose */}
            <div className="border-t border-gray-200 bg-white">
              {/* AI Quick Actions */}
              {selectedThread?.assistantEnabled && (
                <div className="px-4 pt-3 pb-2 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600">AI Assist</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              messageType: 'update',
                              tone: 'professional'
                            });
                          }
                        }}
                        disabled={generateAiSuggestionMutation.isPending}
                        data-testid="generate-ai-suggestion"
                      >
                        <Zap className="w-3 h-3 mr-1" />
                        {generateAiSuggestionMutation.isPending ? 'Generating...' : 'Suggest'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAiComposing(!aiComposing)}
                        data-testid="toggle-ai-compose"
                      >
                        <Brain className="w-3 h-3 mr-1" />
                        {aiComposing ? 'Manual' : 'AI Compose'}
                      </Button>
                    </div>
                  </div>
                  
                  {aiComposing && (
                    <div className="grid grid-cols-3 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Request status update from driver',
                              messageType: 'question',
                              tone: 'friendly'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        📅 Status Update
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Thank driver and provide encouragement',
                              messageType: 'response',
                              tone: 'friendly'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        🙏 Thank You
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: 'Address urgent delivery concern',
                              messageType: 'response',
                              tone: 'urgent'
                            });
                          }
                        }}
                        className="text-xs"
                      >
                        ⚠️ Urgent Response
                      </Button>
                    </div>
                  )}
                </div>
              )}
              
              {/* Message Input */}
              <div className="p-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <Textarea
                      placeholder={selectedThread?.assistantEnabled ? "Type your message or use AI assist..." : "Type your message..."}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      rows={1}
                      className="min-h-[40px] resize-none pr-8"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      data-testid="textarea-message"
                    />
                    {selectedThread?.assistantEnabled && newMessage.length > 10 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1 p-1"
                        onClick={() => {
                          if (selectedThread) {
                            generateAiSuggestionMutation.mutate({
                              threadId: selectedThread.id,
                              context: `Help improve this message: "${newMessage}"`,
                              messageType: 'response',
                              tone: 'professional'
                            });
                          }
                        }}
                        title="Improve with AI"
                        data-testid="improve-message-ai"
                      >
                        <Sparkles className="w-3 h-3 text-blue-500" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-attach"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      data-testid="button-send-message"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* No Thread Selected */
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">Select a conversation</h3>
              <p className="text-sm">Choose a load communication thread to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}