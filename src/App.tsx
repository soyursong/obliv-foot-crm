import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { ProtectedRoute, RoleGuard } from '@/components/ProtectedRoute';
import AdminLayout from '@/components/AdminLayout';

const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Reservations = lazy(() => import('@/pages/Reservations'));
const Customers = lazy(() => import('@/pages/Customers'));
const Packages = lazy(() => import('@/pages/Packages'));
const Staff = lazy(() => import('@/pages/Staff'));
const Closing = lazy(() => import('@/pages/Closing'));
const Stats = lazy(() => import('@/pages/Stats'));
const Accounts = lazy(() => import('@/pages/Accounts'));
const SelfCheckIn = lazy(() => import('@/pages/SelfCheckIn'));
const Waiting = lazy(() => import('@/pages/Waiting'));
const DailyHistory = lazy(() => import('@/pages/DailyHistory'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      불러오는 중…
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Toaster richColors position="top-right" />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/checkin/:clinicSlug" element={<SelfCheckIn />} />
              <Route path="/waiting/:clinicSlug" element={<Waiting />} />

              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="reservations" element={<Reservations />} />
                <Route path="customers" element={<Customers />} />
                <Route path="packages" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator']}><Packages /></RoleGuard>} />
                <Route path="staff" element={<RoleGuard roles={['admin', 'manager']}><Staff /></RoleGuard>} />
                <Route path="closing" element={<RoleGuard roles={['admin', 'manager']}><Closing /></RoleGuard>} />
                <Route path="stats" element={<RoleGuard roles={['admin', 'manager']}><Stats /></RoleGuard>} />
                <Route path="history" element={<DailyHistory />} />
                <Route path="accounts" element={<RoleGuard roles={['admin']}><Accounts /></RoleGuard>} />
              </Route>

              <Route path="/" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
