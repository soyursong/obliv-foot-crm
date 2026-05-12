import { lazy, Suspense, type ReactNode } from 'react';
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
const CustomerChartPage = lazy(() => import('@/pages/CustomerChartPage'));
const DailyHistory = lazy(() => import('@/pages/DailyHistory'));
const Services = lazy(() => import('@/pages/Services'));
const DoctorTools = lazy(() => import('@/pages/DoctorTools'));
const TreatmentTable = lazy(() => import('@/pages/TreatmentTable'));
const TabletChecklistPage = lazy(() => import('@/pages/TabletChecklistPage'));
const Notices = lazy(() => import('@/pages/Notices'));
// ClinicCalendar 풀페이지는 T-20260510-foot-CALENDAR-NOTICE AC v3에 따라 우측 사이드바로 대체됨.
// 직접 URL 접근 시 대시보드로 리다이렉트.

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

/** 셀프체크인 고객화면: 브라운/베이지 테마 래퍼 (CRM 관리화면과 테마 분리) */
function ThemeBrown({ children }: { children: ReactNode }) {
  return <div className="theme-brown">{children}</div>;
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
              <Route path="/checkin/:clinicSlug" element={<ThemeBrown><SelfCheckIn /></ThemeBrown>} />
              <Route path="/checklist/:checkInId" element={<ThemeBrown><TabletChecklistPage /></ThemeBrown>} />
              <Route path="/waiting/:clinicSlug" element={<ThemeBrown><Waiting /></ThemeBrown>} />
              <Route path="/chart/:customerId" element={
                <ProtectedRoute>
                  <CustomerChartPage />
                </ProtectedRoute>
              } />

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
                <Route path="stats" element={<RoleGuard roles={['admin', 'manager', 'part_lead']}><Stats /></RoleGuard>} />
                <Route path="history" element={<DailyHistory />} />
                <Route path="accounts" element={<RoleGuard roles={['admin']}><Accounts /></RoleGuard>} />
                <Route path="services" element={<RoleGuard roles={['admin', 'manager']}><Services /></RoleGuard>} />
                {/* T-20260512-foot-QUICK-RX-BUTTON: 치료사/원장도 진료환자목록 탭 접근 가능 */}
                <Route path="doctor-tools" element={<RoleGuard roles={['admin', 'manager', 'director', 'therapist', 'technician', 'part_lead']}><DoctorTools /></RoleGuard>} />
                <Route path="treatment-table" element={<TreatmentTable />} />
                <Route path="notices" element={<Notices />} />
                {/* calendar 풀페이지 → 대시보드로 리다이렉트 (사이드바 패널로 대체) */}
                <Route path="calendar" element={<Navigate to="/admin" replace />} />
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
