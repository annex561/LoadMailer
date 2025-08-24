import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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

// Import page components
import Dashboard from './dashboard';
import Loads from './loads';
import DatLoads from './dat-loads';
import ManualLoadEntry from './manual-load-entry';
import DriverManagement from './driver-management';
import DriverOnboarding from './driver-onboarding';
import SimpleDriverRegistration from './simple-driver-registration';
import Contacts from './contacts';
import LoadmailerControl from './loadmailer-control';
import TelegramDispatching from './telegram-dispatching';
import SmartLoadMatching from './smart-load-matching';
import AnalyticsDashboard from './analytics-dashboard';
import PredictiveMaintenancePage from './predictive-maintenance';
import GPSTracking from './gps-tracking';
import PaymentWorkflow from './payment-workflow';
import PredictionConfidence from './prediction-confidence';
import Templates from './templates';
import ScraperManagement from './scraper-management';
import SmsStatus from './sms-status';
import DebugToken from './debug-token';
import DriverDashboard from './driver-dashboard';
import DispatcherDashboard from './dispatcher-dashboard';
import DispatcherVehicleDashboard from './dispatcher-vehicle-dashboard';
import DocumentManagement from './DocumentManagement';
import DATScraper from './DATScraper';
import DatLogin from './dat-login';
import AdminOverview from './admin-overview';
import NotFound from './not-found';

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
  const [location] = useLocation();

  // Function to render content based on current route
  const renderContent = () => {
    switch (location) {
      case '/':
      case '/loadops-dashboard':
        return renderDashboardContent();
      case '/dashboard':
        return <Dashboard />;
      case '/loads':
        return <Loads />;
      case '/dat-loads':
        return <DatLoads />;
      case '/manual-load-entry':
        return <ManualLoadEntry />;
      case '/drivers':
        return <DriverManagement />;
      case '/driver-onboarding':
        return <DriverOnboarding />;
      case '/simple-registration':
        return <SimpleDriverRegistration />;
      case '/customers':
        return <Contacts />;
      case '/loadmailer-control':
        return <LoadmailerControl />;
      case '/telegram-dispatching':
        return <TelegramDispatching />;
      case '/smart-load-matching':
        return <SmartLoadMatching />;
      case '/analytics-dashboard':
        return <AnalyticsDashboard />;
      case '/predictive-maintenance':
        return <PredictiveMaintenancePage />;
      case '/gps-tracking':
        return <GPSTracking />;
      case '/payment-workflow':
        return <PaymentWorkflow />;
      case '/prediction-confidence':
        return <PredictionConfidence />;
      case '/templates':
        return <Templates />;
      case '/scraper-management':
        return <ScraperManagement />;
      case '/sms-status':
        return <SmsStatus />;
      case '/debug-token':
        return <DebugToken />;
      case '/driver-dashboard':
        return <DriverDashboard />;
      case '/dispatcher-dashboard':
        return <DispatcherDashboard />;
      case '/dispatcher-vehicle-dashboard':
        return <DispatcherVehicleDashboard />;
      case '/document-management':
        return <DocumentManagement />;
      case '/dat-scraper':
        return <DATScraper />;
      case '/dat-login':
        return <DatLogin />;
      case '/admin-overview':
        return <AdminOverview />;
      default:
        return <NotFound />;
    }
  };

  // Function to render the main LoadOps dashboard content
  const renderDashboardContent = () => {
    return (
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

          {/* Safety Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Safety Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {safetyMetrics.map((metric, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{metric.title}</span>
                    <div className="flex items-center space-x-2">
                      <span className={cn("text-lg font-bold", metric.color)}>
                        {metric.value}
                      </span>
                      <div className={cn("w-3 h-3 rounded-full", 
                        metric.status === 'good' ? 'bg-green-500' :
                        metric.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

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
    refetchInterval: 30000
  });

  // Sample data for finance metrics
  const financeMetrics: FinanceMetric[] = [
    {
      title: "Total Revenue",
      value: "$234,567",
      target: "Target: $250,000",
      percentage: 94,
      color: "text-blue-600",
      icon: DollarSign
    },
    {
      title: "Active Loads",
      value: dashboardStats?.activeLoads?.toString() || "0",
      target: "In Progress",
      percentage: 75,
      color: "text-green-600",
      icon: Truck
    },
    {
      title: "Driver Utilization",
      value: "87%",
      target: "Target: 90%",
      percentage: 87,
      color: "text-purple-600",
      icon: User
    },
    {
      title: "Fuel Efficiency",
      value: "6.8 MPG",
      target: "Target: 7.0 MPG",
      percentage: 97,
      color: "text-orange-600",
      icon: TrendingUp
    }
  ];

  // Sample safety metrics
  const safetyMetrics: SafetyMetric[] = [
    {
      title: "Safety Score",
      value: 98,
      color: "text-green-600",
      status: "good"
    },
    {
      title: "Accidents (30d)",
      value: 0,
      color: "text-green-600",
      status: "good"
    },
    {
      title: "Violations",
      value: 2,
      color: "text-yellow-600",
      status: "warning"
    }
  ];

  // Sample availability metrics
  const availabilityMetrics: AvailabilityMetric[] = [
    {
      title: "Drivers",
      available: drivers.filter((d: any) => d.status === 'available').length,
      unavailable: drivers.filter((d: any) => d.status !== 'available').length,
      total: drivers.length
    },
    {
      title: "Tractors",
      available: 8,
      unavailable: 2,
      total: 10
    }
  ];

  // Navigation items organized by sections
  const navigation = [
    // Core Operations
    { name: 'LoadOps Dashboard', href: '/loadops-dashboard', icon: Home, section: 'core' },
    { name: 'Dashboard', href: '/dashboard', icon: BarChart3, section: 'core' },
    { name: 'Loads', href: '/loads', icon: FileText, section: 'core' },
    { name: 'DAT Loads', href: '/dat-loads', icon: Truck, section: 'core' },
    { name: 'Manual Load Entry', href: '/manual-load-entry', icon: FileText, section: 'core' },
    
    // Driver Management
    { name: 'Driver Management', href: '/drivers', icon: Users, section: 'drivers' },
    { name: 'Driver Onboarding', href: '/driver-onboarding', icon: UserPlus, section: 'drivers' },
    { name: 'Simple Registration', href: '/simple-registration', icon: User, section: 'drivers' },
    { name: 'Driver Dashboard', href: '/driver-dashboard', icon: User, section: 'drivers' },
    { name: 'GPS Tracking', href: '/gps-tracking', icon: MapPin, section: 'drivers' },
    
    // Customer & Communication
    { name: 'Customers', href: '/customers', icon: Users, section: 'comm' },
    { name: 'LoadMailer Control', href: '/loadmailer-control', icon: Mail, section: 'comm' },
    { name: 'Telegram Dispatching', href: '/telegram-dispatching', icon: MessageSquare, section: 'comm' },
    { name: 'SMS Status', href: '/sms-status', icon: MessageSquare, section: 'comm' },
    
    // AI & Smart Features
    { name: 'Smart Load Matching', href: '/smart-load-matching', icon: Brain, section: 'smart' },
    { name: 'Analytics Dashboard', href: '/analytics-dashboard', icon: BarChart3, section: 'smart' },
    { name: 'Predictive Maintenance', href: '/predictive-maintenance', icon: Wrench, section: 'smart' },
    { name: 'Prediction Confidence', href: '/prediction-confidence', icon: Brain, section: 'smart' },
    
    // System & Reports
    { name: 'Admin Overview', href: '/admin-overview', icon: Settings, section: 'system' },
    { name: 'Payment Workflow', href: '/payment-workflow', icon: DollarSign, section: 'system' },
    { name: 'Templates', href: '/templates', icon: FileText, section: 'system' },
    { name: 'Scraper Management', href: '/scraper-management', icon: Bot, section: 'system' },
    { name: 'Debug Token', href: '/debug-token', icon: Wrench, section: 'system' },
    { name: 'Dispatcher Dashboard', href: '/dispatcher-dashboard', icon: Headphones, section: 'system' },
    { name: 'Dispatcher Vehicle Dashboard', href: '/dispatcher-vehicle-dashboard', icon: Truck, section: 'system' },
    { name: 'Document Management', href: '/document-management', icon: FileText, section: 'system' },
    { name: 'DAT Scraper', href: '/dat-scraper', icon: Bot, section: 'system' },
    { name: 'DAT Login', href: '/dat-login', icon: Webhook, section: 'system' },
    { name: 'Settings', href: '/settings', icon: Settings, section: 'system' }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-64"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          {!sidebarCollapsed && (
            <h2 className="text-xl font-semibold text-gray-900">LoadMaster</h2>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {/* Core Operations Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Core Operations</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "core").map((item) => {
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

          {/* Driver Management Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Driver Management</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "drivers").map((item) => {
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

          {/* Customer & Communication Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Communication</p>
            </div>
          )}
          <ul className={cn("mt-2 space-y-1", sidebarCollapsed && "px-2")}>
            {navigation.filter(item => item.section === "comm").map((item) => {
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

          {/* AI & Smart Features Section */}
          {!sidebarCollapsed && (
            <div className="px-6 py-2 mt-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI & Smart Features</p>
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

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-6">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}