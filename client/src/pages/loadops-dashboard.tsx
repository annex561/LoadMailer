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
  User
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

  const sidebarItems = [
    { icon: Home, label: 'Dashboard', path: '/', active: true },
    { icon: Truck, label: 'Loads', path: '/loads' },
    { icon: Users, label: 'Drivers', path: '/driver-management' },
    { icon: FileText, label: 'Dispatcher', path: '/dispatcher-dashboard' },
    { icon: BarChart3, label: 'Analytics', path: '/analytics' },
    { icon: MapPin, label: 'GPS Tracking', path: '/gps-tracking' },
    { icon: Settings, label: 'Settings', path: '/settings' }
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
      <div className={cn(
        "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col",
        sidebarCollapsed ? "w-16" : "w-64"
      )}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-gray-900">LoadOps</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1"
          >
            {sidebarCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            {sidebarItems.map((item, index) => (
              <li key={index}>
                <a
                  href={item.path}
                  className={cn(
                    "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    item.active 
                      ? "bg-blue-100 text-blue-700" 
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <item.icon className={cn("flex-shrink-0", sidebarCollapsed ? "w-5 h-5" : "w-5 h-5 mr-3")} />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
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

            {/* Map Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Driver Locations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-96 bg-blue-100 rounded-lg flex items-center justify-center">
                  <div className="text-center text-gray-600">
                    <MapPin className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-lg font-medium">Live Driver Map</p>
                    <p className="text-sm">Real-time driver locations will be displayed here</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}