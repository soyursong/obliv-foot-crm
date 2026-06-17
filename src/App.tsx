// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy<T> 자체가 ComponentType<any> 상한을 요구
import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { ProtectedRoute, RoleGuard } from '@/components/ProtectedRoute';
import AdminLayout from '@/components/AdminLayout';
// T-20260610-foot-SPA-VERSION-AUTORELOAD: 배포 후 stale-app 재발방지 — 신버전 감지 배너
import UpdateBanner from '@/components/UpdateBanner';

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
// T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT: 진료관리 — 어드민성 진료 도구 모음.
// T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN(7fed414) SUPERSEDED: 진료관리=서비스 목록과 동일 role(직원 포함) 개방.
//   → director-only 의도는 stale. 라우트 가드는 서비스관리 진입 role set ∪ director 로 정합(아래 clinic-management Route 참조).
const ClinicManagement = lazyWithRetry(() => import('@/pages/ClinicManagement'));
const TreatmentTable = lazyWithRetry(() => import('@/pages/TreatmentTable'));
const TabletChecklistPage = lazyWithRetry(() => import('@/pages/TabletChecklistPage'));
const Notices = lazyWithRetry(() => import('@/pages/Notices'));
// T-20260605-foot-HANDOVER-BOARD: 파트별 인수인계 게시판(캘린더) — 전 직원 작성/조회
const Handover = lazyWithRetry(() => import('@/pages/Handover'));
const Sales = lazyWithRetry(() => import('@/pages/Sales'));
// T-20260617-foot-CLINICINFO-DIRECTOR-TO-STAFFSPACE: ClinicSettings는 더 이상 독립 라우트가 아니라
//   Staff.tsx '원장정보' 탭에 임베드됨 → App.tsx lazy import 제거(미사용). /admin/clinic-settings 는 리다이렉트.
// T-20260525-foot-MESSAGING-V1 AC-3: 메시지 설정 페이지 (admin/manager/director 전용)
const AdminSettings = lazyWithRetry(() => import('@/pages/AdminSettings'));
// T-20260528-foot-PENCHART-NEWWIN: 펜차트 별도 팝업 편집 창
const PenChartEditorPage = lazyWithRetry(() => import('@/pages/PenChartEditorPage'));
// T-20260529-foot-HEALTH-Q-MOBILE: 발건강질문지 고객 모바일 자가작성 (anon)
const HealthQMobilePage = lazyWithRetry(() => import('@/pages/HealthQMobilePage'));
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

/**
 * T-20260603-foot-CHECKIN-OLDURL-DEPRECATE: 구 셀프접수 URL 안전망 회수.
 * jongno-foot canonical 은 foot-checkin.pages.dev 로 단일 이전됨(6/2 CF-CUTOVER, 6/3 현장 정착).
 * PROD 1차 차단은 vercel.json 308 edge redirect 가 담당하지만, edge 우회/SPA client-side
 * 진입 시에도 stale native SelfCheckIn 으로 신규 접수가 생성되지 않도록 SPA 레벨에서도
 * canonical 로 강제 리다이렉트(방어심화). 비-deprecated slug 는 기존 native 렌더 보존(로컬/타 클리닉).
 */
const DEPRECATED_CHECKIN_CANONICAL: Record<string, string> = {
  'jongno-foot': 'https://foot-checkin.pages.dev/jongno-foot',
};

