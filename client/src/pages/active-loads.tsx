import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  MapPin, Truck, Phone, MessageSquare, Send, 
  FileText, Navigation, Clock, CheckCircle2, AlertCircle, ArrowRight,
  Brain, ThumbsUp, MoreVertical, Circle, RefreshCw
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function ActiveLoads() {
  const { data: loads, isLoading } = useQuery({
    queryKey: ["/api/loads"],
  });

  const activeLoads = loads?.filter((load: any) => 
    ["dispatched", "in_transit", "delivered"].includes(load.status)
  ) || [];

  const [selectedLoadId, setSelectedLoadId] = useState<number | null>(null);

  useEffect(() => {
    if (activeLoads.length > 0 && !selectedLoadId) {
      setSelectedLoadId(activeLoads[0].id);
    }
  }, [activeLoads, selectedLoadId]);

  const selectedLoad = activeLoads.find((l: any) => l.id === selectedLoadId);

  if (isLoading) return <div className="p-8 text-slate-500">Loading Command Center...</div>;

  return (
    <div className="flex h-[calc(100vh-60px)] bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* --- LEFT PANEL: FLEET LIST (320px) --- */}
      <div className="w-[320px] border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-500" /> Active Fleet ({activeLoads.length})
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {activeLoads.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No trucks active.</div>
            ) : (
              activeLoads.map((load: any) => (
                <button
                  key={load.id}
                  onClick={() => setSelectedLoadId(load.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-all border border-transparent",
                    selectedLoadId === load.id 
                      ? "bg-blue-600/10 border-blue-600/50 shadow-md" 
                      : "hover:bg-slate-800"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <Badge variant="outline" className={cn(
                      "text-[10px] px-1 py-0 h-5 border-slate-600 text-slate-400",
                      selectedLoadId === load.id && "text-blue-200 border-blue-400"
                    )}>
                      #{load.loadNumber}
                    </Badge>
                    <StatusBadge status={load.status} />
                  </div>
                  <div className="font-bold text-sm text-slate-200 truncate flex items-center gap-1">
                    {load.originCity || "Origin"} <ArrowRight className="w-3 h-3 text-slate-600"/> {load.destCity || "Dest"}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <Avatar className="w-5 h-5">
                       <AvatarFallback className="bg-emerald-900 text-emerald-400 text-[9px]">DR</AvatarFallback>
                    </Avatar>
                    <span className="truncate">Driver #{(load.driverId || load.assignedDriverId || "N/A").toString().slice(0, 8)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* --- RIGHT PANEL: COMMAND WORKSPACE --- */}
      <div className="flex-1 flex flex-col bg-slate-950">
        {selectedLoad ? (
          <>
            {/* HEADER: TRIP CONTEXT */}
            <div className="h-16 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  {selectedLoad.originCity || "Origin"} 
                  <ArrowRight className="w-5 h-5 text-slate-500" /> 
                  {selectedLoad.destCity || "Destination"}
                </h1>
                <p className="text-xs text-slate-400 flex gap-4">
                  <span className="text-emerald-400 font-mono">${(selectedLoad.rate || 0).toLocaleString()}</span>
                  <span className="border-l border-slate-700 pl-4">Pickup: {selectedLoad.pickupDate?.slice(0, 10) || "TBD"}</span>
                  <span className="border-l border-slate-700 pl-4">Del: {selectedLoad.deliveryDate?.slice(0, 10) || "TBD"}</span>
                </p>
              </div>
              <div className="flex gap-2">
                 <Button size="sm" variant="outline" className="border-slate-700 hover:bg-slate-800 text-slate-300">
                    <FileText className="w-4 h-4 mr-2" /> View RateCon
                 </Button>
                 <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Phone className="w-4 h-4 mr-2" /> Call Driver
                 </Button>
              </div>
            </div>

            {/* MAIN CONTENT AREA WITH TABS */}
            <div className="flex-1 overflow-hidden">
              <Tabs defaultValue="sop" className="h-full flex flex-col">
                <TabsList className="w-full justify-start rounded-none border-b border-slate-800 bg-slate-900/50 p-0 h-12">
                  <TabsTrigger value="sop" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-12 px-6 text-slate-300 data-[state=active]:text-white">
                    <FileText className="w-4 h-4 mr-2" /> Load Management
                  </TabsTrigger>
                  <TabsTrigger value="map" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent h-12 px-6 text-slate-300 data-[state=active]:text-white">
                    <Navigation className="w-4 h-4 mr-2" /> Live Map
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sop" className="flex-1 overflow-hidden m-0 p-0">
                  <div className="h-full flex">
                    {/* Left side: EVChecklist */}
                    <div className="flex-1 overflow-hidden">
                      <ScrollArea className="h-full">
                        <div className="p-6">
                          <EVChecklist load={selectedLoad} />
                        </div>
                      </ScrollArea>
                    </div>
                    {/* Right side: Driver Messages */}
                    <div className="w-[400px] border-l border-slate-800 flex flex-col">
                      <DriverMessagesPanel load={selectedLoad} />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="map" className="flex-1 overflow-hidden m-0 p-0">
                  <LiveMapPanel load={selectedLoad} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <Truck className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p>Select a load from the fleet list</p>
              {activeLoads.length === 0 && (
                <a href="/loads-inbox" className="mt-4 inline-block">
                  <Button variant="outline" className="border-slate-700">Go to RateCon Inbox</Button>
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    dispatched: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Dispatched" },
    in_transit: { bg: "bg-amber-500/20", text: "text-amber-400", label: "In Transit" },
    delivered: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Delivered" },
  };
  const c = config[status] || { bg: "bg-slate-500/20", text: "text-slate-400", label: status };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>{c.label}</span>;
}

function DriverMessagesPanel({ load }: { load: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const driverId = load.driverId || load.assignedDriverId;

  const { data: driver } = useQuery({
    queryKey: ["/api/drivers", driverId],
    enabled: !!driverId,
  });

  const { data: thread } = useQuery({
    queryKey: ["/api/communication/threads"],
    select: (threads: any[]) => threads?.find((t: any) => t.driverId === driverId),
    enabled: !!driverId,
  });

  const { data: messages = [], refetch, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/communication/messages", thread?.id],
    enabled: !!thread?.id,
    refetchInterval: 2000,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      if (thread?.id) {
        return apiRequest("POST", `/api/communication/threads/${thread.id}/messages`, { content: msg });
      }
      return apiRequest("POST", `/api/drivers/${driverId}/sms`, { message: msg });
    },
    onSuccess: () => {
      setMessage("");
      refetch();
      toast({ title: "Message sent" });
    },
  });

  const handleQuickMessage = (text: string) => {
    sendMutation.mutate(text);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!driverId) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <p>No driver assigned to this load</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Driver Header - matches Communication Dashboard */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarFallback className="bg-slate-700 text-slate-300">
                {driver?.name?.charAt(0).toUpperCase() || "D"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-white">{driver?.name || "Driver"}</p>
              <p className="text-xs text-slate-400">{driver?.phone || "No phone"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {driver?.phone && (
              <a href={`tel:${driver.phone}`}>
                <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  <Phone className="w-4 h-4" />
                </Button>
              </a>
            )}
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {/* Sub-header with thread info and AI toggle */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> General Discussion
            </span>
            <span className="flex items-center gap-1">
              <Circle className="w-3 h-3" /> {messages.length} messages
            </span>
          </div>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => setAiEnabled(!aiEnabled)}
            className={cn(
              "text-xs border-slate-700",
              aiEnabled ? "bg-emerald-600/20 border-emerald-600 text-emerald-400" : "text-slate-400"
            )}
          >
            <Brain className="w-3 h-3 mr-1" /> AI {aiEnabled ? "On" : "Off"}
          </Button>
        </div>
      </div>

      {/* Messages - Card style like Communication Dashboard */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messagesLoading ? (
            <p className="text-center text-slate-500 text-sm py-8">Loading messages...</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">No messages yet</p>
          ) : (
            messages.map((msg: any, i: number) => {
              const isDispatch = msg.sender === 'dispatch' || msg.direction === 'outbound';
              return (
                <div key={msg.id || i} className={cn("flex", isDispatch ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[75%] rounded-lg px-4 py-2",
                    isDispatch 
                      ? "bg-teal-600/10 text-slate-100 border border-teal-600/30" 
                      : "bg-slate-800 text-slate-100"
                  )}>
                    <p className="text-sm">{msg.content || msg.message || msg.body}</p>
                    <p className={cn(
                      "text-[11px] mt-1",
                      isDispatch ? "text-teal-400/70" : "text-slate-500"
                    )}>
                      {formatMessageTime(msg.createdAt || msg.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Quick Messages - 2 column grid with emojis like Communication Dashboard */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/30">
        <h4 className="text-xs font-medium text-slate-400 mb-2">Quick Messages</h4>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Hi! Just a friendly reminder about your pickup today. Please confirm when you arrive at the pickup location. Thanks!')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            📍 Pickup Reminder
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Please provide an ETA for delivery. Customer is asking for updates. Thank you!')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            🚚 Delivery ETA
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Hi! Can you please provide a quick status update on this load? Thanks!')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            ❓ Status Check
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Great! Load confirmed. Please proceed to pickup location and keep me updated. Safe travels!')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            ✅ Load Confirmed
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Please remember to get all required paperwork signed and send photos when pickup/delivery is complete.')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            📋 Paperwork
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickMessage('Please contact the customer before arrival. Their contact info is in the load details. Thanks!')}
            className="whitespace-nowrap text-xs border-slate-700 text-slate-300 hover:bg-slate-800 justify-start"
          >
            📞 Call Customer
          </Button>
        </div>
      </div>

      {/* Message Input with action buttons - matches Communication Dashboard */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 !bg-slate-800 !border-slate-700 !text-white placeholder:!text-slate-500 focus:!ring-slate-600 focus:!border-slate-600"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && message.trim() && sendMutation.mutate(message)}
          />
          <Button 
            size="sm"
            variant="outline" 
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <FileText className="w-4 h-4" />
          </Button>
          <Button 
            size="sm"
            variant="outline" 
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <ThumbsUp className="w-4 h-4" />
          </Button>
          <Button 
            onClick={() => message.trim() && sendMutation.mutate(message)}
            disabled={!message.trim() || sendMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function LiveMapPanel({ load }: { load: any }) {
  const driverId = load.driverId || load.assignedDriverId;

  const { data: gpsData } = useQuery({
    queryKey: ["/api/gps/drivers", driverId, "location"],
    enabled: !!driverId,
    refetchInterval: 30000,
  });

  const lat = gpsData?.latitude || 35.2271;
  const lng = gpsData?.longitude || -80.8431;
  const hasGps = !!gpsData?.latitude;

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.5}%2C${lat - 0.3}%2C${lng + 0.5}%2C${lat + 0.3}&layer=mapnik&marker=${lat}%2C${lng}`;

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Map Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <Navigation className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold">Live Location</span>
        </div>
        <Badge className={hasGps ? "bg-emerald-600" : "bg-amber-600"}>
          {hasGps ? "GPS Active" : "No Signal"}
        </Badge>
      </div>

      {/* Map - Using OpenStreetMap iframe */}
      <div className="flex-1 relative">
        <iframe
          src={mapUrl}
          style={{ border: 0, width: "100%", height: "100%" }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Driver Location Map"
        />
        {/* Driver marker overlay */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
          <div className="bg-emerald-500 text-white px-3 py-1 rounded-lg shadow-lg text-sm font-medium flex items-center gap-1">
            🚚 Driver
          </div>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 text-center">
        <p className="text-xs text-slate-400">
          {gpsData?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        </p>
      </div>

      {/* Route Info Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Pickup</p>
          <p className="font-semibold text-white text-sm">{load.originCity}, {load.originState || ""}</p>
          <p className="text-xs text-slate-400">{load.pickupDate?.slice(0, 10) || "TBD"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Delivery</p>
          <p className="font-semibold text-white text-sm">{load.destCity}, {load.destState || ""}</p>
          <p className="text-xs text-slate-400">{load.deliveryDate?.slice(0, 10) || "TBD"}</p>
        </div>
      </div>
    </div>
  );
}
