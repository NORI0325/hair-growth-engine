import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { LocationProvider } from "@/hooks/useLocations";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequireActiveSubscription from "@/components/RequireActiveSubscription";

const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const ImportCustomers = lazy(() => import("./pages/ImportCustomers"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const Bookings = lazy(() => import("./pages/Bookings"));
const Booking = lazy(() => import("./pages/Booking"));
const MyBookings = lazy(() => import("./pages/MyBookings"));
const PublicBooking = lazy(() => import("./pages/PublicBooking"));
const LineLink = lazy(() => import("./pages/LineLink"));
const Share = lazy(() => import("./pages/Share"));
const Settings = lazy(() => import("./pages/Settings"));
const EmailLogs = lazy(() => import("./pages/EmailLogs"));
const LineBroadcast = lazy(() => import("./pages/LineBroadcast"));
const Templates = lazy(() => import("./pages/Templates"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Performance = lazy(() => import("./pages/Performance"));
const MenuItems = lazy(() => import("./pages/MenuItems"));
const Staff = lazy(() => import("./pages/Staff"));
const Incentives = lazy(() => import("./pages/Incentives"));
const Points = lazy(() => import("./pages/Points"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const Inbox = lazy(() => import("./pages/Inbox"));
const SalonBoardExport = lazy(() => import("./pages/SalonBoardExport"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Billing = lazy(() => import("./pages/Billing"));
const Team = lazy(() => import("./pages/Team"));
const Admin = lazy(() => import("./pages/Admin"));
const InviteAccept = lazy(() => import("./pages/InviteAccept"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Tokushoho = lazy(() => import("./pages/Tokushoho"));
const Locations = lazy(() => import("./pages/Locations"));
const Approvals = lazy(() => import("./pages/Approvals"));
const DeliveryDashboard = lazy(() => import("./pages/DeliveryDashboard"));
const ABTests = lazy(() => import("./pages/ABTests"));
const SegmentTemplates = lazy(() => import("./pages/SegmentTemplates"));
const InboundLogs = lazy(() => import("./pages/InboundLogs"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const CustomerChart = lazy(() => import("./pages/CustomerChart"));
const Commission = lazy(() => import("./pages/Commission"));
const Retention = lazy(() => import("./pages/Retention"));
const Reservations = lazy(() => import("./pages/Reservations"));
const ReservationAction = lazy(() => import("./pages/ReservationAction"));
const ChannelIntegrations = lazy(() => import("./pages/ChannelIntegrations"));
const SyncReview = lazy(() => import("./pages/SyncReview"));
const SalonboardOnboarding = lazy(() => import("./pages/SalonboardOnboarding"));
const SalonboardAutoMapping = lazy(() => import("./pages/SalonboardAutoMapping"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteLoading = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-gold" aria-label="読み込み中" />
  </div>
);

const ProtectedSubscribedLayout = () => (
  <ProtectedRoute>
    <RequireActiveSubscription><Outlet /></RequireActiveSubscription>
  </ProtectedRoute>
);

const ProtectedLayout = () => <ProtectedRoute><Outlet /></ProtectedRoute>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <LocationProvider>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/book/:token" element={<Booking />} />
                <Route path="/my-bookings/:token" element={<MyBookings />} />
                <Route path="/salon/:slug" element={<PublicBooking />} />
                <Route path="/line-link" element={<LineLink />} />
                <Route path="/line-link/*" element={<LineLink />} />
                <Route path="/invite/:token" element={<InviteAccept />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/tokushoho" element={<Tokushoho />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/r/:actionPath/:token" element={<ReservationAction />} />

                <Route element={<ProtectedSubscribedLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/inbox" element={<Inbox />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/customers/:customerId/chart" element={<CustomerChart />} />
                  <Route path="/commission" element={<Commission />} />
                  <Route path="/retention" element={<Retention />} />
                  <Route path="/import" element={<ImportCustomers />} />
                  <Route path="/campaigns" element={<Campaigns />} />
                  <Route path="/bookings" element={<Bookings />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/inbound-logs" element={<InboundLogs />} />
                  <Route path="/approvals" element={<Approvals />} />
                  <Route path="/reservations" element={<Reservations />} />
                  <Route path="/delivery" element={<DeliveryDashboard />} />
                  <Route path="/ab-tests" element={<ABTests />} />
                  <Route path="/segment-templates" element={<SegmentTemplates />} />
                  <Route path="/share" element={<Share />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/email-logs" element={<EmailLogs />} />
                  <Route path="/line-broadcast" element={<LineBroadcast />} />
                  <Route path="/templates" element={<Templates />} />
                  <Route path="/schedule" element={<Schedule />} />
                  <Route path="/performance" element={<Performance />} />
                  <Route path="/menu-items" element={<MenuItems />} />
                  <Route path="/staff" element={<Staff />} />
                  <Route path="/incentives" element={<Incentives />} />
                  <Route path="/points" element={<Points />} />
                  <Route path="/salonboard-export" element={<SalonBoardExport />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/locations" element={<Locations />} />
                  <Route path="/channel-integrations" element={<ChannelIntegrations />} />
                  <Route path="/sync-review" element={<SyncReview />} />
                  <Route path="/onboarding/salonboard" element={<SalonboardOnboarding />} />
                  <Route path="/onboarding/salonboard/:locationId" element={<SalonboardOnboarding />} />
                  <Route path="/onboarding/salonboard/:locationId/auto-mapping" element={<SalonboardAutoMapping />} />
                  <Route path="/onboarding/salonboard-auto-mapping" element={<SalonboardAutoMapping />} />
                </Route>

                <Route element={<ProtectedLayout />}>
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/help" element={<HelpCenter />} />
                  <Route path="/help/:slug" element={<HelpCenter />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </LocationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
