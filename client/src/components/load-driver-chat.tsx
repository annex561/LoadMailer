import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Send, Phone, Image, MessageSquare, FileText, 
  Clock, Filter, Truck, Package, CheckCircle 
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LoadMessage {
  id: string;
  loadId: string;
  driverPhone: string;
  direction: 'inbound' | 'outbound';
  body: string;
  mediaUrls: string[];
  mediaTypes: string[];
  docType?: 'bol' | 'freight_photos' | 'pod' | 'other';
  timestamp: string;
}

interface LoadDriverChatProps {
  loadId: string;
  loadNumber: string;
  driverName?: string;
  driverPhone?: string;
  onCallDriver?: () => void;
}

const quickMessages = [
  { label: "Pickup Reminder", icon: Truck, message: "Reminder: Please confirm when you arrive at pickup." },
  { label: "Delivery ETA", icon: Clock, message: "What's your current ETA for delivery?" },
  { label: "Status Check", icon: MessageSquare, message: "Please send a status update on your current location." },
  { label: "Load Confirmed", icon: CheckCircle, message: "Load confirmed. Safe travels!" },
  { label: "Send BOL", icon: FileText, message: "Please send a photo of the signed BOL." },
  { label: "Send POD", icon: Package, message: "Please send proof of delivery photos." },
];

const docTypeLabels: Record<string, { label: string; color: string }> = {
  bol: { label: "BOL", color: "bg-blue-600" },
  freight_photos: { label: "Freight", color: "bg-amber-600" },
  pod: { label: "POD", color: "bg-emerald-600" },
  other: { label: "Photo", color: "bg-slate-600" },
};

export function LoadDriverChat({ loadId, loadNumber, driverName, driverPhone, onCallDriver }: LoadDriverChatProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<'all' | 'photos'>('all');

  const { data: messages = [], isLoading } = useQuery<LoadMessage[]>({
    queryKey: ['/api/driver-sms/messages', loadId],
    queryFn: async () => {
      const res = await fetch(`/api/driver-sms/messages/${loadId}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) => {
      await apiRequest("POST", "/api/driver-sms/send", { loadId, body });
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ['/api/driver-sms/messages', loadId] });
      toast({ title: "Message Sent", className: "bg-emerald-600 text-white" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to send message", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const filteredMessages = filter === 'photos' 
    ? messages.filter(m => m.mediaUrls?.length > 0)
    : messages;

  const handleQuickMessage = (msg: string) => {
    sendMessageMutation.mutate(msg);
  };

  const handleSend = () => {
    if (message.trim()) {
      sendMessageMutation.mutate(message.trim());
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold">
            {driverName?.charAt(0) || '?'}
          </div>
          <div>
            <div className="font-semibold text-white">{driverName || 'Unassigned'}</div>
            <div className="text-xs text-slate-400">{driverPhone || 'No phone'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
            className={cn(
              "h-8",
              filter === 'all' ? "bg-blue-600" : "border-slate-700 text-slate-400"
            )}
          >
            <MessageSquare className="w-3 h-3 mr-1" /> All
          </Button>
          <Button
            size="sm"
            variant={filter === 'photos' ? 'default' : 'outline'}
            onClick={() => setFilter('photos')}
            className={cn(
              "h-8",
              filter === 'photos' ? "bg-blue-600" : "border-slate-700 text-slate-400"
            )}
          >
            <Image className="w-3 h-3 mr-1" /> Photos
          </Button>
          {driverPhone && onCallDriver && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 h-8" onClick={onCallDriver}>
              <Phone className="w-3 h-3 mr-1" /> Call
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/30 flex gap-2 overflow-x-auto">
        {quickMessages.map((qm) => (
          <Button
            key={qm.label}
            size="sm"
            variant="outline"
            className="h-7 text-xs border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
            onClick={() => handleQuickMessage(qm.message)}
            disabled={sendMessageMutation.isPending}
          >
            <qm.icon className="w-3 h-3 mr-1" />
            {qm.label}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {isLoading ? (
          <div className="text-center text-slate-500 py-8">Loading messages...</div>
        ) : filteredMessages.length === 0 ? (
          <div className="text-center text-slate-500 py-8">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No messages yet for Load #{loadNumber}</p>
            <p className="text-xs mt-1">Driver can text photos with "LOAD{loadNumber}" to upload documents</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.direction === 'outbound' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2 shadow-lg",
                    msg.direction === 'outbound'
                      ? "bg-blue-600 text-white rounded-tr-none"
                      : "bg-slate-800 text-slate-100 rounded-tl-none"
                  )}
                >
                  {msg.docType && msg.docType !== 'other' && (
                    <Badge className={cn("text-[10px] mb-2", docTypeLabels[msg.docType]?.color)}>
                      {docTypeLabels[msg.docType]?.label}
                    </Badge>
                  )}
                  
                  {msg.mediaUrls?.length > 0 && (
                    <div className="grid gap-2 mb-2">
                      {msg.mediaUrls.map((url, idx) => (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={url}
                            alt={`Attachment ${idx + 1}`}
                            className="max-w-full rounded-lg max-h-48 object-cover border border-slate-600"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  
                  {msg.body && <p className="text-sm">{msg.body}</p>}
                  
                  <div className={cn(
                    "text-[10px] mt-1",
                    msg.direction === 'outbound' ? "text-blue-200" : "text-slate-500"
                  )}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <Input
            placeholder={`Message ${driverName || 'driver'}...`}
            className="bg-slate-950 border-slate-700 text-white focus-visible:ring-emerald-500 pl-4"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          />
          <Button
            size="icon"
            className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
            onClick={handleSend}
            disabled={!message.trim() || sendMessageMutation.isPending}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
