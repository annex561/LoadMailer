import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Send, Truck, Phone, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  lastMessageAt: string;
  lastMessageText?: string;
  lastMessageSender?: string;
  threadType: string;
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
  };
  createdAt: string;
  isRead: boolean;
}

export default function UnifiedMessaging() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all drivers
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Fetch communication threads
  const { data: threads = [], isLoading: threadsLoading } = useQuery<CommunicationThread[]>({
    queryKey: ["/api/communication/threads"],
    refetchInterval: 3000, // Poll every 3 seconds
  });

  // Fetch messages for selected thread
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/communication/threads", selectedThreadId, "messages"],
    enabled: !!selectedThreadId,
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      return await apiRequest(`/api/communication/messages`, {
        method: "POST",
        body: JSON.stringify({
          threadId,
          content,
          sender: "dispatch"
        }),
      });
    },
    onSuccess: (_data, variables) => {
      // Use the threadId from the mutation variables to avoid stale closure
      queryClient.invalidateQueries({ queryKey: ["/api/communication/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication/threads", variables.threadId, "messages"] });
      setMessageText("");
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
                        {(thread.loadNumber || thread.loadNumberFromLoad) && (
                          <div className="flex items-center gap-1 mb-1">
                            <Truck className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-600 font-medium">
                              {thread.loadNumber || thread.loadNumberFromLoad}
                            </span>
                          </div>
                        )}
                        <p className="text-sm text-gray-500 truncate mb-1">
                          {thread.lastMessageText || "No messages yet"}
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
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isDriver ? "justify-start" : "justify-end"}`}
                        data-testid={`message-${message.id}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-4 py-2 ${
                            isDriver
                              ? "bg-gray-100 text-gray-900"
                              : "bg-blue-600 text-white"
                          }`}
                        >
                          {message.metadata?.loadNumber && (
                            <div className="flex items-center gap-1 mb-1 opacity-75">
                              <Truck className="w-3 h-3" />
                              <span className="text-xs font-medium">
                                {message.metadata.loadNumber}
                              </span>
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
                  data-testid="button-send-message"
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
