import { Bell, Menu, User, Sun, Moon, Search } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const pageData: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Dashboard", subtitle: "Overview of your fleet operations" },
  "/dispatcher": { title: "Dispatcher Dashboard", subtitle: "Real-time fleet management" },
  "/dispatcher-dashboard": { title: "Dispatcher Dashboard", subtitle: "Real-time fleet management" },
  "/loadops-dashboard": { title: "Finance Dashboard", subtitle: "Revenue and financial metrics" },
  "/fleet-calculator": { title: "Fleet Calculator", subtitle: "Calculate fleet profitability" },
  "/loads": { title: "Manage Loads", subtitle: "Create and track shipments" },
  "/contacts": { title: "Customers", subtitle: "Manage customer relationships" },
  "/templates": { title: "Templates", subtitle: "Email notification templates" },
  "/driver-management": { title: "Driver Management", subtitle: "Manage your fleet drivers" },
  "/driver-onboarding": { title: "Driver Onboarding", subtitle: "Onboard new drivers" },
  "/gps-tracking": { title: "GPS Tracking", subtitle: "Real-time vehicle locations" },
  "/analytics": { title: "Analytics", subtitle: "Performance insights and reports" },
  "/smart-load-matching": { title: "Smart Load Matching", subtitle: "AI-powered load optimization" },
  "/payments": { title: "Payments", subtitle: "Payment processing and history" },
  "/admin-overview": { title: "Admin Overview", subtitle: "System administration" },
};

export default function Header() {
  const [location] = useLocation();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const currentPage = pageData[location] || { title: "TRAQ IQ", subtitle: "Fleet Management" };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  return (
    <header className="h-16 bg-card border-b border-border px-6 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <button className="lg:hidden text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-muted transition-colors" data-testid="mobile-menu-button">
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{currentPage.title}</h1>
          <p className="text-xs text-muted-foreground">{currentPage.subtitle}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="hidden md:flex relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search..." 
            className="w-64 pl-9 h-9 bg-muted/50 border-0 focus-visible:ring-1"
            data-testid="header-search"
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          className="h-9 w-9 p-0"
          data-testid="theme-toggle"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 relative" data-testid="notifications-button">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>
        
        <div className="flex items-center gap-3 pl-3 border-l border-border">
          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div className="hidden sm:block text-sm">
            <p className="font-medium text-foreground leading-tight">John Smith</p>
            <p className="text-xs text-muted-foreground">Fleet Manager</p>
          </div>
        </div>
      </div>
    </header>
  );
}
