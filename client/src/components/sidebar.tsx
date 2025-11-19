import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText, UserPlus, Bot, MessageSquare, Headphones, DollarSign, Smile, Upload, MapPin, Wrench, Brain, ChevronLeft, ChevronRight, Menu, X, TrendingUp, Webhook, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  // Core Operations - Unified Dispatcher Workspace
  { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Headphones, section: "core" },
  { name: "Finance Dashboard", href: "/loadops-dashboard", icon: DollarSign, section: "core" },
  
  // Driver Management
  { name: "Driver Onboarding", href: "/driver-onboarding", icon: UserPlus, section: "drivers" },
  { name: "Simple Registration", href: "/simple-registration", icon: UserPlus, section: "drivers" },
  { name: "Driver Dashboard", href: "/driver-dashboard", icon: UserPlus, section: "drivers" },
  
  // Communication
  { name: "Customers", href: "/contacts", icon: Users, section: "comm" },
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
];

export default function Sidebar() {
  const [location] = useLocation();
  // Simple local state for now - will be upgraded to context later
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={cn(
      "bg-white dark:bg-slate-900 shadow-lg min-h-screen fixed left-0 top-0 z-40 transition-all duration-300 ease-in-out border-r border-gray-200 dark:border-slate-800",
      isCollapsed ? "w-16" : "w-64"
    )} style={{ backgroundColor: 'white', opacity: 1 }}>
      <div className="p-6 border-b border-gray-200 dark:border-slate-800">
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
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">TRAQ IQ</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Smart Logistics Management</p>
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
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Core Operations</p>
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
                      ? "text-primary bg-blue-50 dark:bg-slate-800 border-r-3 border-primary"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-primary"
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
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Driver Management</p>
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
                      ? "text-primary bg-blue-50 dark:bg-slate-800 border-r-3 border-primary"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-primary"
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
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Communication</p>
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
                      ? "text-primary bg-blue-50 dark:bg-slate-800 border-r-3 border-primary"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-primary"
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
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">AI & Smart Features</p>
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
                      ? "text-primary bg-blue-50 dark:bg-slate-800 border-r-3 border-primary"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-primary"
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
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">System & Reports</p>
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
                      ? "text-primary bg-blue-50 dark:bg-slate-800 border-r-3 border-primary"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-primary"
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
