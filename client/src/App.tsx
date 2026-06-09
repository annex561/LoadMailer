import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-user";

// Eager: critical for first paint (landing, auth, shell)
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import AuthPage from "@/pages/auth-page";
import LoadOpsDashboard from "@/pages/loadops-dashboard";

// Lazy: everything else. These pages are large and most users only hit
// a handful per session, so we avoid shipping them in the initial bundle.
const Loads = lazy(() => import("@/pages/loads"));
const DATLoads = lazy(() => import("@/pages/dat-loads"));
const ManualLoadEntry = lazy(() => import("@/pages/manual-load-entry"));
const DATLogin = lazy(() => import("@/pages/dat-login"));
const TelegramDispatching = lazy(() => import("@/pages/telegram-dispatching"));
const SMSDispatching = lazy(() => import("@/pages/sms-dispatching"));
const Contacts = lazy(() => import("@/pages/contacts"));
const Templates = lazy(() => import("@/pages/templates"));
const DriverManagement = lazy(() => import("@/pages/driver-management"));
const DriverOnboarding = lazy(() => import("@/pages/driver-onboarding"));
const SimpleDriverRegistration = lazy(() => import("@/pages/simple-driver-registration"));
const MobileDriverDashboard = lazy(() => import("@/pages/mobile-driver-dashboard"));
const PaymentWorkflow = lazy(() => import("@/pages/payment-workflow"));
const ScraperManagement = lazy(() => import("@/pages/scraper-management"));
const DispatcherDashboard = lazy(() => import("@/pages/dispatcher-dashboard"));
const DispatcherVehicleDashboard = lazy(() => import("@/pages/dispatcher-vehicle-dashboard"));
const LoadMailerControl = lazy(() => import("@/pages/loadmailer-control"));
const MoodTracker = lazy(() => import("@/pages/mood-tracker").then(m => ({ default: m.MoodTracker })));
const GPSTracking = lazy(() => import("@/pages/gps-tracking"));
const PredictiveMaintenance = lazy(() => import("@/pages/predictive-maintenance"));
const TaskMagicStatusPage = lazy(() => import("@/pages/taskmagic-status").then(m => ({ default: m.TaskMagicStatusPage })));
const DATScraper = lazy(() => import("@/pages/DATScraper"));
const AnalyticsDashboard = lazy(() => import("@/pages/analytics-dashboard"));
const SmartLoadMatching = lazy(() => import("@/pages/smart-load-matching"));
const PredictionConfidence = lazy(() => import("@/pages/prediction-confidence"));
const AdminOverview = lazy(() => import("@/pages/admin-overview"));
const OpsMonitor = lazy(() => import("@/pages/ops-monitor"));
const Settlements = lazy(() => import("@/pages/settlements"));
const GoogleSheetsImport = lazy(() => import("@/pages/google-sheets-import"));
const DriverTracker = lazy(() => import("@/pages/driver-tracker"));
const ManualDispatch = lazy(() => import("@/pages/manual-dispatch"));
const FleetDashboard = lazy(() => import("@/pages/fleet-dashboard"));
const FleetTrucks = lazy(() => import("@/pages/fleet-trucks"));
const FleetWorkOrders = lazy(() => import("@/pages/fleet-work-orders"));
const FleetInspections = lazy(() => import("@/pages/fleet-inspections"));
const FleetVendors = lazy(() => import("@/pages/fleet-vendors"));
const LoadsInbox = lazy(() => import("@/pages/loads-inbox"));
const ActiveLoads = lazy(() => import("@/pages/active-loads"));
const ItemsPage = lazy(() => import("@/pages/items"));
const LoadDetailsPage = lazy(() => import("@/pages/load-details"));
const GmailSettings = lazy(() => import("@/pages/gmail-settings"));
const DriverLoadView = lazy(() => import("@/pages/driver-load-view"));
const TrueRPMCalculator = lazy(() => import("@/pages/true-rpm-calculator"));
const RateconUploadPage = lazy(() => import("@/pages/ratecon-upload"));
const ReviewQueuePage = lazy(() => import("@/pages/review-queue"));
const CallsPage = lazy(() => import("@/pages/calls"));
const FactoringPage = lazy(() => import("@/pages/factoring"));
const DriverConfirmPage = lazy(() => import("@/pages/driver-confirm"));
// Public legal pages — required for A2P 10DLC TCR campaign approval.
const PrivacyPolicy = lazy(() => import("@/pages/privacy"));
const TermsOfService = lazy(() => import("@/pages/terms"));
// Driver Recruiting Funnel — public pages (landing/apply/status) + internal /recruiting dashboard.
// Each lazy import is its own const declaration so Vite tree-shaking keeps the binding intact.
const RecruitingLanding = lazy(() => import("@/pages/recruiting/landing"));
const RecruitingApplication = lazy(() => import("@/pages/recruiting/application"));
const RecruitingStatus = lazy(() => import("@/pages/recruiting/status"));
const RecruitingDocuments = lazy(() => import("@/pages/recruiting/documents"));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RecruitingDashboard = lazy(() => import("@/pages/recruiting/dashboard"));

import { DATVerificationDialog } from "@/components/DATVerificationDialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { NewLoadWatcher } from "@/components/watchers/new-load-watcher";

function RouteFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      color: '#6b7280',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
    }}>
      Loading…
    </div>
  );
}

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
      <Route path="/recruiting" component={RecruitingDashboard} />
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
      <Route path="/ops" component={OpsMonitor} />
      <Route path="/ops-monitor" component={OpsMonitor} />
      <Route path="/settlements" component={Settlements} />
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
      <Route path="/active-loads" component={ActiveLoads} />
      <Route path="/items" component={ItemsPage} />
      <Route path="/gmail-settings" component={GmailSettings} />
      <Route path="/true-rpm-calculator" component={TrueRPMCalculator} />
      <Route path="/ratecon-upload" component={RateconUploadPage} />
      <Route path="/review-queue" component={ReviewQueuePage} />
      <Route path="/calls" component={CallsPage} />
      <Route path="/factoring" component={FactoringPage} />
      <Route path="/loads/:id" component={LoadDetailsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <NewLoadWatcher />
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              {/* Auth page - no sidebar/header */}
              <Route path="/auth" component={AuthPage} />

              {/* Public legal pages — must be reachable without login (TCR requirement) */}
              <Route path="/privacy" component={PrivacyPolicy} />
              <Route path="/terms" component={TermsOfService} />

              {/* Driver Recruiting Funnel — public pages, no auth, no sidebar */}
              <Route path="/drive-with-lamp" component={RecruitingLanding} />
              <Route path="/apply/:id" component={RecruitingApplication} />
              <Route path="/apply/:id/status" component={RecruitingStatus} />
              <Route path="/apply/:id/documents" component={RecruitingDocuments} />

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
              <Route path="/driver/load/:id" component={DriverLoadView} />
              <Route path="/driver/tracking/:id" component={DriverTracker} />
              <Route path="/driver-tracker" component={DriverTracker} />

              {/* Driver confirmation — tokenized link from SMS, no login required */}
              <Route path="/l/:token" component={DriverConfirmPage} />

              {/* All other routes (admin pages) use LoadOps dashboard layout with sidebar */}
              <Route>
                <LoadOpsDashboard />
              </Route>
            </Switch>
          </Suspense>
          <DATVerificationDialog />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
