import { Link, useLocation } from "wouter";
import { useState } from "react";
import { 
  Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText, 
  UserPlus, Bot, MessageSquare, Headphones, DollarSign, Smile, Upload, 
  MapPin, Wrench, Brain, ChevronLeft, ChevronRight, Menu, X, TrendingUp, 
  Webhook, Sheet, Radio, Calculator, ClipboardCheck, AlertTriangle, Inbox
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Headphones, section: "core" },
  { name: "Finance Dashboard", href: "/loadops-dashboard", icon: DollarSign, section: "core" },
  { name: "Fleet Calculator", href: "/fleet-calculator", icon: Calculator, section: "core" },
  { name: "GA Loads Inbox", href: "/loads-inbox", icon: Inbox, section: "core" },
  { name: "Items", href: "/items", icon: FileText, section: "core" },
  
  { name: "Fleet Dashboard", href: "/fleet", icon: Truck, section: "fleet" },
  { name: "Trucks", href: "/fleet/trucks", icon: Truck, section: "fleet" },
  { name: "Work Orders", href: "/fleet/work-orders", icon: Wrench, section: "fleet" },
  { name: "Inspections", href: "/fleet/inspections", icon: ClipboardCheck, section: "fleet" },
  { name: "Vendors", href: "/fleet/vendors", icon: Users, section: "fleet" },
  
  { name: "Driver Onboarding", href: "/driver-onboarding", icon: UserPlus, section: "drivers" },
  { name: "Simple Registration", href: "/simple-registration", icon: UserPlus, section: "drivers" },
  { name: "Driver Dashboard", href: "/driver-dashboard", icon: UserPlus, section: "drivers" },
  
  { name: "Customers", href: "/contacts", icon: Users, section: "comm" },
  { name: "AI Communication Insights", href: "/ai-communication-insights", icon: Brain, section: "comm" },
  { name: "LoadMailer Control", href: "/loadmailer-control", icon: Mail, section: "comm" },
  { name: "Telegram Dispatching", href: "/telegram-dispatching", icon: MessageSquare, section: "comm" },
  { name: "SMS Status", href: "/sms-status", icon: MessageSquare, section: "comm" },
  
  { name: "Smart Load Matching", href: "/smart-load-matching", icon: Brain, section: "smart" },
  { name: "Analytics Dashboard", href: "/analytics", icon: BarChart3, section: "smart" },
  { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Wrench, section: "smart" },
  { name: "Prediction Confidence", href: "/prediction-confidence", icon: TrendingUp, section: "smart" },
  
  { name: "Admin Overview", href: "/admin-overview", icon: BarChart3, section: "system" },
  { name: "Payment Workflow", href: "/payments", icon: DollarSign, section: "system" },
  { name: "Templates", href: "/templates", icon: FileText, section: "system" },
  { name: "Scraper Management", href: "/scrapers", icon: Bot, section: "system" },
  { name: "Debug Token", href: "/debug-token", icon: Wrench, section: "system" },
];

interface NavSectionProps {
  title: string;
  items: typeof navigation;
  location: string;
  isCollapsed: boolean;
}

function NavSection({ title, items, location, isCollapsed }: NavSectionProps) {
  return (
    <div className="mb-6">
      {!isCollapsed && (
        <div className="px-4 py-2">
          <p className="text-[11px] font-semibold text-[hsl(var(--sidebar-foreground)/0.5)] uppercase tracking-wider">
            {title}
          </p>
        </div>
      )}
      <ul className={cn("space-y-0.5", isCollapsed ? "px-2" : "px-2")}>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          
          return (
            <li key={item.name}>
              <Link
                href={item.href}
                data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all duration-150 relative group",
                  isCollapsed && "justify-center px-2",
                  isActive
                    ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-primary))] border-l-2 border-[hsl(var(--sidebar-primary))]"
                    : "text-[hsl(var(--sidebar-foreground)/0.7)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"
                )}
                title={isCollapsed ? item.name : undefined}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                {!isCollapsed && <span>{item.name}</span>}
                {isCollapsed && (
                  <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[hsl(var(--foreground))] text-[hsl(var(--background))] text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
                    {item.name}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Sidebar() {
  const [location] = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const coreItems = navigation.filter(item => item.section === "core");
  const fleetItems = navigation.filter(item => item.section === "fleet");
  const driverItems = navigation.filter(item => item.section === "drivers");
  const commItems = navigation.filter(item => item.section === "comm");
  const smartItems = navigation.filter(item => item.section === "smart");
  const systemItems = navigation.filter(item => item.section === "system");

  return (
    <aside className={cn(
      "bg-[hsl(var(--sidebar))] min-h-screen fixed left-0 top-0 z-40 transition-all duration-200 ease-out border-r border-[hsl(var(--sidebar-border))]",
      isCollapsed ? "w-[60px]" : "w-[260px]"
    )}>
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[hsl(var(--sidebar-border))]">
        <div className={cn(
          "flex items-center gap-3 transition-all duration-200",
          isCollapsed && "justify-center w-full"
        )}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src="/traq-logo.png" alt="TRAQ IQ" className="w-full h-full object-contain" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="text-base font-semibold text-[hsl(var(--sidebar-foreground))] tracking-tight">TRAQ IQ</span>
              <span className="text-[10px] text-[hsl(var(--sidebar-foreground)/0.6)] font-medium">Fleet Management</span>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(true)}
            className="h-8 w-8 p-0 hover:bg-muted"
            data-testid="sidebar-collapse"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </Button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {isCollapsed && (
        <div className="flex justify-center py-3 border-b border-[hsl(var(--sidebar-border))]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(false)}
            className="h-8 w-8 p-0 hover:bg-muted"
            data-testid="sidebar-expand"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      )}
      
      {/* Navigation */}
      <nav className="py-4 overflow-y-auto scrollbar-clean" style={{ maxHeight: 'calc(100vh - 64px)' }}>
        <NavSection title="Core Operations" items={coreItems} location={location} isCollapsed={isCollapsed} />
        <NavSection title="Fleet Reliability" items={fleetItems} location={location} isCollapsed={isCollapsed} />
        <NavSection title="Drivers" items={driverItems} location={location} isCollapsed={isCollapsed} />
        <NavSection title="Communication" items={commItems} location={location} isCollapsed={isCollapsed} />
        <NavSection title="AI & Analytics" items={smartItems} location={location} isCollapsed={isCollapsed} />
        <NavSection title="System" items={systemItems} location={location} isCollapsed={isCollapsed} />
      </nav>
    </aside>
  );
}
