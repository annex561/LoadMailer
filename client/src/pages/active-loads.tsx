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
import { useState, useEffect } from "react";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import { useToast } from "@/hooks/use-toast";
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
    // Show strictly these active states
    return ["dispatched", "in_transit", "delivered", "assigned", "active"].includes(status);
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
            <Truck className="w-4 h-4 text-emerald-500" /> Active Fleet ({activeLoads.length})
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
                    value={String(selectedLoad.driverId || "")}
                    onValueChange={(driverId) => {
                      assignDriverMutation.mutate({ loadId: selectedLoad.id, driverId });
                    }}
                  >
                    <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-slate-200 h-8">
                      <SelectValue placeholder="Assign Driver" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {(drivers || []).map((driver: any) => (
                        <SelectItem 
                          key={driver.id} 
                          value={String(driver.id)}
                          className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700"
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
                  <TabsContent value="map" className="h-full m-0 bg-slate-900 flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <MapPin className="w-16 h-16 mx-auto mb-4 opacity-20" />
                      <p>GPS Map Integration Pending</p>
                    </div>
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

// --- CHAT WINDOW COMPONENT ---
function DriverChatWindow({ load }: { load: any }) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: messages } = useQuery({
    queryKey: [`/api/messages/load/${load.id}`],
    queryFn: async () => { try { return await (await fetch(`/api/messages/load/${load.id}`)).json() } catch { return [] } }
  });

  const sendMessage = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/sms/send-template", { loadId: load.id, type: "CUSTOM", customBody: message });
    },
    onSuccess: () => {
      setMessage("");
      toast({ title: "SMS Sent", className: "bg-emerald-600 text-white" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to send SMS", variant: "destructive" });
    }
  });

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        <div className="text-center text-xs text-slate-600 my-4">Conversation started with {load.driver?.name || 'Unassigned Driver'}</div>
        <div className="flex justify-end">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-2xl rounded-tr-none max-w-[80%] text-sm shadow-lg shadow-blue-900/20">
            {load.sopProgress?.initialSms ? "Load details sent via SMS." : "Chat started."}
          </div>
        </div>
      </div>
      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <Input 
            placeholder="Type message to driver..." 
            className="bg-slate-950 border-slate-700 text-white focus-visible:ring-emerald-500 pl-4"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage.mutate()}
          />
          <Button size="icon" className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0" onClick={() => sendMessage.mutate()} disabled={!message}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
