import { Link, useLocation } from "wouter";
import { Truck, LayoutDashboard, Package, Users, Mail, BarChart3, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, section: "main" },
  { name: "Manage Loads", href: "/loads", icon: Package, section: "main" },
  { name: "Contacts", href: "/contacts", icon: Users, section: "main" },
  { name: "Email Templates", href: "/templates", icon: Mail, section: "main" },
  { name: "Analytics", href: "/analytics", icon: BarChart3, section: "reports" },
  { name: "Email Logs", href: "/email-logs", icon: FileText, section: "reports" },
];

export default function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-white shadow-lg min-h-screen fixed left-0 top-0 z-40">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <Truck className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">LoadMaster</h1>
            <p className="text-xs text-gray-500">Fleet Management</p>
          </div>
        </div>
      </div>
      
      <nav className="mt-6">
        <div className="px-6 py-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Main</p>
        </div>
        <ul className="mt-2 space-y-1">
          {navigation.filter(item => item.section === "main").map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    "flex items-center px-6 py-3 text-sm font-medium transition-colors",
                    isActive
                      ? "text-primary bg-blue-50 border-r-3 border-primary"
                      : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                  )}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
        
        <div className="px-6 py-2 mt-8">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reports</p>
        </div>
        <ul className="mt-2 space-y-1">
          {navigation.filter(item => item.section === "reports").map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className={cn(
                    "flex items-center px-6 py-3 text-sm font-medium transition-colors",
                    isActive
                      ? "text-primary bg-blue-50 border-r-3 border-primary"
                      : "text-gray-700 hover:bg-gray-50 hover:text-primary"
                  )}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
