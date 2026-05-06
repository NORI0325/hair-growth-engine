import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import ImportCustomers from "./pages/ImportCustomers";
import Campaigns from "./pages/Campaigns";
import Bookings from "./pages/Bookings";
import Booking from "./pages/Booking";
import MyBookings from "./pages/MyBookings";
import PublicBooking from "./pages/PublicBooking";
import Share from "./pages/Share";
import Settings from "./pages/Settings";
import EmailLogs from "./pages/EmailLogs";
import LineBroadcast from "./pages/LineBroadcast";
import Templates from "./pages/Templates";
import Schedule from "./pages/Schedule";
import Performance from "./pages/Performance";
import MenuItems from "./pages/MenuItems";
import Staff from "./pages/Staff";
import Incentives from "./pages/Incentives";
import Points from "./pages/Points";
import Unsubscribe from "./pages/Unsubscribe";
import Inbox from "./pages/Inbox";
import SalonBoardExport from "./pages/SalonBoardExport";
import Onboarding from "./pages/Onboarding";
import Billing from "./pages/Billing";
import Team from "./pages/Team";
import Admin from "./pages/Admin";
import InviteAccept from "./pages/InviteAccept";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Tokushoho from "./pages/Tokushoho";
import Locations from "./pages/Locations";
import Approvals from "./pages/Approvals";
import DeliveryDashboard from "./pages/DeliveryDashboard";
import ABTests from "./pages/ABTests";
import SegmentTemplates from "./pages/SegmentTemplates";
import InboundLogs from "./pages/InboundLogs";
import CalendarPage from "./pages/CalendarPage";
import HelpCenter from "./pages/HelpCenter";
import CustomerChart from "./pages/CustomerChart";
import Commission from "./pages/Commission";
import Retention from "./pages/Retention";
import Reservations from "./pages/Reservations";
import ReservationAction from "./pages/ReservationAction";
import ChannelIntegrations from "./pages/ChannelIntegrations";
import SyncReview from "./pages/SyncReview";
import SalonboardOnboarding from "./pages/SalonboardOnboarding";
import NotFound from "./pages/NotFound";
import { LocationProvider } from "@/hooks/useLocations";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <LocationProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/book/:token" element={<Booking />} />
            <Route path="/my-bookings/:token" element={<MyBookings />} />
            <Route path="/salon/:slug" element={<PublicBooking />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
            <Route path="/customers/:customerId/chart" element={<ProtectedRoute><CustomerChart /></ProtectedRoute>} />
            <Route path="/commission" element={<ProtectedRoute><Commission /></ProtectedRoute>} />
            <Route path="/retention" element={<ProtectedRoute><Retention /></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><ImportCustomers /></ProtectedRoute>} />
            <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
            <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} />
            <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
            <Route path="/inbound-logs" element={<ProtectedRoute><InboundLogs /></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
            <Route path="/reservations" element={<ProtectedRoute><Reservations /></ProtectedRoute>} />
            <Route path="/delivery" element={<ProtectedRoute><DeliveryDashboard /></ProtectedRoute>} />
            <Route path="/ab-tests" element={<ProtectedRoute><ABTests /></ProtectedRoute>} />
            <Route path="/segment-templates" element={<ProtectedRoute><SegmentTemplates /></ProtectedRoute>} />
            <Route path="/share" element={<ProtectedRoute><Share /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/email-logs" element={<ProtectedRoute><EmailLogs /></ProtectedRoute>} />
            <Route path="/line-broadcast" element={<ProtectedRoute><LineBroadcast /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute><Templates /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
            <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
            <Route path="/menu-items" element={<ProtectedRoute><MenuItems /></ProtectedRoute>} />
            <Route path="/staff" element={<ProtectedRoute><Staff /></ProtectedRoute>} />
            <Route path="/incentives" element={<ProtectedRoute><Incentives /></ProtectedRoute>} />
            <Route path="/points" element={<ProtectedRoute><Points /></ProtectedRoute>} />
            <Route path="/salonboard-export" element={<ProtectedRoute><SalonBoardExport /></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/locations" element={<ProtectedRoute><Locations /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/help" element={<ProtectedRoute><HelpCenter /></ProtectedRoute>} />
            <Route path="/help/:slug" element={<ProtectedRoute><HelpCenter /></ProtectedRoute>} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/tokushoho" element={<Tokushoho />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="/r/:actionPath/:token" element={<ReservationAction />} />
            <Route path="/channel-integrations" element={<ProtectedRoute><ChannelIntegrations /></ProtectedRoute>} />
            <Route path="/sync-review" element={<ProtectedRoute><SyncReview /></ProtectedRoute>} />
            <Route path="/onboarding/salonboard" element={<ProtectedRoute><SalonboardOnboarding /></ProtectedRoute>} />
            <Route path="/onboarding/salonboard/:locationId" element={<ProtectedRoute><SalonboardOnboarding /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </LocationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
