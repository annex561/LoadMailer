import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, ArrowRight, Truck, MessageSquare, Send, FileText, Navigation, Clock, Phone, User, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ActiveLoads() {
  const { data: loads, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/loads"],
    refetchInterval: 30000,
  });

  const activeLoads = loads?.filter((load: any) => 
    ["dispatched", "in_transit", "delivered"].includes(load.status)
  ) || [];

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading Fleet Status...</div>;

  return (
    <div className="p-4 md:p-6 space-y-6 bg-background min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Active Load Command</h1>
          <p className="text-muted-foreground">Live tracking, SOP enforcement, and driver communication.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Badge variant="secondary" className="text-lg px-4 py-1">
            {activeLoads.length} Trucks Active
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {activeLoads.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-card rounded-xl border border-dashed border-border">
            <Truck className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground mb-4">No active loads. Go to RateCon Inbox to dispatch one.</p>
            <a href="/loads-inbox">
              <Button variant="outline">Go to RateCon Inbox</Button>
            </a>
          </div>
        ) : (
          activeLoads.map((load: any) => (
            <LoadCommandCard key={load.id} load={load} />
          ))
        )}
      </div>
    </div>
  );
}

function LoadCommandCard({ load }: { load: any }) {
  return (
    <Card className="border-l-4 border-l-blue-600 shadow-sm hover:shadow-md transition-all bg-card">
      <CardHeader className="bg-card border-b border-border pb-3">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-blue-600 hover:bg-blue-700 text-white">#{load.loadNumber}</Badge>
              <StatusBadge status={load.status} />
            </div>
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">
              <span className="truncate max-w-[120px]">{load.originCity || load.pickupAddress?.split(',')[0] || "Origin"}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <span className="truncate max-w-[120px]">{load.destCity || load.deliveryAddress?.split(',')[0] || "Destination"}</span>
            </div>
          </div>
          <div className="text-right">
             <div className="flex items-center justify-end gap-1 text-sm font-medium text-foreground">
               <Truck className="w-4 h-4 text-muted-foreground" /> 
               Driver #{load.driverId || load.assignedDriverId || "N/A"}
             </div>
             <p className="text-xs text-emerald-500 font-semibold">${(load.rate || 0).toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs defaultValue="sop" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/50 p-0 h-10">
            <TabsTrigger value="sop" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-card h-10 px-4 text-foreground">
              <FileText className="w-4 h-4 mr-2" /> SOP Steps
            </TabsTrigger>
            <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:bg-card h-10 px-4 text-foreground">
              <MessageSquare className="w-4 h-4 mr-2" /> Driver Chat
            </TabsTrigger>
            <TabsTrigger value="map" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:bg-card h-10 px-4 text-foreground">
              <Navigation className="w-4 h-4 mr-2" /> Live Map
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sop" className="p-0 m-0 h-[400px] overflow-hidden">
             <ScrollArea className="h-full">
               <div className="p-4">
                  <EVChecklist load={load} /> 
               </div>
             </ScrollArea>
          </TabsContent>

          <TabsContent value="chat" className="p-0 m-0 h-[400px]">
            <DriverChatWindow load={load} />
          </TabsContent>

          <TabsContent value="map" className="p-0 m-0 h-[400px]">
            <LiveMapPanel load={load} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    dispatched: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Dispatched" },
    in_transit: { bg: "bg-amber-500/20", text: "text-amber-400", label: "In Transit" },
    delivered: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Delivered" },
  };
  const c = config[status] || { bg: "bg-muted", text: "text-muted-foreground", label: status };
  return <Badge variant="outline" className={`${c.bg} ${c.text} border-0 uppercase text-xs`}>{c.label}</Badge>;
}

function EVChecklist({ load }: { load: any }) {
  const steps = [
    { key: "initialSms", label: "Send Load Details SMS" },
    { key: "tripMessage", label: "Driver Trip Message" },
    { key: "puArrived", label: "Arrived at Pickup" },
    { key: "puDocs", label: "Upload Pickup Docs" },
    { key: "brokerConfirmed", label: "Broker Confirmation" },
    { key: "driverReleased", label: "Driver Released" },
    { key: "inTransit", label: "In Transit" },
    { key: "delArrived", label: "Arrived at Delivery" },
    { key: "delDocs", label: "Upload Delivery Docs" },
    { key: "podUploaded", label: "POD Uploaded" },
    { key: "invoiceSent", label: "Invoice Sent" },
    { key: "docsToEinstein", label: "Docs to Factoring" },
    { key: "complete", label: "Load Complete" },
  ];

  const progress = load.sopProgress || {};
  const completedCount = Object.values(progress).filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-medium text-foreground">SOP Progress</span>
        <Badge variant="outline">{completedCount} / {steps.length}</Badge>
      </div>
      {steps.map((step, idx) => (
        <div 
          key={step.key} 
          className={`flex items-center gap-3 p-2 rounded-lg ${progress[step.key] ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-muted border border-border'}`}
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${progress[step.key] ? 'bg-emerald-500 text-white' : 'bg-muted-foreground/30 text-foreground'}`}>
            {progress[step.key] ? '✓' : idx + 1}
          </div>
          <span className={`text-sm ${progress[step.key] ? 'text-emerald-400 font-medium' : 'text-foreground'}`}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function DriverChatWindow({ load }: { load: any }) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const driverId = load.driverId || load.assignedDriverId;

  const { data: driver } = useQuery({
    queryKey: ["/api/drivers", driverId],
    queryFn: async () => {
      if (!driverId) return null;
      const res = await fetch(`/api/drivers/${driverId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!driverId,
  });

  const { data: messagesData, refetch: refetchMessages } = useQuery({
    queryKey: ["/api/communication/messages", driverId],
    queryFn: async () => {
      if (!driverId) return { messages: [] };
      const res = await fetch(`/api/communication/messages?driverId=${driverId}&limit=50`);
      if (!res.ok) return { messages: [] };
      return res.json();
    },
    enabled: !!driverId,
    refetchInterval: 10000,
  });

  const messages = messagesData?.messages || [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!driverId || !message.trim()) throw new Error("No driver or message");
      await apiRequest("POST", "/api/communication/send", { 
        driverId,
        message: message.trim(),
        loadId: load.id
      });
    },
    onSuccess: () => {
      setMessage("");
      toast({ title: "Sent", description: "Message sent to driver." });
      refetchMessages();
    },
    onError: (err: any) => {
      toast({ title: "Error", variant: "destructive", description: err?.message || "Failed to send message." });
    }
  });

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="px-4 py-2 bg-card border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{driver?.name || `Driver #${driverId || "N/A"}`}</p>
          <p className="text-xs text-muted-foreground">{driver?.phone || "No phone"}</p>
        </div>
        {driver?.phone && (
          <a href={`tel:${driver.phone}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Phone className="w-4 h-4" />
            </Button>
          </a>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.length === 0 ? (
          <div className="flex justify-center mt-10 opacity-50">
            <div className="text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          messages.map((msg: any, idx: number) => (
            <div key={msg.id || idx} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                msg.direction === 'outgoing' 
                  ? 'bg-blue-600 text-white rounded-br-none' 
                  : 'bg-card border border-border text-foreground rounded-bl-none'
              }`}>
                <p>{msg.body || msg.message}</p>
                <p className={`text-[10px] mt-1 ${msg.direction === 'outgoing' ? 'text-blue-200' : 'text-muted-foreground'}`}>
                  {new Date(msg.createdAt || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 bg-card border-t border-border flex gap-2">
        <Input 
          placeholder="Type message to driver..." 
          className="flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !sendMessage.isPending && message.trim() && sendMessage.mutate()}
        />
        <Button 
          size="icon" 
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => sendMessage.mutate()}
          disabled={!message.trim() || sendMessage.isPending}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function LiveMapPanel({ load }: { load: any }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const driverId = load.driverId || load.assignedDriverId;

  const { data: locationData } = useQuery({
    queryKey: ["/api/driver-locations/active"],
    refetchInterval: 30000,
  });

  const driverLocation = locationData?.locations?.find((loc: any) => loc.driverId === driverId);

  useEffect(() => {
    if (!mapRef.current) return;
    
    const loadLeaflet = async () => {
      if (typeof window === 'undefined') return;
      
      const L = (window as any).L;
      if (!L) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
        
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => initMap();
        document.head.appendChild(script);
      } else {
        initMap();
      }
    };

    const initMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;
      
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }

      const lat = driverLocation?.latitude || 36.1627;
      const lng = driverLocation?.longitude || -86.7816;

      const map = L.map(mapRef.current).setView([lat, lng], 10);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      if (driverLocation) {
        const truckIcon = L.divIcon({
          html: `<div style="background: #2563eb; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap;">🚛 Driver</div>`,
          className: 'custom-truck-marker',
          iconSize: [80, 24],
          iconAnchor: [40, 12]
        });
        L.marker([lat, lng], { icon: truckIcon }).addTo(map);
      }
    };

    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [driverLocation]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 bg-card border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-foreground">Live Location</span>
          </div>
          {driverLocation ? (
            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-0 text-xs">
              GPS Active
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-0 text-xs">
              No GPS Signal
            </Badge>
          )}
        </div>
      </div>
      
      <div ref={mapRef} className="flex-1 bg-muted" style={{ minHeight: '300px' }}>
        {!driverLocation && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <MapPin className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">Waiting for GPS signal...</p>
          </div>
        )}
      </div>

      <div className="p-3 bg-card border-t border-border grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Pickup</p>
          <p className="text-foreground font-medium truncate">{load.pickupAddress || load.originCity || "TBD"}</p>
          <p className="text-muted-foreground">{load.pickupDate || "TBD"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Delivery</p>
          <p className="text-foreground font-medium truncate">{load.deliveryAddress || load.destCity || "TBD"}</p>
          <p className="text-muted-foreground">{load.deliveryDate || "TBD"}</p>
        </div>
      </div>
    </div>
  );
}
