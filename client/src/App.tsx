import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Loads from "@/pages/loads";
import DATLoads from "@/pages/dat-loads";
import TelegramDispatching from "@/pages/telegram-dispatching";
import Contacts from "@/pages/contacts";
import Templates from "@/pages/templates";
import DriverManagement from "@/pages/driver-management";
import DriverOnboarding from "@/pages/driver-onboarding";
import DriverDashboard from "@/pages/driver-dashboard";
import PaymentWorkflow from "@/pages/payment-workflow";
import ScraperManagement from "@/pages/scraper-management";
import DispatcherDashboard from "@/pages/dispatcher-dashboard";
import { MoodTracker } from "@/pages/mood-tracker";
import GPSTracking from "@/pages/gps-tracking";
import PredictiveMaintenance from "@/pages/predictive-maintenance";
import AnalyticsDashboard from "@/pages/analytics-dashboard";
import SmartLoadMatching from "@/pages/smart-load-matching";
import SMSStatus from "@/pages/sms-status";
import DebugToken from "@/pages/debug-token";

import Sidebar from "@/components/sidebar";
import Header from "@/components/header";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/loads" component={Loads} />
      <Route path="/dat-loads" component={DATLoads} />
      <Route path="/telegram-dispatching" component={TelegramDispatching} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/templates" component={Templates} />
      <Route path="/driver-management" component={DriverManagement} />
      <Route path="/scrapers" component={ScraperManagement} />
      <Route path="/dispatcher" component={DispatcherDashboard} />
      <Route path="/payments" component={PaymentWorkflow} />
      <Route path="/mood-tracker" component={MoodTracker} />
      <Route path="/gps-tracking" component={GPSTracking} />
      <Route path="/predictive-maintenance" component={PredictiveMaintenance} />
      <Route path="/analytics" component={AnalyticsDashboard} />
      <Route path="/smart-load-matching" component={SmartLoadMatching} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          {/* Standalone driver pages without sidebar/header */}
          <Route path="/driver-onboarding" component={DriverOnboarding} />
          <Route path="/driver-dashboard" component={DriverDashboard} />
          <Route path="/sms-status" component={SMSStatus} />
          <Route path="/debug-token" component={DebugToken} />
          
          {/* Main app with sidebar layout */}
          <Route>
            <div className="flex min-h-screen bg-gray-50">
              <Sidebar />
              <div className="flex-1 ml-64">
                <Header />
                <main>
                  <Router />
                </main>
              </div>
            </div>
          </Route>
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
