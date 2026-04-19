import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index";
import CheckIn from "./pages/CheckIn";
import WaitingScreen from "./pages/WaitingScreen";
import AdminLogin from "./pages/AdminLogin";
import NotFound from "./pages/NotFound";

// Lazy-loaded admin pages
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminReservations = lazy(() => import("./pages/AdminReservations"));
const AdminCustomers = lazy(() => import("./pages/AdminCustomers"));
const AdminHistory = lazy(() => import("./pages/AdminHistory"));
const AdminStaff = lazy(() => import("./pages/AdminStaff"));
const AdminClosing = lazy(() => import("./pages/AdminClosing"));
const AdminRegister = lazy(() => import("./pages/AdminRegister"));
const AdminStats = lazy(() => import("./pages/AdminStats"));
const TmMain = lazy(() => import("./pages/TmMain"));
const TmRegister = lazy(() => import("./pages/TmRegister"));

const queryClient = new QueryClient();

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/wait/:checkInId" element={<WaitingScreen />} />
            <Route path="/admin" element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/reservations" element={<AdminReservations />} />
            <Route path="/admin/customers" element={<AdminCustomers />} />
            <Route path="/admin/history" element={<AdminHistory />} />
            <Route path="/admin/staff" element={<AdminStaff />} />
            <Route path="/admin/closing" element={<AdminClosing />} />
            <Route path="/admin/register" element={<AdminRegister />} />
            <Route path="/admin/stats" element={<AdminStats />} />
            <Route path="/tm" element={<TmMain />} />
            <Route path="/tm/register" element={<TmRegister />} />
            <Route path="/:clinicSlug" element={<CheckIn />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
