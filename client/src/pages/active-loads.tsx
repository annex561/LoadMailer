import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, ArrowRight, Truck, MessageSquare, Send, FileText, Navigation, Clock } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ActiveLoads() {
  const { data: loads, isLoading } = useQuery({
    queryKey: ["/api/loads"],
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
        <div className="flex gap-2">
          <Badge variant="secondary" className="text-lg px-4 py-1">
            {activeLoads.length} Trucks Active
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {activeLoads.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-card rounded-xl border border-dashed border-border">
            <p className="text-muted-foreground">No active loads. Go to <a href="/loads-inbox" className="text-blue-500 underline">RateCon Inbox</a> to dispatch one.</p>
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
              <Badge variant="outline" className="text-muted-foreground uppercase">{load.status?.replace("_", " ") || "Unknown"}</Badge>
            </div>
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">
              <span className="truncate max-w-[120px]">{load.originCity || load.pickupAddress || "Origin"}</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <span className="truncate max-w-[120px]">{load.destCity || load.deliveryAddress || "Destination"}</span>
            </div>
          </div>
          <div className="text-right">
             <div className="flex items-center justify-end gap-1 text-sm font-medium text-foreground">
               <Truck className="w-4 h-4 text-muted-foreground" /> Driver #{load.assignedDriverId || load.driverId || "N/A"}
             </div>
             <p className="text-xs text-muted-foreground">Rate: ${load.rate || 0}</p>
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

          <TabsContent value="map" className="p-0 m-0 h-[400px] bg-muted flex flex-col items-center justify-center text-muted-foreground">
            <MapPin className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">Live GPS Map Integration</p>
            <p className="text-xs max-w-[200px] text-center mt-2">
              Pickup: {load.pickupDate || "TBD"}<br/>
              Delivery: {load.deliveryDate || "TBD"}
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
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

  const { data: messages } = useQuery({
    queryKey: [`/api/messages/load/${load.id}`],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/load/${load.id}`);
        if(!res.ok) return [];
        return await res.json();
      } catch (e) { return []; }
    }
  });

  const sendMessage = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/sms/send-template", { 
        loadId: load.id, 
        type: "CUSTOM",
        customBody: message 
      });
    },
    onSuccess: () => {
      setMessage("");
      toast({ title: "Sent", description: "Message sent to driver." });
    },
    onError: () => {
      toast({ title: "Error", variant: "destructive", description: "Failed to send SMS." });
    }
  });

  return (
    <div className="flex flex-col h-full bg-muted/50">
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        <div className="flex justify-center mt-10 opacity-50">
           <div className="text-center">
             <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
             <p className="text-xs text-muted-foreground">Chat History with Driver #{load.assignedDriverId || load.driverId || "N/A"}</p>
           </div>
        </div>
      </div>

      <div className="p-3 bg-card border-t border-border flex gap-2">
        <Input 
          placeholder="Type message to driver..." 
          className="flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage.mutate()}
        />
        <Button 
          size="icon" 
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => sendMessage.mutate()}
          disabled={!message || sendMessage.isPending}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
