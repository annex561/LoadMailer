import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText, UserPlus, Bot, MessageSquare, Headphones, DollarSign, Smile, Upload, MapPin, Wrench, Brain, ChevronLeft, ChevronRight, Menu, X, TrendingUp, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  // Dashboards & Operations
  { name: "Dashboard", href: "/", icon: LayoutDashboard, section: "dashboards" },
  { name: "LoadOps Dashboard", href: "/loadops-dashboard", icon: TrendingUp, section: "dashboards" },
  { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Headphones, section: "dashboards" },
  
  // Load Management
  { name: "Manage Loads", href: "/loads", icon: Package, section: "loads" },
  { name: "DAT Loads", href: "/dat-loads", icon: Truck, section: "loads" },
  { name: "Manual Load Entry", href: "/manual-load-entry", icon: UserPlus, section: "loads" },
  { name: "DAT Login", href: "/dat-login", icon: Bot, section: "loads" },
  { name: "DAT Scrapers", href: "/scrapers", icon: Bot, section: "loads" },
  
  // Communication & Dispatch
  { name: "Telegram Dispatching", href: "/telegram-dispatching", icon: MessageSquare, section: "communication" },
  { name: "LoadMailer Bot", href: "/loadmailer-control", icon: Bot, section: "communication" },
  { name: "Email Templates", href: "/templates", icon: Mail, section: "communication" },
  
  // Fleet Management
  { name: "Driver Management", href: "/driver-management", icon: UserPlus, section: "fleet" },
  { name: "Vehicle Management", href: "/dispatcher-vehicle-dashboard", icon: Truck, section: "fleet" },
  { name: "Contacts", href: "/contacts", icon: Users, section: "fleet" },
  { name: "GPS Tracking", href: "/gps-tracking", icon: MapPin, section: "fleet" },
  
  // Smart Operations
  { name: "Smart Load Matching", href: "/smart-load-matching", icon: Brain, section: "smart" },
  { name: "Prediction Confidence", href: "/prediction-confidence", icon: TrendingUp, section: "smart" },
  { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Wrench, section: "smart" },
  { name: "Mood Tracker", href: "/mood-tracker", icon: Smile, section: "smart" },
  { name: "Payment Workflow", href: "/payments", icon: DollarSign, section: "smart" },
  
  // System & Reports
  { name: "TaskMagic Status", href: "/taskmagic-status", icon: Webhook, section: "system" },
  { name: "Analytics", href: "/analytics", icon: BarChart3, section: "system" },
  { name: "Email Logs", href: "/email-logs", icon: FileText, section: "system" },
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
                <h1 className="text-xl font-bold text-gray-900">Load Signal</h1>
                <p className="text-xs text-gray-500">Signal in. Load booked out</p>
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
        {/* Dashboards Section */}
        {!isCollapsed && (
          <div className="px-6 py-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Dashboards</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "dashboards").map((item) => {
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

        {/* Load Management Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Load Management</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "loads").map((item) => {
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

        {/* Communication & Dispatch Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Communication</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "communication").map((item) => {
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

        {/* Fleet Management Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Fleet Management</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "fleet").map((item) => {
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

        {/* Smart Operations Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Smart Operations</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "smart").map((item) => {
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

        {/* System & Reports Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">System & Reports</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "system").map((item) => {
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
