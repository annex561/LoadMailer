import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Radio, 
  Send, 
  Users, 
  Volume2, 
  Mic, 
  Play, 
  Pause,
  MessageSquare,
  Hash,
  User,
  Circle
} from "lucide-react";

interface ZelloChannelMessage {
  id: string;
  channel: string;
  sender: string;
  senderType: 'driver' | 'dispatch' | 'system';
  messageType: 'text' | 'voice' | 'image' | 'location';
  textContent?: string;
  voiceUrl?: string;
  voiceDuration?: number;
  driverId?: string;
  driverName?: string;
  isRead: boolean;
  createdAt: string;
}

interface ZelloChannelStatus {
  id: string;
  channelName: string;
  channelDescription?: string;
  unreadCount: number;
  lastMessageAt?: string;
  lastMessageSender?: string;
  lastMessagePreview?: string;
  onlineUsers: number;
  totalUsers: number;
  userList: any[];
  isActive: boolean;
}

export default function ZelloChannelsDashboard() {
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>("all-drivers");
  const [message, setMessage] = useState("");
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Default channels
  const defaultChannels = [
    { name: "all-drivers", description: "All active drivers" },
    { name: "southeast-region", description: "SE region drivers" },
    { name: "box-truck-ops", description: "Box truck operators" },
    { name: "hotshot-expedite", description: "Expedite/hotshot drivers" },
    { name: "dispatch-priority", description: "High priority dispatch" }
  ];

  // Fetch channel statuses with unread counts
  const { data: channelStatuses = [] } = useQuery<ZelloChannelStatus[]>({
    queryKey: ['/api/zello/channels/status'],
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  // Fetch messages for active channel
  const { data: channelMessages = [] } = useQuery<ZelloChannelMessage[]>({
    queryKey: [`/api/zello/channels/${activeChannel}/messages`],
    enabled: !!activeChannel,
    refetchInterval: 2000 // Refresh every 2 seconds
  });

  // Fetch available drivers/users
  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
    select: (data: any[]) => data.filter(d => d.status === 'available')
  });

  // Mark messages as read when channel is viewed
  useEffect(() => {
    if (activeChannel && channelMessages.length > 0) {
      const unreadMessages = channelMessages.filter(m => !m.isRead);
      if (unreadMessages.length > 0) {
        markMessagesAsRead(unreadMessages.map(m => m.id));
      }
    }
  }, [activeChannel, channelMessages]);

  // Mark messages as read mutation
  const markMessagesAsRead = async (messageIds: string[]) => {
    try {
      await fetch(`/api/zello/channels/${activeChannel}/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds })
      });
      queryClient.invalidateQueries({ queryKey: ['/api/zello/channels/status'] });
    } catch (error) {
      console.error('Failed to mark messages as read:', error);
    }
  };

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/zello/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: selectedChannels,
          users: selectedUsers,
          message
        })
      });
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    },
    onSuccess: (data) => {
      const successCount = data.success?.length || 0;
      const failedCount = data.failed?.length || 0;
      
      toast({
        title: "Message Sent",
        description: `Delivered to ${successCount} recipients${failedCount > 0 ? `, failed for ${failedCount}` : ''}`,
        variant: failedCount > 0 ? "default" : "default"
      });
      
      setMessage("");
      setSelectedChannels([]);
      setSelectedUsers([]);
      
      // Refresh messages
      queryClient.invalidateQueries({ queryKey: [`/api/zello/channels/${activeChannel}/messages`] });
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSendMessage = () => {
    if (!message.trim()) return;
    if (selectedChannels.length === 0 && selectedUsers.length === 0) {
      toast({
        title: "No recipients selected",
        description: "Please select at least one channel or user",
        variant: "destructive"
      });
      return;
    }
    sendMessageMutation.mutate();
  };

  const playVoiceMessage = (voiceUrl: string, messageId: string) => {
    if (playingAudio === messageId) {
      audioRef.current?.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = voiceUrl;
        audioRef.current.play();
        setPlayingAudio(messageId);
      }
    }
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

  const getChannelStatus = (channelName: string): ZelloChannelStatus | undefined => {
    return channelStatuses.find(s => s.channelName === channelName);
  };

  return (
    <div className="h-full flex flex-col">
      <audio 
        ref={audioRef} 
        onEnded={() => setPlayingAudio(null)}
        className="hidden"
      />
      
      {/* Header */}
      <div className="border-b p-4 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold">Zello Channel Dispatcher</h1>
          </div>
          <Badge variant="outline" className="text-sm">
            WebSocket Connected
          </Badge>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Channel List Sidebar */}
        <div className="w-80 border-r bg-gray-50">
          <div className="p-4 border-b bg-white">
            <h2 className="font-semibold mb-3">Channels</h2>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {defaultChannels.map(channel => {
                  const status = getChannelStatus(channel.name);
                  const unreadCount = status?.unreadCount || 0;
                  
                  return (
                    <div
                      key={channel.name}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        activeChannel === channel.name 
                          ? 'bg-blue-100 border-blue-300 border' 
                          : 'bg-white hover:bg-gray-100 border border-gray-200'
                      }`}
                      onClick={() => setActiveChannel(channel.name)}
                      data-testid={`channel-${channel.name}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedChannels.includes(channel.name)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedChannels([...selectedChannels, channel.name]);
                              } else {
                                setSelectedChannels(selectedChannels.filter(c => c !== channel.name));
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`select-channel-${channel.name}`}
                          />
                          <Hash className="w-4 h-4 text-gray-500" />
                          <div>
                            <div className="font-medium">{channel.name}</div>
                            <div className="text-xs text-gray-500">{channel.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {unreadCount > 0 && (
                            <Badge className="bg-red-500 text-white">
                              {unreadCount}
                            </Badge>
                          )}
                          <div className="text-xs text-gray-500">
                            {status?.onlineUsers || 0} online
                          </div>
                        </div>
                      </div>
                      {status?.lastMessagePreview && (
                        <div className="mt-2 text-xs text-gray-500 truncate">
                          {status.lastMessageSender}: {status.lastMessagePreview}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="p-4 bg-white">
            <h2 className="font-semibold mb-3">Direct Messages</h2>
            <ScrollArea className="h-[250px]">
              <div className="space-y-2">
                {drivers.map((driver: any) => (
                  <div
                    key={driver.id}
                    className="p-2 bg-white rounded border border-gray-200 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedUsers.includes(driver.name)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedUsers([...selectedUsers, driver.name]);
                          } else {
                            setSelectedUsers(selectedUsers.filter(u => u !== driver.name));
                          }
                        }}
                        data-testid={`select-user-${driver.id}`}
                      />
                      <User className="w-4 h-4 text-gray-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{driver.name}</div>
                        <div className="text-xs text-gray-500">{driver.equipmentType}</div>
                      </div>
                      <Circle className={`w-2 h-2 ${
                        driver.status === 'available' ? 'text-green-500' : 'text-gray-400'
                      } fill-current`} />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col bg-white">
          {/* Channel Header */}
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash className="w-5 h-5 text-gray-500" />
                <h2 className="text-lg font-semibold">{activeChannel}</h2>
                <Badge variant="outline">
                  {getChannelStatus(activeChannel)?.onlineUsers || 0} users online
                </Badge>
              </div>
            </div>
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {channelMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderType === 'dispatch' ? 'justify-end' : 'justify-start'}`}
                  data-testid={`message-${msg.id}`}
                >
                  <div className={`max-w-md ${
                    msg.senderType === 'dispatch' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-100 text-gray-900'
                  } rounded-lg p-3`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">
                        {msg.sender}
                      </span>
                      {msg.driverName && (
                        <span className="text-xs opacity-75">
                          ({msg.driverName})
                        </span>
                      )}
                    </div>
                    
                    {msg.messageType === 'text' && (
                      <p className="text-sm">{msg.textContent}</p>
                    )}
                    
                    {msg.messageType === 'voice' && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => msg.voiceUrl && playVoiceMessage(msg.voiceUrl, msg.id)}
                          className={msg.senderType === 'dispatch' ? 'text-white hover:bg-blue-700' : ''}
                          data-testid={`play-voice-${msg.id}`}
                        >
                          {playingAudio === msg.id ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Volume2 className="w-4 h-4" />
                        <span className="text-xs">
                          {msg.voiceDuration ? `${msg.voiceDuration}s` : 'Voice message'}
                        </span>
                      </div>
                    )}
                    
                    <div className={`text-xs mt-1 ${
                      msg.senderType === 'dispatch' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {formatMessageTime(msg.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Message Input Area */}
          <div className="border-t p-4 bg-gray-50">
            <div className="mb-3">
              <div className="text-sm text-gray-600 mb-1">
                Broadcasting to:
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedChannels.map(channel => (
                  <Badge key={channel} variant="secondary">
                    <Hash className="w-3 h-3 mr-1" />
                    {channel}
                  </Badge>
                ))}
                {selectedUsers.map(user => (
                  <Badge key={user} variant="outline">
                    <User className="w-3 h-3 mr-1" />
                    {user}
                  </Badge>
                ))}
                {selectedChannels.length === 0 && selectedUsers.length === 0 && (
                  <span className="text-sm text-gray-400">No recipients selected</span>
                )}
              </div>
            </div>
            
            <div className="flex gap-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 min-h-[60px] bg-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                data-testid="message-input"
              />
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleSendMessage}
                  disabled={sendMessageMutation.isPending || !message.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="send-message"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send
                </Button>
                <Button
                  variant="outline"
                  disabled
                  title="Voice messaging coming soon"
                >
                  <Mic className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}