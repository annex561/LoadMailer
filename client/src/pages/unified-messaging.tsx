import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Send, Truck, Phone, MessageCircle, FileText, CheckCircle, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMessageNotification } from "@/hooks/useNotificationSound";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Driver {
  id: string;
  name: string;
  phone: string;
  equipmentType?: string;
  status?: string;
}

interface CommunicationThread {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  loadNumber: string | null;
  loadNumberFromLoad: string | null;
  messageCount: number;
  unreadDispatchMessages: number;
  unreadDriverMessages?: number;
  lastMessageAt: string;
  lastMessageText?: string;
  lastMessageSender?: string;
  lastMessageSenderRole?: 'driver' | 'dispatch' | null;
  threadType: string;
  // Enhanced fields for consolidated view
  driverStatus?: string; // "Active" or "Available"
  currentLoadNumber?: string; // Current active load number (separate from thread.loadNumber)
  driverEquipmentType?: string;
  driverMood?: string;
}

interface Message {
  id: string;
  threadId: string;
  loadId: string | null;
  senderId: string | null;
  senderRole: string;
  senderName: string;
  messageType: string;
  textContent: string;
  metadata?: {
    loadNumber?: string;
    isStatusUpdate?: boolean;
    documentId?: string;
    documentType?: string;
    documentStatus?: string;
    mediaUrl?: string;
  };
  createdAt: string;
  isRead: boolean;
}

