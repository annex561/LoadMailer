import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  MapPin, Truck, Phone, MessageSquare, Send,
  FileText, ArrowRight, CheckCircle2, Calendar, UserPlus
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import { LiveMap } from "@/components/load-lifecycle/LiveMap";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function ActiveLoads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: loads, isLoading } = useQuery<any[]>({ 
    queryKey: ["/api/loads"],
    refetchInterval: 2000 // Poll every 2s to ensure it catches the move immediately
  });
  
  // Fetch available drivers for assignment
  const { data: drivers } = useQuery<any[]>({ 
    queryKey: ["/api/drivers"]
  });
  
  // Mutation to assign driver to load
  const assignDriverMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      await apiRequest("PATCH", `/api/loads/${loadId}`, { driverId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      toast({ title: "Driver Assigned", description: "Driver has been assigned to this load." });
    },
    onError: (e: any) => {
      toast({ title: "Error", variant: "destructive", description: e?.message || "Failed to assign driver" });
    }
  });

  // --- THE FIX: BROADENED FILTER ---
  // We want anything that is NOT 'booked' (Inbox) and NOT 'archived' (History)
  const activeLoads = (loads || []).filter((load: any) => {
    const status = load.status?.toLowerCase() || "";
    // FIXED: Show ALL statuses EXCEPT 'booked' and 'archived'
    return !["booked", "archived"].includes(status);
  }) || [];

  const [selectedLoadId, setSelectedLoadId] = useState<number | null>(null);
  const [isRateConOpen, setIsRateConOpen] = useState(false);

  // Auto-select first load if none selected
  useEffect(() => {
    if (activeLoads.length > 0 && !selectedLoadId) {
      setSelectedLoadId(activeLoads[0].id);
    }
  }, [activeLoads, selectedLoadId]);

  const selectedLoad = activeLoads.find((l: any) => l.id === selectedLoadId);

  if (isLoading) return <div className="p-8 text-slate-500">Loading Command Center...</div>;

  return (
    <div className="flex h-[calc(100vh-60px)] bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* LEFT PANEL: FLEET LIST */}
      <div className="w-[300px] border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-500" /> Active Loads ({activeLoads.length})
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {activeLoads.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-slate-500 text-sm mb-2">No trucks active.</p>
                <p className="text-xs text-slate-600">
                  (If you just booked a load, wait a moment or refresh)
                </p>
              </div>
            ) : (
              activeLoads.map((load: any) => (
                <button
                  key={load.id}
                  onClick={() => setSelectedLoadId(load.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-all border",
                    selectedLoadId === load.id 
                      ? "bg-blue-900/20 border-blue-500/50" 
                      : "border-transparent hover:bg-slate-800"
                  )}
                >
                  <div className="flex justify-between mb-1">
                    <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">
                      #{load.loadNumber}
                    </Badge>
                    <div className="flex gap-1">
                      {load.driverConfirmedAt && (
                        <Badge className="text-[10px] bg-emerald-600">
                          ✓ Confirmed
                        </Badge>
                      )}
                      <Badge className={cn("text-[10px] uppercase", 
                        load.status === 'delivered' ? "bg-emerald-600" : "bg-blue-600"
                      )}>
                        {load.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="font-bold text-sm text-slate-200 truncate">
                    {load.originCity} <span className="text-slate-600">→</span> {load.destCity}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <Truck className="w-3 h-3" /> 
                    {load.driver ? (
                      <span className="text-emerald-400 font-medium">{load.driver.name}</span>
                    ) : (
                      <span className="text-red-500 font-bold">Unassigned</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* RIGHT PANEL: COMMAND WORKSPACE */}
      <div className="flex-1 flex flex-col bg-slate-950">
        {selectedLoad ? (
          <>
            {/* HEADER */}
            <div className="min-h-16 border-b border-slate-800 bg-slate-900/50 px-6 py-3 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  {selectedLoad.originCity} <ArrowRight className="w-5 h-5 text-slate-600" /> {selectedLoad.destCity}
                </h1>
                <p className="text-xs text-slate-400">
                  <span className="text-emerald-400 font-mono mr-3">${selectedLoad.rate}</span>
                  #{selectedLoad.loadNumber}
                </p>
              </div>
              
              {/* DRIVER ASSIGNMENT */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-slate-500" />
                  <Select
                    value={String(selectedLoad.driver?.id || "")}
                    onValueChange={(driverId) => {
                      assignDriverMutation.mutate({ loadId: selectedLoad.id, driverId });
                    }}
                  >
                    <SelectTrigger className="w-[200px] bg-slate-800 border-slate-600 text-slate-200 h-9 shadow-md">
                      <SelectValue placeholder="Select Driver" />
                    </SelectTrigger>
                    <SelectContent 
                      className="border border-slate-600 shadow-2xl max-h-[300px] z-[100]"
                      style={{ backgroundColor: '#0f172a' }}
                    >
                      {(drivers || []).map((driver: any) => (
                        <SelectItem 
                          key={driver.id} 
                          value={String(driver.id)}
                          className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-white cursor-pointer py-2.5 px-3"
                          style={{ backgroundColor: '#0f172a' }}
                        >
                          {driver.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex gap-2">
                 {/* VIEW RATECON DIALOG */}
                 <Dialog open={isRateConOpen} onOpenChange={setIsRateConOpen}>
                   <DialogTrigger asChild>
                     <Button size="sm" variant="outline" className="border-slate-700 hover:bg-slate-800 text-slate-300">
                        <FileText className="w-4 h-4 mr-2" /> View RateCon
                     </Button>
                   </DialogTrigger>
                   <DialogContent className="max-w-3xl h-[80vh] flex flex-col bg-white text-slate-900">
                     <DialogHeader className="border-b pb-4">
                       <DialogTitle className="flex justify-between items-center text-xl">
                         <span>Rate Confirmation #{selectedLoad.loadNumber}</span>
                         <Badge className="bg-blue-600 text-white">{selectedLoad.brokerName}</Badge>
                       </DialogTitle>
                     </DialogHeader>
                     <ScrollArea className="flex-1 p-6 bg-slate-50">
                       <div className="bg-white border shadow-sm p-8 min-h-[600px] text-sm">
                         <div className="flex justify-between border-b pb-6 mb-6">
                           <div>
                             <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Rate Confirmation</h3>
                             <p className="text-slate-500">Issued: {new Date(selectedLoad.createdAt).toLocaleDateString()}</p>
                           </div>
                           <div className="text-right">
                             <div className="text-3xl font-black text-emerald-600">${selectedLoad.rate}.00</div>
                             <p className="text-slate-400 font-medium">Flat Rate</p>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-12 mb-8">
                           <div>
                             <h4 className="font-bold text-slate-400 text-xs uppercase mb-2">Origin</h4>
                             <div className="text-lg font-bold text-slate-900">{selectedLoad.originCity}</div>
                             <div className="flex items-center gap-2 text-slate-600 mt-1"><Calendar className="w-4 h-4"/> {selectedLoad.pickupDate}</div>
                           </div>
                           <div>
                             <h4 className="font-bold text-slate-400 text-xs uppercase mb-2">Destination</h4>
                             <div className="text-lg font-bold text-slate-900">{selectedLoad.destCity}</div>
                             <div className="flex items-center gap-2 text-slate-600 mt-1"><Calendar className="w-4 h-4"/> {selectedLoad.deliveryDate}</div>
                           </div>
                         </div>
                         <div className="mb-8">
                           <h4 className="font-bold text-slate-800 border-b pb-2 mb-3">Special Instructions</h4>
                           <div className="bg-yellow-50 border border-yellow-100 p-4 text-slate-700 whitespace-pre-wrap font-mono text-xs">
                             {selectedLoad.specialInstructions || "No special instructions provided."}
                           </div>
                         </div>
                       </div>
                     </ScrollArea>
                   </DialogContent>
                 </Dialog>

                 <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Phone className="w-4 h-4 mr-2" /> Call Driver
                 </Button>
              </div>
            </div>

            {/* MAIN WORKSPACE TABS */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <Tabs defaultValue="sop" className="flex-1 flex flex-col">
                <div className="border-b border-slate-800 bg-slate-900/30 px-4">
                  <TabsList className="bg-transparent h-12 gap-6">
                    <TabsTrigger value="sop" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 rounded-none h-full px-0 bg-transparent text-slate-400">
                      <CheckCircle2 className="w-4 h-4 mr-2" /> SOP Checklist
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-400 rounded-none h-full px-0 bg-transparent text-slate-400">
                      <MessageSquare className="w-4 h-4 mr-2" /> Driver Chat
                    </TabsTrigger>
                    <TabsTrigger value="map" className="data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-400 rounded-none h-full px-0 bg-transparent text-slate-400">
                      <MapPin className="w-4 h-4 mr-2" /> Live Map
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 bg-slate-950 p-0 overflow-hidden">
                  <TabsContent value="sop" className="h-full m-0 p-6 overflow-y-auto">
                    <div className="max-w-3xl mx-auto">
                      <EVChecklist load={selectedLoad} />
                    </div>
                  </TabsContent>
                  <TabsContent value="chat" className="h-full m-0 flex flex-col">
                    <DriverChatWindow load={selectedLoad} />
                  </TabsContent>
                  <TabsContent value="map" className="h-full m-0">
                    <LiveMap load={selectedLoad} />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            Select a load to begin command.
          </div>
        )}
      </div>
    </div>
  );
}

function DriverChatWindow({ load }: { load: any }) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const driverId = load.driver?.id;

  const { data: allThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/communication/threads"],
    refetchInterval: 3000,
  });

  const driverThread = allThreads.find((t: any) => t.driverId === driverId);

  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ["/api/communication/messages", driverThread?.id],
    enabled: !!driverThread?.id,
    refetchInterval: 2000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      const response = await apiRequest("POST", `/api/communication/messages`, {
        threadId,
        content,
        sender: "dispatch"
      });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/communication/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/communication/messages", variables.threadId] });
      setMessage("");
      toast({ title: "Message sent", className: "bg-emerald-600 text-white" });
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    }
  });

  const handleSend = () => {
    if (message.trim() && driverThread?.id) {
      sendMessageMutation.mutate({ threadId: driverThread.id, content: message.trim() });
    }
  };

  if (!driverId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No driver assigned to this load.</p>
          <p className="text-xs mt-1">Assign a driver to start messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold">
          {load.driver?.name?.charAt(0) || '?'}
        </div>
        <div>
          <div className="font-semibold text-white">{load.driver?.name || 'Driver'}</div>
          <div className="text-xs text-slate-400">{load.driver?.phone || 'No phone'}</div>
        </div>
        {load.driver?.phone && (
          <Button 
            size="sm" 
            className="ml-auto bg-emerald-600 hover:bg-emerald-500 h-8"
            onClick={() => window.location.href = `tel:${load.driver.phone}`}
          >
            <Phone className="w-3 h-3 mr-1" /> Call
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="text-center text-slate-500 py-8">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No messages yet with {load.driver?.name}</p>
            <p className="text-xs mt-1">Send a message to start the conversation.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg: any) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.senderRole === 'dispatch' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2 shadow-lg",
                    msg.senderRole === 'dispatch'
                      ? "bg-blue-600 text-white rounded-tr-none"
                      : "bg-slate-800 text-slate-100 rounded-tl-none"
                  )}
                >
                  <p className="text-sm">{msg.textContent}</p>
                  <div className={cn(
                    "text-[10px] mt-1",
                    msg.senderRole === 'dispatch' ? "text-blue-200" : "text-slate-500"
                  )}>
                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <Input
            placeholder={`Message ${load.driver?.name || 'driver'}...`}
            className="bg-slate-950 border-slate-700 text-white focus-visible:ring-emerald-500 pl-4"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          />
          <Button
            size="icon"
            className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
            onClick={handleSend}
            disabled={!message.trim() || sendMessageMutation.isPending || !driverThread?.id}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
