// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy<T> 자체가 ComponentType<any> 상한을 요구
import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { ProtectedRoute, RoleGuard } from '@/components/ProtectedRoute';
import AdminLayout from '@/components/AdminLayout';

/**
 * T-20260522-foot-SPA-NAV-RELOAD: chunk load failure 자동 복구
 * 새 배포 후 구버전 chunk URL이 404를 반환할 때 자동 리로드로 복구.
 * sessionStorage 플래그로 무한 리로드 방지 (최대 1회).
 * 성공 시 플래그 해제 → 이후 다른 청크 오류도 한 번 더 시도 가능.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy<T>(() =>
    factory()
      .then((mod) => {
        // 정상 로드 → 이전 실패 플래그 초기화
        sessionStorage.removeItem('spa_reload_tried');
        return mod;
      })
      .catch((): Promise<{ default: T }> => {
        if (!sessionStorage.getItem('spa_reload_tried')) {
          sessionStorage.setItem('spa_reload_tried', '1');
          window.location.reload();
          // 페이지가 곧 리로드됨 — 이 Promise는 resolve되지 않음
          return new Promise<{ default: T }>(() => {});
        }
        // 리로드 후에도 실패 → ErrorBoundary에서 복구 UI 제공
        return Promise.reject(new Error('페이지 청크 로드 실패 — 새로고침이 필요합니다.'));
      }),
  );
}

const Login = lazyWithRetry(() => import('@/pages/Login'));
const Register = lazyWithRetry(() => import('@/pages/Register'));
const Dashboard = lazyWithRetry(() => import('@/pages/Dashboard'));
const Reservations = lazyWithRetry(() => import('@/pages/Reservations'));
const Customers = lazyWithRetry(() => import('@/pages/Customers'));
const Packages = lazyWithRetry(() => import('@/pages/Packages'));
const Staff = lazyWithRetry(() => import('@/pages/Staff'));
const Closing = lazyWithRetry(() => import('@/pages/Closing'));
const Stats = lazyWithRetry(() => import('@/pages/Stats'));
const Accounts = lazyWithRetry(() => import('@/pages/Accounts'));
const SelfCheckIn = lazyWithRetry(() => import('@/pages/SelfCheckIn'));
const Waiting = lazyWithRetry(() => import('@/pages/Waiting'));
const CustomerChartPage = lazyWithRetry(() => import('@/pages/CustomerChartPage'));
const DailyHistory = lazyWithRetry(() => import('@/pages/DailyHistory'));
const Services = lazyWithRetry(() => import('@/pages/Services'));
const DoctorTools = lazyWithRetry(() => import('@/pages/DoctorTools'));
const TreatmentTable = lazyWithRetry(() => import('@/pages/TreatmentTable'));
const TabletChecklistPage = lazyWithRetry(() => import('@/pages/TabletChecklistPage'));
const Notices = lazyWithRetry(() => import('@/pages/Notices'));
const Sales = lazyWithRetry(() => import('@/pages/Sales'));
const ClinicSettings = lazyWithRetry(() => import('@/pages/ClinicSettings'));
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
        {/* T-20260524-foot-TOAST-POS-COMPACT: 중앙 상단 + compact */}
        <Toaster
          richColors
          position="top-center"
          gap={8}
          toastOptions={{
            classNames: {
              toast: 'py-2 px-3 gap-2 min-w-0 max-w-xs text-sm',
              title: 'text-sm font-medium leading-tight',
              description: 'text-xs leading-snug',
              icon: 'w-4 h-4 shrink-0',
            },
          }}
        />
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
                {/* T-20260522-foot-STAFF-REEXPAND: staff/part_lead 재허용 (총괄 직원 리뷰 완료 후 재적용) */}
                {/* consultant/coordinator=WRITE, therapist/staff/part_lead=READ-only (Packages.tsx canWritePackage 기준) */}
                <Route path="packages" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'staff', 'part_lead']}><Packages /></RoleGuard>} />
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 직원·공간 접근 */}
                <Route path="staff" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist']}><Staff /></RoleGuard>} />
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 일마감 접근 (뷰 전용) */}
                <Route path="closing" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist']}><Closing /></RoleGuard>} />
                {/* AC-6: 통계 — consultant/coordinator/therapist 직접 URL 차단 유지 */}
                <Route path="stats" element={<RoleGuard roles={['admin', 'manager', 'part_lead']}><Stats /></RoleGuard>} />
                <Route path="history" element={<DailyHistory />} />
                {/* AC-6: 계정관리 — admin 전용 유지 */}
                <Route path="accounts" element={<RoleGuard roles={['admin']}><Accounts /></RoleGuard>} />
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 서비스관리 접근 (뷰 전용) */}
                <Route path="services" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist']}><Services /></RoleGuard>} />
                {/* T-20260512-foot-QUICK-RX-BUTTON: 치료사/원장도 진료환자목록 탭 접근 가능 */}
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-2: consultant/coordinator 진료도구 접근 추가 */}
                <Route path="doctor-tools" element={<RoleGuard roles={['admin', 'manager', 'director', 'therapist', 'technician', 'part_lead', 'consultant', 'coordinator']}><DoctorTools /></RoleGuard>} />
                <Route path="treatment-table" element={<TreatmentTable />} />
                <Route path="notices" element={<Notices />} />
                {/* T-20260515-foot-SALES-COMMON-DB: 매출집계 — AC-6 미노출 유지 */}
                <Route path="sales" element={<RoleGuard roles={['admin', 'manager']}><Sales /></RoleGuard>} />
                {/* T-20260516-foot-CLINIC-DOC-INFO: 병원·원장 정보 설정 */}
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 접근 추가 */}
                <Route path="clinic-settings" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist']}><ClinicSettings /></RoleGuard>} />
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
