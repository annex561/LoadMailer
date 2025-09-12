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
  MoreVertical
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

export default function CommunicationDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [selectedThread, setSelectedThread] = useState<LoadCommunicationThread | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  
  // Fetch communication threads
  const { data: threads = [], isLoading: threadsLoading, refetch: refetchThreads } = useQuery<LoadCommunicationThread[]>({
    queryKey: ['/api/communication/threads'],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  // Fetch messages for selected thread
  const { data: messages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<LoadMessage[]>({
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

  // Fetch quick reply templates
  const { data: templates = [] } = useQuery<QuickReplyTemplate[]>({
    queryKey: ['/api/communication/quick-replies'],
    queryFn: async () => {
      const response = await fetch('/api/communication/quick-replies?role=dispatch');
      if (!response.ok) throw new Error('Failed to fetch templates');
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchThreads();
                refetchMessages();
              }}
              disabled={threadsLoading}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 ${threadsLoading ? 'animate-spin' : ''}`} />
            </Button>
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
              
              {/* Load Info */}
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
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

            {/* Quick Replies */}
            {templates.filter(t => t.isForDispatch && t.isActive).length > 0 && (
              <div className="p-2 border-t border-gray-200 bg-gray-50">
                <div className="flex gap-2 overflow-x-auto">
                  {templates
                    .filter(t => t.isForDispatch && t.isActive)
                    .slice(0, 4)
                    .map((template) => (
                    <Button
                      key={template.id}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickReply(template)}
                      className="whitespace-nowrap"
                      data-testid={`quick-reply-${template.templateKey}`}
                    >
                      {template.displayText}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Input */}
            <div className="p-4 border-t border-gray-200 bg-white">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Textarea
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={1}
                    className="min-h-[40px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    data-testid="textarea-message"
                  />
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