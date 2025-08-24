import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Menu, 
  X, 
  Home, 
  Truck, 
  FileText, 
  Users, 
  BarChart3, 
  Settings, 
  MapPin,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Headphones,
  Bot,
  MessageSquare,
  UserPlus,
  Brain,
  Wrench,
  Smile,
  Mail,
  Webhook,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FinanceMetric {
  title: string;
  value: string;
  target: string;
  percentage: number;
  color: string;
  icon: any;
}

interface SafetyMetric {
  title: string;
  value: number;
  color: string;
  status: 'warning' | 'good' | 'critical';
}

interface AvailabilityMetric {
  title: string;
  available: number;
  unavailable: number;
  total: number;
}

export default function LoadOpsDashboard() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch dashboard data
  const { data: dashboardStats } = useQuery({
    queryKey: ['/api/dashboard-stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard-stats');
      return response.json();
    }
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['/api/drivers'],
    queryFn: async () => {
      const response = await fetch('/api/drivers');
      return response.json();
    }
  });

  const { data: loads = [] } = useQuery({
    queryKey: ['/api/loads'],
    queryFn: async () => {
      const response = await fetch('/api/loads');
      return response.json();
    }
  });

  const { data: driverLocations } = useQuery({
    queryKey: ['/api/driver-locations/active'],
    queryFn: async () => {
      const response = await fetch('/api/driver-locations/active');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate metrics
  const financeMetrics: FinanceMetric[] = [
    {
      title: "Revenue This Week",
      value: "$0",
      target: "Target $10,000",
      percentage: 0,
      color: "text-blue-600",
      icon: DollarSign
    },
    {
      title: "Revenue Total Value",
      value: "$0",
      target: "Target $0.5",
      percentage: 0,
      color: "text-green-600",
      icon: TrendingUp
    },
    {
      title: "Revenue 7 loaded Value",
      value: "$0",
      target: "Target $5",
      percentage: 0,
      color: "text-purple-600",
      icon: BarChart3
    },
    {
      title: "Revenue/Gross",
      value: "$0",
      target: "Target $10,000",
      percentage: 0,
      color: "text-orange-600",
      icon: DollarSign
    }
  ];

  const availabilityMetrics: AvailabilityMetric[] = [
    {
      title: "Driver Availability",
      available: drivers.filter((d: any) => d.status === 'available').length,
      unavailable: drivers.filter((d: any) => d.status !== 'available').length,
      total: drivers.length
    },
    {
      title: "Tractor Availability", 
      available: 0,
      unavailable: 0,
      total: 0
    }
  ];

  const safetyMetrics: SafetyMetric[] = [
    {
      title: "Driver Safety Standing",
      value: 0,
      color: "text-green-600",
      status: 'good'
    },
    {
      title: "Tractor Safety Standing",
      value: 0,
      color: "text-blue-600", 
      status: 'good'
    },
    {
      title: "Trailer Safety Standing",
      value: 0,
      color: "text-red-600",
      status: 'critical'
    }
  ];

  const navigation = [
    // Dashboards & Operations
    { name: "LoadOps Dashboard", href: "/loadops-dashboard", icon: TrendingUp, section: "dashboards" },
    { name: "Dispatcher Dashboard", href: "/dispatcher", icon: Settings, section: "dashboards" },
    
    // Load Management
    { name: "Manage Loads", href: "/loads", icon: Truck, section: "loads" },
    { name: "DAT Loads", href: "/dat-loads", icon: Truck, section: "loads" },
    { name: "Manual Load Entry", href: "/manual-load-entry", icon: UserPlus, section: "loads" },
    { name: "DAT Login", href: "/dat-login", icon: Settings, section: "loads" },
    { name: "DAT Scrapers", href: "/scrapers", icon: Settings, section: "loads" },
    
    // Communication & Dispatch
    { name: "Telegram Dispatching", href: "/telegram-dispatching", icon: MessageSquare, section: "communication" },
    { name: "LoadMailer Bot", href: "/loadmailer-control", icon: Settings, section: "communication" },
    { name: "Email Templates", href: "/templates", icon: Mail, section: "communication" },
    
    // Fleet Management
    { name: "Driver Management", href: "/driver-management", icon: Users, section: "fleet" },
    { name: "Vehicle Management", href: "/dispatcher-vehicle-dashboard", icon: Truck, section: "fleet" },
    { name: "Contacts", href: "/contacts", icon: Users, section: "fleet" },
    { name: "GPS Tracking", href: "/gps-tracking", icon: MapPin, section: "fleet" },
    
    // Smart Operations
    { name: "Smart Load Matching", href: "/smart-load-matching", icon: TrendingUp, section: "smart" },
    { name: "Prediction Confidence", href: "/prediction-confidence", icon: TrendingUp, section: "smart" },
    { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Wrench, section: "smart" },
    { name: "Mood Tracker", href: "/mood-tracker", icon: Smile, section: "smart" },
    { name: "Payment Workflow", href: "/payments", icon: DollarSign, section: "smart" },
    
    // System & Reports
    { name: "TaskMagic Status", href: "/taskmagic-status", icon: Settings, section: "system" },
    { name: "Analytics", href: "/analytics", icon: BarChart3, section: "system" },
    { name: "Email Logs", href: "/email-logs", icon: FileText, section: "system" },
  ];

  const invoiceStats = {
    delayed: { count: 0, amount: '$0' },
    pending: { count: 0, amount: '$0' },
    approved: { count: 0, amount: '$0' },
    loadsPending: { count: 0, amount: '$0' }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={cn(
        "bg-white shadow-lg min-h-screen fixed left-0 top-0 z-40 transition-all duration-300 ease-in-out flex flex-col",
        sidebarCollapsed ? "w-16" : "w-64"
      )}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className={cn(
              "flex items-center space-x-3 transition-all duration-300",
              sidebarCollapsed && "justify-center"
            )}>
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <Truck className="text-white w-5 h-5" />
              </div>
              {!sidebarCollapsed && (
                <div>
                  <h1 className="text-xl font-bold text-gray-900">LoadMaster</h1>
                  <p className="text-xs text-gray-500">Fleet Management</p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={cn(
                "hover:bg-gray-100",
                sidebarCollapsed && "absolute top-6 right-2"
              )}
            >
              {sidebarCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-6 flex-1">
          {/* Dashboards Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Dashboards</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "dashboards").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Load Management Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Load Management</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "loads").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Communication Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Communication</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "communication").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Fleet Management Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Fleet Management</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "fleet").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Smart Operations Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Smart Operations</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "smart").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* System & Reports Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">System & Reports</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "system").map((item) => {
              const Icon = item.icon;
              const isActive = window.location.pathname === item.href;
              
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      "flex items-center py-3 text-sm font-medium transition-colors relative group",
                      sidebarCollapsed 
                        ? "px-2 justify-center" 
                        : "px-6",
                      isActive
                        ? "text-primary bg-blue-50 border-r-3 border-primary"
                        : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                    )}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <Icon className={cn(
                      "w-5 h-5", 
                      !sidebarCollapsed && "mr-3"
                    )} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col overflow-hidden", sidebarCollapsed ? "ml-16" : "ml-64")}>
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Finance Performance for Company</h1>
              <p className="text-sm text-gray-500">Aug 19, 2025 - Aug 19, 2025</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" size="sm" data-testid="button-quick-reminder">
                Quick Reminder
              </Button>
              <Button variant="outline" size="sm" data-testid="button-last-revenue">
                Last Revenue
              </Button>
              <Button size="sm" data-testid="button-actual">
                Actual
              </Button>
              <Button variant="outline" size="sm" data-testid="button-projected">
                Projected
              </Button>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Finance Performance Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {financeMetrics.map((metric, index) => (
                <Card key={index} className="relative overflow-hidden">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">{metric.title}</p>
                        <div className="mt-2">
                          <p className={cn("text-2xl font-bold", metric.color)}>{metric.value}</p>
                          <p className="text-xs text-gray-500">{metric.target}</p>
                        </div>
                      </div>
                      <div className={cn("p-3 rounded-full bg-gray-100")}>
                        <metric.icon className={cn("w-6 h-6", metric.color)} />
                      </div>
                    </div>
                    <div className="mt-4 bg-gray-200 rounded-full h-2">
                      <div 
                        className={cn("h-2 rounded-full", 
                          metric.color.includes('blue') ? 'bg-blue-600' :
                          metric.color.includes('green') ? 'bg-green-600' :
                          metric.color.includes('purple') ? 'bg-purple-600' : 'bg-orange-600'
                        )}
                        style={{ width: `${metric.percentage}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Second Row - Operational Summary, Availability, and Invoices */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Trip Operational Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Trip Operational Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="text-center">
                      <p className="text-sm text-gray-600 mb-4">Open Trips</p>
                      <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl font-bold text-blue-600">{loads.length}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-2">Items Available</p>
                    </div>
                    
                    <div className="text-center">
                      <p className="text-sm text-gray-600 mb-4">Assigned Trips</p>
                      <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                        <span className="text-2xl font-bold text-red-600">
                          {loads.filter((l: any) => l.driverId).length}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-2">Assigned Trips</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Driver & Tractor Availability */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Driver Availability</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {availabilityMetrics.map((metric, index) => (
                      <div key={index}>
                        <p className="text-sm text-gray-600 mb-3">{metric.title}</p>
                        <div className="flex justify-center space-x-8">
                          <div className="text-center">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-2">
                              <span className="text-lg font-bold text-red-600">{metric.unavailable}</span>
                            </div>
                            <p className="text-xs text-gray-500">Not Available</p>
                          </div>
                          <div className="text-center">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2">
                              <span className="text-lg font-bold text-green-600">{metric.available}</span>
                            </div>
                            <p className="text-xs text-gray-500">Available</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Load Invoices */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Load Invoices</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600 mb-3">Invoices</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{invoiceStats.delayed.count}</div>
                          <p className="text-xs text-gray-500">Delayed</p>
                          <p className="text-xs text-gray-500">Payments</p>
                          <p className="text-xs font-medium">{invoiceStats.delayed.amount}</p>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{invoiceStats.pending.count}</div>
                          <p className="text-xs text-gray-500">Pending</p>
                          <p className="text-xs text-gray-500">Payments</p>
                          <p className="text-xs font-medium">{invoiceStats.pending.amount}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <p className="text-sm font-medium text-gray-600 mb-3">Loads</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{invoiceStats.approved.count}</div>
                          <p className="text-xs text-gray-500">Approved</p>
                          <p className="text-xs text-gray-500">Loads</p>
                          <p className="text-xs font-medium">{invoiceStats.approved.amount}</p>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{invoiceStats.loadsPending.count}</div>
                          <p className="text-xs text-gray-500">Pending</p>
                          <p className="text-xs text-gray-500">Loads</p>
                          <p className="text-xs font-medium">{invoiceStats.loadsPending.amount}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Safety Standing Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {safetyMetrics.map((metric, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="text-lg font-semibold">{metric.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-center space-x-8">
                      <div className="text-center">
                        <div className={cn(
                          "text-4xl font-bold mb-2",
                          metric.status === 'good' ? 'text-green-600' :
                          metric.status === 'warning' ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {metric.value}
                        </div>
                        <p className="text-sm text-gray-500">Warning</p>
                      </div>
                      <div className="text-center">
                        <div className={cn(
                          "text-4xl font-bold mb-2",
                          metric.status === 'good' ? 'text-green-600' :
                          metric.status === 'warning' ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {metric.value}
                        </div>
                        <p className="text-sm text-gray-500">Violations</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Real-Time Driver Location Tracking */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg font-semibold">Real-Time Driver Tracking</CardTitle>
                <div className="flex items-center space-x-2">
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    driverLocations?.serviceRunning ? "bg-green-500" : "bg-red-500"
                  )} />
                  <span className="text-sm text-gray-500">
                    {driverLocations?.serviceRunning ? "Live Tracking" : "Service Offline"}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Service Status */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {driverLocations?.trackedDrivers || 0}
                      </div>
                      <p className="text-sm text-gray-500">Tracked Drivers</p>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {driverLocations?.count || 0}
                      </div>
                      <p className="text-sm text-gray-500">Active Locations</p>
                    </div>
                    <div className="text-center">
                      <div className={cn(
                        "text-2xl font-bold",
                        driverLocations?.serviceRunning ? "text-green-600" : "text-red-600"
                      )}>
                        {driverLocations?.serviceRunning ? "ON" : "OFF"}
                      </div>
                      <p className="text-sm text-gray-500">Service Status</p>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">GPS</div>
                      <p className="text-sm text-gray-500">Real-Time Updates</p>
                    </div>
                  </div>

                  {/* Driver Location List */}
                  {driverLocations?.locations && driverLocations.locations.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-800">Active Driver Locations</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {driverLocations.locations.slice(0, 6).map((location: any, index: number) => (
                          <div key={index} className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-gray-800">
                                {drivers.find((d: any) => d.id === location.driverId)?.name || "Driver"}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {location.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <div className="flex items-center">
                                <MapPin className="w-4 h-4 mr-2" />
                                <span>
                                  {location.latitude?.toFixed(4)}, {location.longitude?.toFixed(4)}
                                </span>
                              </div>
                              <div className="flex items-center">
                                <Clock className="w-4 h-4 mr-2" />
                                <span>
                                  {location.timestamp ? new Date(location.timestamp).toLocaleTimeString() : "Unknown"}
                                </span>
                              </div>
                              {location.speed !== null && (
                                <div className="flex items-center">
                                  <TrendingUp className="w-4 h-4 mr-2" />
                                  <span>{location.speed} mph</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                      <div className="text-center text-gray-600">
                        <MapPin className="w-12 h-12 mx-auto mb-4" />
                        <p className="text-lg font-medium">No Active Tracking</p>
                        <p className="text-sm">
                          {driverLocations?.serviceRunning 
                            ? "Waiting for driver location updates..." 
                            : "GPS tracking service is offline"
                          }
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}