import { Bell, Menu, User } from "lucide-react";
import { useLocation } from "wouter";

const pageData = {
  "/": {
    title: "Dashboard",
    subtitle: "Overview of your truck loads and operations"
  },
  "/loads": {
    title: "Manage Loads",
    subtitle: "Create, edit, and track your loads"
  },
  "/contacts": {
    title: "Contacts",
    subtitle: "Manage drivers and customers"
  },
  "/templates": {
    title: "Email Templates",
    subtitle: "Configure automated email notifications"
  }
};

export default function Header() {
  const [location] = useLocation();
  const currentPage = pageData[location as keyof typeof pageData] || pageData["/"];

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button className="lg:hidden text-gray-500 hover:text-gray-700" data-testid="mobile-menu-button">
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{currentPage.title}</h2>
            <p className="text-sm text-gray-500">{currentPage.subtitle}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="relative">
            <button 
              className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              data-testid="notifications-button"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-xs rounded-full flex items-center justify-center">
                3
              </span>
            </button>
          </div>
          
          <div className="flex items-center space-x-3 pl-4 border-l border-gray-200">
            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-gray-600" />
            </div>
            <div className="text-sm">
              <p className="font-medium text-gray-900">John Smith</p>
              <p className="text-gray-500">Fleet Manager</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
