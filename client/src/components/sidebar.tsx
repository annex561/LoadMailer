import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Truck, 
  FileText, 
  DollarSign, 
  Settings, 
  ChevronDown,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const menuGroups = [
  {
    title: "Dispatch Command",
    icon: <LayoutDashboard className="w-5 h-5" />,
    items: [
      { name: "Control Tower", href: "/dispatcher" },
      { name: "Load Ops Board", href: "/loadops-dashboard" },
      { name: "Live Map", href: "/gps-tracking" },
    ]
  },
  {
    title: "Load Management",
    icon: <FileText className="w-5 h-5" />,
    items: [
      { name: "RateCon Inbox", href: "/loads-inbox" },
      { name: "Load History", href: "/loads" },
      { name: "Create New Load", href: "/manual-load-entry" },
      { name: "DAT Load Board", href: "/dat-loads" },
      { name: "Items (AR)", href: "/items" },
    ]
  },
  {
    title: "Fleet & Drivers",
    icon: <Truck className="w-5 h-5" />,
    items: [
      { name: "Fleet Dashboard", href: "/fleet" },
      { name: "Driver Roster", href: "/driver-management" },
      { name: "Onboarding", href: "/driver-onboarding" },
      { name: "Trucks", href: "/fleet/trucks" },
      { name: "Work Orders", href: "/fleet/work-orders" },
      { name: "Inspections", href: "/fleet/inspections" },
    ]
  },
  {
    title: "Finance",
    icon: <DollarSign className="w-5 h-5" />,
    items: [
      { name: "Fleet Calculator", href: "/fleet-calculator" },
      { name: "Payments", href: "/payments" },
      { name: "Analytics", href: "/analytics" },
    ]
  },
  {
    title: "Communication",
    icon: <MessageSquare className="w-5 h-5" />,
    items: [
      { name: "Driver Messages", href: "/communication-dashboard" },
      { name: "AI Insights", href: "/ai-communication-insights" },
      { name: "Customers", href: "/contacts" },
      { name: "SMS Status", href: "/sms-status" },
    ]
  },
  {
    title: "System",
    icon: <Settings className="w-5 h-5" />,
    items: [
      { name: "Admin Overview", href: "/admin-overview" },
      { name: "Templates", href: "/templates" },
      { name: "DAT Login", href: "/dat-login" },
      { name: "Debug", href: "/debug-token" },
    ]
  }
];

export function SidebarNav() {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>(["Dispatch Command", "Load Management"]);

  const toggleGroup = (title: string) => {
    setOpenGroups(prev => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  return (
    <div className="w-64 bg-slate-900 h-screen flex flex-col text-slate-300 border-r border-slate-800 fixed left-0 top-0 z-40">
      
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
          <img src="/traq-logo.png" alt="TRAQ IQ" className="w-full h-full object-contain" />
        </div>
        <span className="text-xl font-bold text-white tracking-tight">TRAQ IQ</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-6">
        {menuGroups.map((group) => (
          <div key={group.title}>
            <button 
              onClick={() => toggleGroup(group.title)}
              className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 hover:text-slate-300 transition-colors"
            >
              <div className="flex items-center gap-2">
                {group.icon}
                <span>{group.title}</span>
              </div>
              <ChevronDown className={cn("w-3 h-3 transition-transform", openGroups.includes(group.title) && "rotate-180")} />
            </button>

            {openGroups.includes(group.title) && (
              <div className="space-y-1 ml-2 border-l border-slate-800 pl-3">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <a className={cn(
                      "block px-3 py-2 text-sm rounded-md transition-all duration-200",
                      location === item.href 
                        ? "bg-blue-600/10 text-blue-400 font-medium border-r-2 border-blue-500" 
                        : "hover:bg-slate-800 hover:text-white"
                    )}>
                      {item.name}
                    </a>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-950/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-slate-900 font-bold text-xs">
            AL
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">Annex Luberisse</p>
            <p className="text-xs text-slate-500 truncate">Executive Admin</p>
          </div>
          <Settings className="w-4 h-4 ml-auto text-slate-500 cursor-pointer hover:text-white" />
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  return <SidebarNav />;
}
