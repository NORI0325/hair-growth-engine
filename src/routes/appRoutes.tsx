import type { ReactNode } from "react";
import { Route } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import ABTests from "@/pages/ABTests";
import Admin from "@/pages/Admin";
import Approvals from "@/pages/Approvals";
import Auth from "@/pages/Auth";
import Billing from "@/pages/Billing";
import Booking from "@/pages/Booking";
import Bookings from "@/pages/Bookings";
import CalendarPage from "@/pages/CalendarPage";
import Campaigns from "@/pages/Campaigns";
import ChannelIntegrations from "@/pages/ChannelIntegrations";
import Commission from "@/pages/Commission";
import CustomerChart from "@/pages/CustomerChart";
import Customers from "@/pages/Customers";
import Dashboard from "@/pages/Dashboard";
import DeliveryDashboard from "@/pages/DeliveryDashboard";
import EmailLogs from "@/pages/EmailLogs";
import ForgotPassword from "@/pages/ForgotPassword";
import HelpCenter from "@/pages/HelpCenter";
import ImportCustomers from "@/pages/ImportCustomers";
import Inbox from "@/pages/Inbox";
import Incentives from "@/pages/Incentives";
import Index from "@/pages/Index";
import InboundLogs from "@/pages/InboundLogs";
import InviteAccept from "@/pages/InviteAccept";
import LineBroadcast from "@/pages/LineBroadcast";
import Locations from "@/pages/Locations";
import MenuItems from "@/pages/MenuItems";
import MyBookings from "@/pages/MyBookings";
import NotFound from "@/pages/NotFound";
import Onboarding from "@/pages/Onboarding";
import Performance from "@/pages/Performance";
import Points from "@/pages/Points";
import Privacy from "@/pages/Privacy";
import PublicBooking from "@/pages/PublicBooking";
import ReservationAction from "@/pages/ReservationAction";
import Reservations from "@/pages/Reservations";
import ResetPassword from "@/pages/ResetPassword";
import Retention from "@/pages/Retention";
import SalonBoardExport from "@/pages/SalonBoardExport";
import SalonboardAutoMapping from "@/pages/SalonboardAutoMapping";
import SalonboardOnboarding from "@/pages/SalonboardOnboarding";
import Schedule from "@/pages/Schedule";
import SegmentTemplates from "@/pages/SegmentTemplates";
import Settings from "@/pages/Settings";
import Share from "@/pages/Share";
import Staff from "@/pages/Staff";
import SyncReview from "@/pages/SyncReview";
import Team from "@/pages/Team";
import Templates from "@/pages/Templates";
import Terms from "@/pages/Terms";
import Tokushoho from "@/pages/Tokushoho";
import Unsubscribe from "@/pages/Unsubscribe";

const protectedRoute = (element: ReactNode) => (
  <ProtectedRoute>{element}</ProtectedRoute>
);

export const appRoutes = (
  <>
    <Route path="/" element={<Index />} />
    <Route path="/auth" element={<Auth />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/book/:token" element={<Booking />} />
    <Route path="/my-bookings/:token" element={<MyBookings />} />
    <Route path="/salon/:slug" element={<PublicBooking />} />
    <Route path="/dashboard" element={protectedRoute(<Dashboard />)} />
    <Route path="/inbox" element={protectedRoute(<Inbox />)} />
    <Route path="/customers" element={protectedRoute(<Customers />)} />
    <Route path="/customers/:customerId/chart" element={protectedRoute(<CustomerChart />)} />
    <Route path="/commission" element={protectedRoute(<Commission />)} />
    <Route path="/retention" element={protectedRoute(<Retention />)} />
    <Route path="/import" element={protectedRoute(<ImportCustomers />)} />
    <Route path="/campaigns" element={protectedRoute(<Campaigns />)} />
    <Route path="/bookings" element={protectedRoute(<Bookings />)} />
    <Route path="/calendar" element={protectedRoute(<CalendarPage />)} />
    <Route path="/inbound-logs" element={protectedRoute(<InboundLogs />)} />
    <Route path="/approvals" element={protectedRoute(<Approvals />)} />
    <Route path="/reservations" element={protectedRoute(<Reservations />)} />
    <Route path="/delivery" element={protectedRoute(<DeliveryDashboard />)} />
    <Route path="/ab-tests" element={protectedRoute(<ABTests />)} />
    <Route path="/segment-templates" element={protectedRoute(<SegmentTemplates />)} />
    <Route path="/share" element={protectedRoute(<Share />)} />
    <Route path="/settings" element={protectedRoute(<Settings />)} />
    <Route path="/email-logs" element={protectedRoute(<EmailLogs />)} />
    <Route path="/line-broadcast" element={protectedRoute(<LineBroadcast />)} />
    <Route path="/templates" element={protectedRoute(<Templates />)} />
    <Route path="/schedule" element={protectedRoute(<Schedule />)} />
    <Route path="/performance" element={protectedRoute(<Performance />)} />
    <Route path="/menu-items" element={protectedRoute(<MenuItems />)} />
    <Route path="/staff" element={protectedRoute(<Staff />)} />
    <Route path="/incentives" element={protectedRoute(<Incentives />)} />
    <Route path="/points" element={protectedRoute(<Points />)} />
    <Route path="/salonboard-export" element={protectedRoute(<SalonBoardExport />)} />
    <Route path="/onboarding" element={protectedRoute(<Onboarding />)} />
    <Route path="/billing" element={protectedRoute(<Billing />)} />
    <Route path="/team" element={protectedRoute(<Team />)} />
    <Route path="/locations" element={protectedRoute(<Locations />)} />
    <Route path="/admin" element={protectedRoute(<Admin />)} />
    <Route path="/help" element={protectedRoute(<HelpCenter />)} />
    <Route path="/help/:slug" element={protectedRoute(<HelpCenter />)} />
    <Route path="/invite/:token" element={<InviteAccept />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/tokushoho" element={<Tokushoho />} />
    <Route path="/unsubscribe" element={<Unsubscribe />} />
    <Route path="/r/:actionPath/:token" element={<ReservationAction />} />
    <Route path="/channel-integrations" element={protectedRoute(<ChannelIntegrations />)} />
    <Route path="/sync-review" element={protectedRoute(<SyncReview />)} />
    <Route path="/onboarding/salonboard" element={protectedRoute(<SalonboardOnboarding />)} />
    <Route path="/onboarding/salonboard/:locationId" element={protectedRoute(<SalonboardOnboarding />)} />
    <Route path="/onboarding/salonboard/:locationId/auto-mapping" element={protectedRoute(<SalonboardAutoMapping />)} />
    <Route path="/onboarding/salonboard-auto-mapping" element={protectedRoute(<SalonboardAutoMapping />)} />
    <Route path="*" element={<NotFound />} />
  </>
);