function CheckinRoute() {
  const { clinicSlug } = useParams();
  const canonical = clinicSlug ? DEPRECATED_CHECKIN_CANONICAL[clinicSlug] : undefined;
  useEffect(() => {
    if (canonical) window.location.replace(canonical);
  }, [canonical]);
  if (canonical) {
    return (
      <div className="theme-brown flex h-full min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-base font-medium">셀프접수 주소가 변경되었습니다.</p>
        <p className="text-sm text-muted-foreground">자동으로 새 접수 화면으로 이동합니다…</p>
        <a href={canonical} className="text-sm underline">
          이동되지 않으면 여기를 눌러주세요
        </a>
      </div>
    );
  }
  return (
    <ThemeBrown>
      <SelfCheckIn />
    </ThemeBrown>
  );
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
        {/* T-20260610-foot-SPA-VERSION-AUTORELOAD: 신버전 감지 시 하단 배너(사용자 클릭으로만 reload) */}
        <UpdateBanner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              {/* T-20260531-foot-JONGNOFOOT-NORMAL-SETUP AC-2/AC-6:
                  jongno-foot 셀프접수를 obliv-foot-crm 자기 도메인에 정상 복귀.
                  PURGE(L1) 후속 — HFQ 리다이렉트 제거. /checkin/jongno-foot 은
                  일반 :clinicSlug 라우트로 떨어져 풋 CRM 네이티브 SelfCheckIn 렌더.
                  (HFQ 코드/DB 비참조 — LOCKDOWN dev_ops_policy v2.5 §1-1)
                  ⚠️ T-20260602-foot-CHECKIN-STALE-COPY-CONSOLIDATE: CF-CUTOVER 로 jongno-foot
                  canonical 이 foot-checkin.pages.dev(soyursong/foot-checkin)로 이전됨. 본 native
                  SelfCheckIn 은 YESNO-FLOW/VISITTYPE-REMOVE 미반영 stale 사본이 되어
                  PROD 에서는 vercel.json 의 308 edge redirect 로 /checkin/jongno-foot →
                  canonical 단일화됨(이 SPA 라우트까지 도달 안 함). 로컬/타 클리닉 slug 는 그대로
                  native 렌더 — :clinicSlug 제네릭 라우트는 보존.
                  ⚠️ T-20260603-foot-CHECKIN-OLDURL-DEPRECATE: 안전망 회수 — deprecated slug
                  (jongno-foot)는 CheckinRoute 에서 canonical 로 강제 리다이렉트(방어심화). */}
              <Route path="/checkin/:clinicSlug" element={<CheckinRoute />} />
              <Route path="/checklist/:checkInId" element={<ThemeBrown><TabletChecklistPage /></ThemeBrown>} />
              <Route path="/waiting/:clinicSlug" element={<ThemeBrown><Waiting /></ThemeBrown>} />
              <Route path="/chart/:customerId" element={
                <ProtectedRoute>
                  <CustomerChartPage />
                </ProtectedRoute>
              } />
              {/* T-20260528-foot-PENCHART-NEWWIN: 펜차트 별도 팝업 편집 창 */}
              <Route path="/penchart-editor" element={
                <ProtectedRoute>
                  <PenChartEditorPage />
                </ProtectedRoute>
              } />
              {/* T-20260529-foot-HEALTH-Q-MOBILE: 발건강질문지 고객 자가작성 (anon, 토큰 기반)
                  ThemeBrown 미적용 — 자체 teal-emerald 테마 inline style 사용 */}
              <Route path="/health-q/:token" element={<HealthQMobilePage />} />

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
                {/* T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN(policy_correction_jnz7 — 김주연 총괄 직접): 일마감=직원 업무(daily closing workflow) → 전직원(8역할, tm 제외) OPEN. 이전 회수는 '일마감'을 '매출집계'로 오분류한 것 정정. 매출집계(실장별·치료사별 성과)는 별도 /admin/sales(admin/manager EXCL). AdminLayout nav + PERM_MATRIX.closing 3-gate 파리티(메뉴 보이는데 route 튕김=NAV-BOUNCE 차단). */}
                <Route path="closing" element={<RoleGuard roles={['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff']}><Closing /></RoleGuard>} />
                {/* AC-6: 통계 — consultant/coordinator/therapist 직접 URL 차단 유지 */}
                {/* T-20260610-foot-STAFF-ROLE-TM-ADD AC6 (박민지 팀장 C안): TM → 통계 route 접근 허용.
                    통계 내부 탭 가시성(TM집계 탭만)은 자매 티켓 STATS-TM-AGGREGATE-TAB 에서 처리. */}
                <Route path="stats" element={<RoleGuard roles={['admin', 'manager', 'part_lead', 'tm']}><Stats /></RoleGuard>} />
                <Route path="history" element={<DailyHistory />} />
                {/* AC-6: 계정관리 — admin 전용 유지 */}
                <Route path="accounts" element={<RoleGuard roles={['admin']}><Accounts /></RoleGuard>} />
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 서비스관리 접근 (뷰 전용) */}
                <Route path="services" element={<RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'therapist']}><Services /></RoleGuard>} />
                {/* T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT (AC-3) → T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN(7fed414) SUPERSEDED.
                    진료관리 = 서비스관리(/admin/services) 와 동일하게 직원 개방(Services.tsx canViewClinicMgmt=!!profile?.role).
                    STAFF-OPEN 은 서브탭만 열고 이 독립 라우트는 불변으로 남겨 이중성(서브탭 열림↔직접 URL 차단)이 잔존했음.
                    T-20260615-foot-CLINICMGMT-SPEC-ALIGN-SUPERSEDE(AC-2): 라우트 가드를 services 진입 role set ∪ director 로 정합.
                    director(원장)는 진료차트 '관리 화면으로'(MedicalChartPanel) 직접 진입 연속성 위해 보존.
                    ⚠ FE 가시성/라우트 게이트만 — 진료관리 내부 각 패널의 데이터 RLS/WRITE 권한 불변(umbrella Phase2 RLS 트랙 소관). */}
                <Route path="clinic-management" element={<RoleGuard roles={['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist']}><ClinicManagement /></RoleGuard>} />
                {/* T-20260512-foot-QUICK-RX-BUTTON: 치료사/원장도 진료환자목록 탭 접근 가능 */}
                {/* T-20260520-foot-RBAC-MENU-EXPAND AC-2: consultant/coordinator 진료도구 접근 추가 */}
                <Route path="doctor-tools" element={<RoleGuard roles={['admin', 'manager', 'director', 'therapist', 'technician', 'part_lead', 'consultant', 'coordinator']}><DoctorTools /></RoleGuard>} />
                {/* T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN: 치료사 평가 근거 데이터 → 어드민(원장/관리자)만. 직접 URL 차단(라우트 가드) + 메뉴 숨김(AdminLayout) 이중. Sales와 동일 게이트 */}
                <Route path="treatment-table" element={<RoleGuard roles={['admin', 'manager']}><TreatmentTable /></RoleGuard>} />
                <Route path="notices" element={<Notices />} />
                {/* T-20260605-foot-HANDOVER-BOARD AC-5: 전 직원 작성/조회 — RoleGuard 없음 */}
                <Route path="handover" element={<Handover />} />
                {/* T-20260515-foot-SALES-COMMON-DB: 매출집계 — AC-6 미노출 유지 */}
                <Route path="sales" element={<RoleGuard roles={['admin', 'manager']}><Sales /></RoleGuard>} />
                {/* T-20260516-foot-CLINIC-DOC-INFO: 병원·원장 정보 설정 */}
                {/* T-20260617-foot-CLINICINFO-DIRECTOR-TO-STAFFSPACE: 병원·원장 정보 메뉴를 [직원·공간](Staff)
                    내부 '원장정보' 탭으로 편입(김주연 총괄). 이 라우트는 북마크/하드링크 404 방지용
                    리다이렉트로 보존 → /admin/staff?tab=clinic-info. ClinicSettings 콘텐츠는 Staff.tsx에서 임베드.
                    가시성 role(admin/manager/consultant/coordinator/therapist)은 staff 라우트 가드와 동일 집합으로 보존. */}
                <Route path="clinic-settings" element={<Navigate to="/admin/staff?tab=clinic-info" replace />} />
                {/* T-20260525-foot-MESSAGING-V1 AC-3: 메시지 설정 */}
                {/* T-20260525-foot-ROLE-PERM-CUSTOM 3차: consultant/coordinator/therapist 추가 */}
                {/* T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: part_lead/staff 추가 = 전직원(8역할). PERM_MATRIX.messaging 과 동일 집합 SSOT. ★tm 제외★(AC6 STAFF-ROLE-TM-ADD 최소권한). 연결설정(Solapi)=adminOnly 내부게이팅 → staff 라우트 개방해도 자격증명/계정/통계/매출 누수 0. */}
                <Route path="settings" element={<RoleGuard roles={['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff']}><AdminSettings /></RoleGuard>} />
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