interface LoadDocument {
  id: string;
  loadId: string;
  documentType: string;
  approvalStatus: string;
  fileUrl: string;
  uploadedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export default function UnifiedMessaging() {
  const { toast } = useToast();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all drivers
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch communication threads (all types)
  const { data: allThreads = [], isLoading: threadsLoading } = useQuery<CommunicationThread[]>({
    queryKey: ["/api/communication/threads"],
    refetchInterval: 3000, // Poll every 3 seconds
  });

  // Filter to show ONLY unified active threads (one per driver)
  const threads = allThreads.filter(thread => 
    thread.threadType === 'unified' && thread.status === 'active'
  );

  // Fetch messages for selected thread
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/communication/messages", selectedThreadId],
    enabled: !!selectedThreadId,
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Play notification sound for new incoming messages
  useMessageNotification(messages, !!selectedThreadId);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      console.log("📤 Sending message:", { threadId, content });
      const response = await apiRequest("POST", `/api/communication/messages`, {
        threadId,
        content,
        sender: "dispatch"
      });
      const data = await response.json();
      console.log("✅ Message sent successfully:", data);
      return data;
    },
    onSuccess: (_data, variables) => {
      console.log("🔄 Message sent, refreshing queries...");
      // Use the threadId from the mutation variables to avoid stale closure
      queryClient.invalidateQueries({ queryKey: ["/api/communication/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication/messages", variables.threadId] });
      setMessageText("");
      toast({
        title: "Message sent",
        description: "Your message has been delivered",
      });
    },
    onError: (error: any) => {
      console.error("❌ Failed to send message:", error);
      toast({
        title: "Failed to send message",
        description: error.message || "An error occurred while sending your message",
        variant: "destructive",
      });
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedThreadId) return;
    sendMessageMutation.mutate({
      threadId: selectedThreadId,
      content: messageText.trim(),
    });
  };

  // Filter threads by search
  const filteredThreads = threads.filter(thread =>
    thread.driverName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    thread.driverPhone?.includes(searchTerm) ||
    thread.loadNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get selected thread details
  const selectedThread = threads.find(t => t.id === selectedThreadId);
  const selectedDriver = drivers.find(d => d.id === selectedThread?.driverId);

  // Get driver initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="title-messaging">Driver Messaging</h1>
            <p className="text-sm text-gray-500">Unified communication hub for all drivers</p>
          </div>
          <Badge variant="outline" className="text-sm" data-testid="badge-thread-count">
            <MessageCircle className="w-4 h-4 mr-1" />
            {threads.length} Conversations
          </Badge>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Drivers/Threads List */}
        <div className="w-96 bg-white border-r flex flex-col">
          {/* Search */}
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search drivers or loads..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white border-gray-300"
                data-testid="input-search-drivers"
              />
            </div>
          </div>

          {/* Thread List */}
          <ScrollArea className="flex-1">
            {threadsLoading ? (
              <div className="p-8 text-center text-gray-500">Loading conversations...</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {searchTerm ? "No matching conversations" : "No conversations yet"}
              </div>
            ) : (
              <div className="divide-y">
                {filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                      selectedThreadId === thread.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
                    }`}
                    data-testid={`button-thread-${thread.driverId}`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="w-12 h-12 flex-shrink-0">
                        <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                          {getInitials(thread.driverName || "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-gray-900 truncate" data-testid={`text-driver-name-${thread.driverId}`}>
                            {thread.driverName}
                          </span>
                          {thread.unreadDispatchMessages > 0 && (
                            <Badge variant="destructive" className="ml-2 rounded-full px-2 py-0.5 text-xs" data-testid={`badge-unread-${thread.driverId}`}>
                              {thread.unreadDispatchMessages}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {thread.driverStatus && (
                            <Badge 
                              variant={thread.driverStatus === 'Active' ? 'default' : 'secondary'} 
                              className={cn(
                                "text-xs px-2 py-0.5 rounded-full",
                                thread.driverStatus === 'Active' 
                                  ? "bg-green-100 text-green-700 hover:bg-green-100" 
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-100"
                              )}
                              data-testid={`badge-status-${thread.driverId}`}
                            >
                              {thread.driverStatus}
                            </Badge>
                          )}
                          {thread.currentLoadNumber && (
                            <div className="flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-300 rounded-full">
                              <Truck className="w-3 h-3 text-gray-500" />
                              <span className="text-xs text-gray-700 font-medium">
                                {thread.currentLoadNumber}
                              </span>
                            </div>
                          )}
                        </div>
                        {thread.driverPhone && (
                          <div className="flex items-center gap-1 mb-1">
                            <Phone className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-500">
                              {thread.driverPhone}
                            </span>
                          </div>
                        )}
                        <p className="text-sm text-gray-500 truncate mb-1">
                          {thread.lastMessageText ? (
                            <>
                              <span className={cn(
                                "font-medium",
                                thread.lastMessageSenderRole === 'driver' ? "text-blue-600" : "text-gray-700"
                              )}>
                                {thread.lastMessageSenderRole === 'driver' ? `${thread.driverName}: ` : 'You: '}
                              </span>
                              <span>{thread.lastMessageText}</span>
                            </>
                          ) : (
                            'No messages yet'
                          )}
                        </p>
                        <span className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chat Area */}
        {selectedThread ? (
          <div className="flex-1 flex flex-col bg-white">
            {/* Chat Header */}
            <div className="p-4 border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                      {getInitials(selectedThread.driverName || "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="font-semibold text-gray-900" data-testid="text-selected-driver-name">
                      {selectedThread.driverName}
                    </h2>
                    {selectedDriver && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Phone className="w-3 h-3" />
                        <span data-testid="text-selected-driver-phone">{selectedDriver.phone}</span>
                        {selectedDriver.equipmentType && (
                          <>
                            <span>•</span>
                            <span>{selectedDriver.equipmentType}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {(selectedThread.loadNumber || selectedThread.loadNumberFromLoad) && (
                  <Badge variant="outline" className="gap-1" data-testid="badge-active-load">
                    <Truck className="w-3 h-3" />
                    {selectedThread.loadNumber || selectedThread.loadNumberFromLoad}
                  </Badge>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isDriver = message.senderRole === "driver";
                    const hasDocument = message.metadata?.documentId || message.metadata?.mediaUrl;
                    const documentStatus = message.metadata?.documentStatus;
                    const senderName = isDriver ? selectedThread.driverName : 'You';
                    
                    return (
                      <div
                        key={message.id}
                        className={cn("flex flex-col gap-1", isDriver ? "items-start" : "items-end")}
                        data-testid={`message-${message.id}`}
                      >
                        {/* Sender Name */}
                        <div className={cn(
                          "text-xs font-medium px-3",
                          isDriver ? "text-blue-600" : "text-gray-600"
                        )}>
                          {senderName}
                        </div>
                        
                        {/* Message Bubble */}
                        <div
                          className={cn(
                            "max-w-[70%] rounded-2xl px-4 py-3 shadow-sm",
                            isDriver
                              ? "bg-gray-100 text-gray-900 rounded-tl-sm"
                              : "bg-blue-600 text-white rounded-tr-sm"
                          )}
                        >
                          {message.metadata?.loadNumber && (
                            <div className="flex items-center gap-1 mb-1 opacity-75">
                              <Truck className="w-3 h-3" />
                              <span className="text-xs font-medium">
                                {message.metadata.loadNumber}
                              </span>
                            </div>
                          )}
                          
                          {/* Document thumbnail and status */}
                          {hasDocument && (
                            <div className="mb-2 p-2 bg-white/10 rounded border border-white/20">
                              <div className="flex items-center gap-2">
                                <FileText className="w-5 h-5" />
                                <div className="flex-1">
                                  <div className="text-xs font-medium">
                                    {message.metadata?.documentType?.replace('_', ' ').toUpperCase() || 'Document'}
                                  </div>
                                  {documentStatus && (
                                    <div className="flex items-center gap-1 mt-1">
                                      {documentStatus === 'approved' && (
                                        <>
                                          <CheckCircle className="w-3 h-3 text-green-500" />
                                          <span className="text-xs text-green-600 font-medium">Approved</span>
                                        </>
                                      )}
                                      {documentStatus === 'rejected' && (
                                        <>
                                          <XCircle className="w-3 h-3 text-red-500" />
                                          <span className="text-xs text-red-600 font-medium">Rejected</span>
                                        </>
                                      )}
                                      {documentStatus === 'pending' && (
                                        <>
                                          <Clock className="w-3 h-3 text-yellow-500" />
                                          <span className="text-xs text-yellow-600 font-medium">Pending Review</span>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {message.metadata?.mediaUrl && (
                                <img 
                                  src={message.metadata.mediaUrl} 
                                  alt="Document" 
                                  className="mt-2 max-w-full rounded cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => window.open(message.metadata?.mediaUrl, '_blank')}
                                  data-testid={`img-document-${message.id}`}
                                />
                              )}
                            </div>
                          )}
                          
                          <p className="whitespace-pre-wrap break-words" data-testid={`text-message-content-${message.id}`}>
                            {message.textContent}
                          </p>
                          <span className={`text-xs mt-1 block ${isDriver ? "text-gray-500" : "text-blue-100"}`}>
                            {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t bg-gray-50">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="flex-1 bg-white border-gray-300"
                  disabled={sendMessageMutation.isPending}
                  data-testid="input-message"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || sendMessageMutation.isPending}
                  className="gap-2"
                  data-testid="button-send"
                >
                  <Send className="w-4 h-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="text-center text-gray-400">
              <MessageCircle className="w-16 h-16 mx-auto mb-4" />
              <p className="text-lg">Select a conversation to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
