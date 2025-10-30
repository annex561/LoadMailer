import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText, UserPlus, Bot, MessageSquare, Headphones, DollarSign, Smile, Upload, MapPin, Wrench, Brain, ChevronLeft, ChevronRight, Menu, X, TrendingUp, Webhook, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  // Core Operations
  { name: "Main Dashboard", href: "/loadops-dashboard", icon: LayoutDashboard, section: "core" },
  { name: "Loads", href: "/loads", icon: Package, section: "core" },
  { name: "DAT Loads", href: "/dat-loads", icon: Truck, section: "core" },
  { name: "Manual Load Entry", href: "/manual-load-entry", icon: UserPlus, section: "core" },
  
  // Driver Management
  { name: "Driver Management", href: "/driver-management", icon: UserPlus, section: "drivers" },
  { name: "Driver Onboarding", href: "/driver-onboarding", icon: UserPlus, section: "drivers" },
  { name: "Simple Registration", href: "/simple-registration", icon: UserPlus, section: "drivers" },
  { name: "Driver Dashboard", href: "/driver-dashboard", icon: UserPlus, section: "drivers" },
  { name: "GPS Tracking", href: "/gps-tracking", icon: MapPin, section: "drivers" },
  
  // Communication
  { name: "Customers", href: "/contacts", icon: Users, section: "comm" },
  { name: "Driver Messages", href: "/communication-dashboard", icon: MessageSquare, section: "comm" },
  { name: "AI Communication Insights", href: "/ai-communication-insights", icon: Brain, section: "comm" },
  { name: "LoadMailer Control", href: "/loadmailer-control", icon: Mail, section: "comm" },
  { name: "Telegram Dispatching", href: "/telegram-dispatching", icon: MessageSquare, section: "comm" },
  { name: "SMS Status", href: "/sms-status", icon: MessageSquare, section: "comm" },
  
  // AI & Smart Features
  { name: "Smart Load Matching", href: "/smart-load-matching", icon: Brain, section: "smart" },
  { name: "Analytics Dashboard", href: "/analytics", icon: BarChart3, section: "smart" },
  { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Wrench, section: "smart" },
  { name: "Prediction Confidence", href: "/prediction-confidence", icon: TrendingUp, section: "smart" },
  
  // System & Reports
  { name: "Admin Overview", href: "/admin-overview", icon: BarChart3, section: "system" },
  { name: "Payment Workflow", href: "/payments", icon: DollarSign, section: "system" },
  { name: "Templates", href: "/templates", icon: FileText, section: "system" },
  { name: "Scraper Management", href: "/scrapers", icon: Bot, section: "system" },
  { name: "Debug Token", href: "/debug-token", icon: Wrench, section: "system" },
  { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Headphones, section: "system" },
  { name: "Dispatcher Vehicle Dashboard", href: "/dispatcher-vehicle-dashboard", icon: Truck, section: "system" },
  { name: "Document Management", href: "/document-management", icon: FileText, section: "system" },
  { name: "DAT Scraper", href: "/dat-scraper", icon: Bot, section: "system" },
  { name: "DAT Login", href: "/dat-login", icon: Bot, section: "system" },
  { name: "SMS Dispatching", href: "/sms-dispatching", icon: MessageSquare, section: "system" },
  { name: "TaskMagic Status", href: "/taskmagic-status", icon: Webhook, section: "system" },
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
            <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
              <img src="/traq-logo.png" alt="TRAQ IQ Logo" className="w-full h-full object-contain" />
            </div>
            {!isCollapsed && (
              <div>
                <h1 className="text-xl font-bold text-gray-900">TRAQ IQ</h1>
                <p className="text-xs text-gray-500">Smart Logistics Management</p>
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
        {/* Core Operations Section */}
        {!isCollapsed && (
          <div className="px-6 py-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Core Operations</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "core").map((item) => {
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

        {/* Driver Management Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Driver Management</p>
          </div>
        )}
        <ul className={cn("mt-2 space-y-1", isCollapsed && "px-2")}>
          {navigation.filter(item => item.section === "drivers").map((item) => {
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
          {navigation.filter(item => item.section === "comm").map((item) => {
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

        {/* AI & Smart Features Section */}
        {!isCollapsed && (
          <div className="px-6 py-2 mt-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI & Smart Features</p>
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
