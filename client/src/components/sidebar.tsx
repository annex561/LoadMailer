import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Truck, 
  FileText, 
  DollarSign, 
  Settings, 
  ChevronDown,
  MessageSquare,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";

type MenuItem = { name: string; href: string; adminOnly?: boolean };
type MenuGroup = { title: string; icon: JSX.Element; adminOnly?: boolean; items: MenuItem[] };

const menuGroups: MenuGroup[] = [
  {
    title: "Dispatch Command",
    icon: <LayoutDashboard className="w-5 h-5" />,
    items: [
      // Dispatchers need the Live Map to see driver locations when assigning loads.
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
      { name: "Upload RateCon", href: "/ratecon-upload" },
      { name: "Review Queue", href: "/review-queue" },
      { name: "Active Loads", href: "/active-loads" },
      { name: "Load History", href: "/loads" },
      { name: "Driver Messages", href: "/communication-dashboard" },
      { name: "Create New Load", href: "/manual-load-entry" },
      { name: "The Load Board", href: "/dat-loads" },
      // Templates are SMS canned-message tools the dispatcher uses daily.
      { name: "SMS Templates", href: "/templates" },
      { name: "Items (AR)", href: "/items", adminOnly: true },
    ]
  },
  {
    title: "Fleet & Drivers",
    icon: <Truck className="w-5 h-5" />,
    items: [
      { name: "Fleet Dashboard", href: "/fleet", adminOnly: true },
      { name: "Driver Roster", href: "/driver-management" },
      { name: "Onboarding", href: "/driver-onboarding" },
      { name: "Trucks", href: "/fleet/trucks", adminOnly: true },
      { name: "Work Orders", href: "/fleet/work-orders", adminOnly: true },
      { name: "Inspections", href: "/fleet/inspections", adminOnly: true },
    ]
  },
  {
    // Finance section is admin-only; dispatchers don't see rates/settlements/analytics.
    title: "Finance",
    icon: <DollarSign className="w-5 h-5" />,
    adminOnly: true,
    items: [
      { name: "True RPM Calc", href: "/true-rpm-calculator", adminOnly: true },
      { name: "Fleet Calculator", href: "/fleet-calculator", adminOnly: true },
      { name: "Payments", href: "/payments", adminOnly: true },
      { name: "Driver Settlements", href: "/settlements", adminOnly: true },
      { name: "Analytics", href: "/analytics", adminOnly: true },
    ]
  },
  {
    // Ops Monitor is system health — admin only.
    title: "System",
    icon: <Truck className="w-5 h-5" />,
    adminOnly: true,
    items: [
      { name: "Ops Monitor", href: "/ops", adminOnly: true },
    ]
  },
  {
    title: "Communication",
    icon: <MessageSquare className="w-5 h-5" />,
    items: [
      // AI Insights is an analytics page — admin only.
      { name: "AI Insights", href: "/ai-communication-insights", adminOnly: true },
      { name: "Customers", href: "/contacts" },
      { name: "SMS Status", href: "/sms-status" },
    ]
  },
  {
    title: "Admin",
    icon: <Settings className="w-5 h-5" />,
    adminOnly: true,
    items: [
      { name: "Admin Overview", href: "/admin-overview", adminOnly: true },
      { name: "Team", href: "/users", adminOnly: true },
      { name: "Gmail Settings", href: "/gmail-settings", adminOnly: true },
      { name: "DAT Login", href: "/dat-login", adminOnly: true },
      { name: "Debug", href: "/debug-token", adminOnly: true },
    ]
  }
];

export function SidebarNav() {
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<string[]>(["Dispatch Command", "Load Management"]);
  const { user, logout } = useUser();
  const isAdmin = user?.role === "admin";

  const visibleGroups = menuGroups
    .filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.adminOnly || isAdmin),
    }))
    .filter((g) => g.items.length > 0);

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
        {visibleGroups.map((group) => (
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
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-slate-900 font-bold text-sm">
            {user?.username?.substring(0, 2).toUpperCase() || "AL"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user?.username || "Guest"}</p>
            <p className="text-xs text-slate-500 truncate capitalize">{user?.role || "Admin"}</p>
          </div>
        </div>
        
        <button 
          onClick={() => logout()}
          className="w-full flex items-center gap-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 p-2 rounded-md transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  return <SidebarNav />;
}
