import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, Truck, Map, FileText, DollarSign, 
  Users, Settings, ChevronDown, ShieldAlert 
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  FINANCE: "finance",
  DRIVER: "driver"
};

const menuGroups = [
  {
    title: "Dispatch Command",
    allowedRoles: [ROLES.ADMIN, ROLES.DISPATCHER],
    icon: <LayoutDashboard className="w-5 h-5" />,
    items: [
      { name: "Control Tower", href: "/" },
      { name: "Load Ops Board", href: "/dispatch" },
      { name: "Live Map", href: "/map" },
      { name: "RateCon Inbox", href: "/loads-inbox" },
      { name: "Active Loads", href: "/active-loads" },
    ]
  },
  {
    title: "Load Management",
    allowedRoles: [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.FINANCE],
    icon: <FileText className="w-5 h-5" />,
    items: [
      { name: "Load History", href: "/loads" },
      { name: "Create New Load", href: "/loads/new" },
      { name: "DAT Load Board", href: "/dat-search" },
    ]
  },
  {
    title: "Fleet & Drivers",
    allowedRoles: [ROLES.ADMIN, ROLES.DISPATCHER],
    icon: <Truck className="w-5 h-5" />,
    items: [
      { name: "Driver Roster", href: "/drivers" },
      { name: "Onboarding", href: "/onboarding" },
      { name: "Safety & Compliance", href: "/safety" },
    ]
  },
  {
    title: "Finance & Admin",
    allowedRoles: [ROLES.ADMIN, ROLES.FINANCE],
    icon: <DollarSign className="w-5 h-5" />,
    items: [
      { name: "Factoring Ready", href: "/factoring" },
      { name: "Invoices (AR)", href: "/finance" },
      { name: "User Management", href: "/admin/users" },
    ]
  }
];

export function SidebarNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [openGroups, setOpenGroups] = useState<string[]>(["Dispatch Command", "Load Management"]);

  const toggleGroup = (title: string) => {
    setOpenGroups(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
  };

  if (!user) return null;

  return (
    <div className="w-64 bg-slate-900 h-screen flex flex-col text-slate-300 border-r border-slate-800">
      
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white">Q</div>
        <span className="text-xl font-bold text-white tracking-tight">TRAQ IQ</span>
      </div>

      <div className="px-6 pb-4">
        <span className="text-[10px] font-bold uppercase tracking-widest bg-slate-800 text-slate-400 px-2 py-1 rounded">
          {user.role} View
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-6">
        {menuGroups.map((group) => {
          if (!group.allowedRoles.includes(user.role)) return null;

          return (
            <div key={group.title}>
              <button 
                onClick={() => toggleGroup(group.title)}
                className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 hover:text-slate-300"
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
                        "block px-3 py-2 text-sm rounded-md transition-all",
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
          );
        })}
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-950/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-slate-900 font-bold text-xs">
            {user.username.substring(0,2).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user.username}</p>
            <p className="text-xs text-slate-500 truncate capitalize">{user.role}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
