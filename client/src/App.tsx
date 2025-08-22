import { Switch, Route } from "wouter";
import { useState, createContext, useContext } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Loads from "@/pages/loads";
import DATLoads from "@/pages/dat-loads";
import ManualLoadEntry from "@/pages/manual-load-entry";
import DATLogin from "@/pages/dat-login";
import TelegramDispatching from "@/pages/telegram-dispatching";
import Contacts from "@/pages/contacts";
import Templates from "@/pages/templates";
import DriverManagement from "@/pages/driver-management";
import DriverOnboarding from "@/pages/driver-onboarding";
import SimpleDriverRegistration from "@/pages/simple-driver-registration";
import DriverDashboard from "@/pages/driver-dashboard";
import PaymentWorkflow from "@/pages/payment-workflow";
import ScraperManagement from "@/pages/scraper-management";
import DispatcherDashboard from "@/pages/dispatcher-dashboard";
import LoadOpsDashboard from "@/pages/loadops-dashboard";
import DispatcherVehicleDashboard from "@/pages/dispatcher-vehicle-dashboard";
import LoadMailerControl from "@/pages/loadmailer-control";
import { MoodTracker } from "@/pages/mood-tracker";
import GPSTracking from "@/pages/gps-tracking";
import PredictiveMaintenance from "@/pages/predictive-maintenance";
import { TaskMagicStatusPage } from "@/pages/taskmagic-status";
import DATScraper from "@/pages/DATScraper";
import AnalyticsDashboard from "@/pages/analytics-dashboard";
import SmartLoadMatching from "@/pages/smart-load-matching";
import PredictionConfidence from "@/pages/prediction-confidence";
import SMSStatus from "@/pages/sms-status";
import DebugToken from "@/pages/debug-token";

import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import { DATVerificationDialog } from "@/components/DATVerificationDialog";



function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/loads" component={Loads} />
      <Route path="/dat-loads" component={DATLoads} />
      <Route path="/manual-load-entry" component={ManualLoadEntry} />
      <Route path="/dat-login" component={DATLogin} />
      <Route path="/telegram-dispatching" component={TelegramDispatching} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/templates" component={Templates} />
      <Route path="/driver-management" component={DriverManagement} />
      <Route path="/scrapers" component={ScraperManagement} />
      <Route path="/dispatcher" component={DispatcherDashboard} />
      <Route path="/dispatcher-dashboard" component={DispatcherDashboard} />
      <Route path="/loadops-dashboard" component={LoadOpsDashboard} />
      <Route path="/dispatcher-vehicle-dashboard" component={DispatcherVehicleDashboard} />
      <Route path="/loadmailer-control" component={LoadMailerControl} />
      <Route path="/payments" component={PaymentWorkflow} />
      <Route path="/mood-tracker" component={MoodTracker} />
      <Route path="/gps-tracking" component={GPSTracking} />
      <Route path="/predictive-maintenance" component={PredictiveMaintenance} />
      <Route path="/analytics" component={AnalyticsDashboard} />
      <Route path="/smart-load-matching" component={SmartLoadMatching} />
      <Route path="/prediction-confidence" component={PredictionConfidence} />
      <Route path="/taskmagic-status" component={TaskMagicStatusPage} />
      <Route path="/dat-scraper" component={DATScraper} />
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
          <Route path="/simple-registration" component={SimpleDriverRegistration} />
          <Route path="/simple-driver-registration" component={SimpleDriverRegistration} />
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
        <DATVerificationDialog />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
