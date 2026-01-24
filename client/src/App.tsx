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
import SMSDispatching from "@/pages/sms-dispatching";
import Contacts from "@/pages/contacts";
import Templates from "@/pages/templates";
import DriverManagement from "@/pages/driver-management";
import DriverOnboarding from "@/pages/driver-onboarding";
import SimpleDriverRegistration from "@/pages/simple-driver-registration";
import DriverDashboard from "@/pages/driver-dashboard";
import MobileDriverDashboard from "@/pages/mobile-driver-dashboard";
import DriverProfile from "@/pages/driver-profile";
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
import AdminOverview from "@/pages/admin-overview";
import SMSStatus from "@/pages/sms-status";
import DebugToken from "@/pages/debug-token";
import GoogleSheetsImport from "@/pages/google-sheets-import";
import TwilioSettings from "@/pages/twilio-settings";
import UnifiedMessaging from "@/pages/unified-messaging";
import DriverTracker from "@/pages/driver-tracker";
import DocumentManagement from "@/pages/document-management";
import ManualDispatch from "@/pages/manual-dispatch";
import FleetDashboard from "@/pages/fleet-dashboard";
import FleetTrucks from "@/pages/fleet-trucks";
import FleetWorkOrders from "@/pages/fleet-work-orders";
import FleetInspections from "@/pages/fleet-inspections";
import FleetVendors from "@/pages/fleet-vendors";
import LoadsInbox from "@/pages/loads-inbox";
import ItemsPage from "@/pages/items";
import LoadDetailsPage from "@/pages/load-details";

import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import { DATVerificationDialog } from "@/components/DATVerificationDialog";
import { ErrorBoundary } from "@/components/error-boundary";



function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/loads" component={Loads} />
      <Route path="/dat-loads" component={DATLoads} />
      <Route path="/manual-load-entry" component={ManualLoadEntry} />
      <Route path="/manual-dispatch" component={ManualDispatch} />
      <Route path="/dat-login" component={DATLogin} />
      <Route path="/telegram-dispatching" component={TelegramDispatching} />
      <Route path="/sms-dispatching" component={SMSDispatching} />
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
      <Route path="/admin-overview" component={AdminOverview} />
      <Route path="/taskmagic-status" component={TaskMagicStatusPage} />
      <Route path="/dat-scraper" component={DATScraper} />
      <Route path="/google-sheets-import" component={GoogleSheetsImport} />
      <Route path="/fleet" component={FleetDashboard} />
      <Route path="/fleet/dashboard" component={FleetDashboard} />
      <Route path="/fleet/trucks" component={FleetTrucks} />
      <Route path="/fleet/work-orders" component={FleetWorkOrders} />
      <Route path="/fleet/inspections" component={FleetInspections} />
      <Route path="/fleet/vendors" component={FleetVendors} />
      <Route path="/loads-inbox" component={LoadsInbox} />
      <Route path="/ga/loads" component={LoadsInbox} />
      <Route path="/items" component={ItemsPage} />
      <Route path="/loads/:id" component={LoadDetailsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          {/* Standalone driver pages without sidebar/header - for driver self-service only */}
          <Route path="/driver-onboarding" component={DriverOnboarding} />
          <Route path="/simple-registration" component={SimpleDriverRegistration} />
          <Route path="/simple-driver-registration" component={SimpleDriverRegistration} />
          <Route path="/driver-dashboard">
            <ErrorBoundary>
              <MobileDriverDashboard />
            </ErrorBoundary>
          </Route>
          <Route path="/mobile-driver-dashboard">
            <ErrorBoundary>
              <MobileDriverDashboard />
            </ErrorBoundary>
          </Route>
          
          {/* All other routes (admin pages) use LoadOps dashboard layout with sidebar */}
          <Route>
            <LoadOpsDashboard />
          </Route>
        </Switch>
        <DATVerificationDialog />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
