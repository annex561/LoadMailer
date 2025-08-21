import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText, UserPlus, Bot, MessageSquare, Headphones, DollarSign, Smile, Upload, MapPin, Wrench, Brain, ChevronLeft, ChevronRight, Menu, X, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, section: "main" },
  { name: "LoadOps Dashboard", href: "/loadops-dashboard", icon: TrendingUp, section: "main" },
  { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Headphones, section: "main" },
  { name: "Manage Loads", href: "/loads", icon: Package, section: "main" },
  { name: "DAT Loads", href: "/dat-loads", icon: Truck, section: "main" },
  { name: "DAT Login", href: "/dat-login", icon: Bot, section: "main" },
  { name: "Telegram Dispatching", href: "/telegram-dispatching", icon: MessageSquare, section: "main" },
  { name: "Contacts", href: "/contacts", icon: Users, section: "main" },
  { name: "Driver Management", href: "/driver-management", icon: UserPlus, section: "main" },
  { name: "Vehicle Management", href: "/dispatcher-vehicle-dashboard", icon: Truck, section: "main" },
  { name: "LoadMailer Bot", href: "/loadmailer-control", icon: Bot, section: "main" },
  { name: "GPS Tracking", href: "/gps-tracking", icon: MapPin, section: "main" },
  { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Wrench, section: "main" },
  { name: "Smart Load Matching", href: "/smart-load-matching", icon: Brain, section: "main" },
  { name: "Prediction Confidence", href: "/prediction-confidence", icon: TrendingUp, section: "main" },
  { name: "Mood Tracker", href: "/mood-tracker", icon: Smile, section: "main" },
  { name: "Payment Workflow", href: "/payments", icon: DollarSign, section: "main" },
  { name: "DAT Scrapers", href: "/scrapers", icon: Bot, section: "main" },
  { name: "Email Templates", href: "/templates", icon: Mail, section: "main" },
  { name: "Analytics", href: "/analytics", icon: BarChart3, section: "reports" },
  { name: "Email Logs", href: "/email-logs", icon: FileText, section: "reports" },
];

export default function Sidebar() {
  const [location] = useLocation();
  // Simple local state for now - will be upgraded to context later
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={cn(
      "bg-white shadow-lg min-h-screen fixed left-0 top-0 z-40 transition-all duration-300 ease-in-out",
      isCollapsed ? "w-16" : "w-64"
    )}>
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className={cn(
            "flex items-center space-x-3 transition-all duration-300",
            isCollapsed && "justify-center"
          )}>
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Truck className="text-white w-5 h-5" />
            </div>
            {!isCollapsed && (
              <div>
                <h1 className="text-xl font-bold text-gray-900">LoadMaster</h1>
                <p className="text-xs text-gray-500">Fleet Management</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "hover:bg-gray-100",
              isCollapsed && "absolute top-6 right-2"
            )}
            data-testid="sidebar-toggle"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      
      <nav className="mt-6">
        {!isCollapsed && (
          <div className="px-6 py-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Main</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "main").map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    "flex items-center py-3 text-sm font-medium transition-colors relative group",
                    isCollapsed 
                      ? "px-2 justify-center" 
                      : "px-6",
                    isActive
                      ? "text-primary bg-blue-50 border-r-3 border-primary"
                      : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <Icon className={cn(
                    "w-5 h-5", 
                    !isCollapsed && "mr-3"
                  )} />
                  {!isCollapsed && <span>{item.name}</span>}
                  {isCollapsed && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                      {item.name}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        
        {!isCollapsed && (
          <div className="px-6 py-2 mt-8">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reports</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "reports").map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    "flex items-center py-3 text-sm font-medium transition-colors relative group",
                    isCollapsed 
                      ? "px-2 justify-center" 
                      : "px-6",
                    isActive
                      ? "text-primary bg-blue-50 border-r-3 border-primary"
                      : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <Icon className={cn(
                    "w-5 h-5", 
                    !isCollapsed && "mr-3"
                  )} />
                  {!isCollapsed && <span>{item.name}</span>}
                  {isCollapsed && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                      {item.name}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
