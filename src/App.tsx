import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
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
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/book/:token" element={<Booking />} />
            <Route path="/my-bookings/:token" element={<MyBookings />} />
            <Route path="/salon/:slug" element={<PublicBooking />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><ImportCustomers /></ProtectedRoute>} />
            <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
            <Route path="/bookings" element={<ProtectedRoute><Bookings /></ProtectedRoute>} />
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
            <Route path="/salonboard-export" element={<ProtectedRoute><SalonBoardExport /></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/tokushoho" element={<Tokushoho />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
