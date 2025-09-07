import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Communication {
  id: string;
  threadId: string;
  loadNumber?: string;
  driverId: string;
  message: string;
  messageType: "text" | "image" | "document";
  fileUrl?: string;
  createdAt: string;
  isFromDriver: boolean;
}

interface Driver {
  id: string;
  name: string;
  status: string;
  telegramId?: string;
}

interface Load {
  id: string;
  loadNumber: string;
  pickupAddress: string;
  deliveryAddress: string;
  status: string;
  driverId?: string;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "yellow" | "red" }) {
  const tones = {
    neutral: "bg-slate-700 text-slate-100 border border-slate-600",
    green: "bg-emerald-600/20 text-emerald-300 border border-emerald-600/40",
    yellow: "bg-amber-600/20 text-amber-300 border border-amber-600/40",
    red: "bg-rose-600/20 text-rose-300 border border-rose-600/40",
  };
  return (
    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${tones[tone]}`}>{children}</span>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800/70 text-slate-200">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="text-xl font-semibold text-slate-100">{value}</span>
      </div>
    </div>
  );
}

function CommunicationCard({ thread, drivers, onSendMessage }: { 
  thread: any; 
  drivers: Driver[]; 
  onSendMessage: (driverId: string, message: string) => void;
}) {
  const [messageText, setMessageText] = useState("");
  
  const driver = drivers.find(d => d.id === thread.driverId);
  const lastMessage = thread.lastMessage;
  const unreadCount = thread.unreadCount || 0;
  
  const priority = unreadCount > 5 ? "HIGH" : unreadCount > 0 ? "MEDIUM" : "LOW";
  const tone = priority === "HIGH" ? "red" : priority === "MEDIUM" ? "yellow" : "neutral";
  
  const handleSendMessage = () => {
    if (messageText.trim() && thread.driverId) {
      onSendMessage(thread.driverId, messageText.trim());
      setMessageText("");
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-sm ring-1 ring-black/0">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-slate-300 text-lg font-semibold">{thread.loadNumber || thread.threadId}</span>
          <Badge tone={tone}>{priority}</Badge>
          <Badge tone="neutral">{unreadCount > 0 ? "UNREAD" : "ACTIVE"}</Badge>
        </div>
      </div>
      
      <p className="text-slate-400 text-sm mb-1">COMMUNICATION • {thread.threadId}</p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-slate-500">Driver:</span> <span className="text-slate-200">{driver?.name || "Unknown"}</span></div>
        <div><span className="text-slate-500">Load:</span> <span className="text-slate-200">{thread.loadNumber || "General"}</span></div>
        <div><span className="text-slate-500">Messages:</span> <span className="text-slate-200">{thread.messageCount || 0}</span></div>
        <div><span className="text-slate-500">Last Contact:</span> <span className="text-slate-200">{lastMessage ? new Date(lastMessage.createdAt).toLocaleString() : "No messages"}</span></div>
      </div>
      
      {lastMessage && (
        <p className="mt-3 text-slate-300 text-sm leading-relaxed">
          {lastMessage.isFromDriver ? "Driver: " : "Dispatch: "}{lastMessage.message}
        </p>
      )}
      
      <div className="mt-4 flex flex-wrap gap-2">
        <div className="flex flex-1 gap-2">
          <input 
            type="text"
            placeholder="Type a message..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
            data-testid={`message-input-${thread.threadId}`}
          />
          <button 
            onClick={handleSendMessage}
            disabled={!messageText.trim()}
            className="rounded-xl border border-emerald-700 bg-emerald-600/20 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-50"
            data-testid={`send-message-${thread.threadId}`}
          >
            Send Telegram
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DispatchCommandCenter() {
  const [activeTab, setActiveTab] = useState("Communications");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch communication threads
  const { data: threads = [], isLoading: threadsLoading } = useQuery({
    queryKey: ["/api/communications/threads"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Fetch drivers
  const { data: drivers = [], isLoading: driversLoading } = useQuery({
    queryKey: ["/api/drivers"],
  });

  // Fetch loads for KPIs
  const { data: loads = [], isLoading: loadsLoading } = useQuery({
    queryKey: ["/api/loads"],
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ driverId, message }: { driverId: string; message: string }) => {
      return apiRequest(`/api/communications/send`, {
        method: "POST",
        body: { driverId, message, messageType: "text" }
      });
    },
    onSuccess: () => {
      toast({
        title: "Message Sent",
        description: "Your message has been sent to the driver",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/communications/threads"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Calculate KPIs
  const availableDrivers = drivers.filter((d: Driver) => d.status === "available").length;
  const enRouteDrivers = drivers.filter((d: Driver) => d.status === "on_route").length;
  const activeThreads = threads.filter((t: any) => t.unreadCount > 0).length;
  const totalMessages = threads.reduce((sum: number, t: any) => sum + (t.messageCount || 0), 0);

  const kpis = [
    { 
      label: "Active Threads", 
      value: activeThreads, 
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ) 
    },
    { 
      label: "Available Drivers", 
      value: availableDrivers, 
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/>
          <path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      ) 
    },
    { 
      label: "En Route", 
      value: enRouteDrivers, 
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 12H2"/>
          <path d="M14 5l7 7-7 7"/>
        </svg>
      ) 
    },
    { 
      label: "Total Messages", 
      value: totalMessages, 
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      ) 
    },
    { 
      label: "Active Loads", 
      value: loads.filter((l: Load) => l.status === "assigned" || l.status === "in_transit").length, 
      icon: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 3h5v5"/>
          <path d="M8 3H3v5"/>
          <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/>
          <path d="M21 3l-7.828 7.828A4 4 0 0 0 12 13.657V22"/>
        </svg>
      ) 
    },
  ];

  const tabs = [
    "Communications",
    "Active Loads",
    "Driver Status",
    "Load Issues",
    "Message History",
  ];

  const handleSendMessage = (driverId: string, message: string) => {
    sendMessageMutation.mutate({ driverId, message });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Nav */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500" />
            <span className="font-semibold tracking-wide">LAMP Dispatch</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <a className="hover:text-slate-100" href="/dashboard">Dashboard</a>
            <a className="hover:text-slate-100" href="/driver-management">Drivers</a>
            <a className="hover:text-slate-100" href="/loads">Loads</a>
            <a className="hover:text-slate-100" href="/dispatcher">Dispatcher</a>
            <a className="text-slate-100" href="/dispatch-command-center">Communications</a>
            <a className="hover:text-slate-100" href="/gps-tracking">Live Tracking</a>
          </nav>
        </div>
      </header>

      {/* Page Heading */}
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dispatch Command Center</h1>
            <p className="text-slate-400">Central hub for driver communication and dispatch operations</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="green">System Online</Badge>
            <button className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">
              Alerts ({activeThreads})
            </button>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-6 flex items-center gap-2 overflow-x-auto">
          {tabs.map((t, i) => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
                activeTab === t 
                  ? "border-slate-600 bg-slate-800 text-slate-100" 
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
              data-testid={`tab-${t.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Filters Row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex w-full sm:w-auto items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input 
              placeholder="Search communications…" 
              className="w-full bg-transparent outline-none placeholder:text-slate-500" 
              data-testid="search-communications"
            />
          </div>
          <select className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            <option>All Threads</option>
            <option>Unread Only</option>
            <option>Load Specific</option>
          </select>
          <button className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            Filters
          </button>
        </div>

        {/* Communication Cards */}
        {threadsLoading ? (
          <div className="mt-6 text-center text-slate-400">Loading communication threads...</div>
        ) : threads.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {threads.map((thread: any) => (
              <CommunicationCard 
                key={thread.threadId} 
                thread={thread} 
                drivers={drivers}
                onSendMessage={handleSendMessage}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 text-center text-slate-400">
            <p>No active communication threads.</p>
            <p className="text-sm mt-2">Communication threads will appear here when drivers send messages.</p>
          </div>
        )}
      </section>
    </div>
  );
}