// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. openChart/ChartContext.Provider/CustomerChartSheet 단일 구현. 변경 시 현장 승인 필수
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ChartContext } from '@/lib/chartContext';
import { CustomerChartSheet } from '@/components/CustomerChartSheet';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarPlus,
  Users,
  Package,
  UserCog,
  Receipt,
  BarChart3,
  ShieldCheck,
  LogOut,
  Menu,
  Search,
  X,
  ClipboardList,
  Stethoscope,
  BookOpen,
  Table2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Building2,
  KeyRound,
  MessageSquare,
} from 'lucide-react';
import CalendarNoticePanel from '@/components/CalendarNoticePanel';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { useClinic } from '@/hooks/useClinic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';
import ChangePasswordDialog from '@/components/ChangePasswordDialog';
// T-20260522-foot-TABLET-DUAL-LAYOUT: orientation 훅
import { useOrientation } from '@/hooks/useOrientation';

// ── T-20260522-foot-SPA-NAV-RELOAD ───────────────────────────────────────────
// Outlet 전용 Suspense + ErrorBoundary.
// AdminLayout(사이드바·헤더·CalendarNoticePanel)이 route 전환 중에도 unmount되지 않도록
// Outlet만 독립적인 Suspense 경계 안에 감싼다.
// App.tsx 최상위 Suspense는 비-admin 경로(Login·Register·SelfCheckIn 등)를 위해 유지.
// ─────────────────────────────────────────────────────────────────────────────
function OutletPageLoader() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      불러오는 중…
    </div>
  );
}

interface EBState { hasError: boolean }
class ChunkErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <p className="text-sm text-muted-foreground">
            페이지를 불러오는 중 오류가 발생했습니다.
          </p>
          <button
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// T-20260523-foot-NAV-MENU-REORDER: 사이드바 메뉴 순서 재배치
const NAV_ITEMS: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  roles?: UserRole[];
}[] = [
  { to: '/admin', label: '대시보드', icon: LayoutDashboard, end: true },
  { to: '/admin/reservations', label: '예약관리', icon: CalendarDays },
  { to: '/admin/customers', label: '고객관리', icon: Users },
  // T-20260520-foot-RBAC-MENU-EXPAND: consultant/coordinator/therapist 메뉴 권한 확장
  // AC-4: therapist → 패키지 신규 접근
  { to: '/admin/packages', label: '패키지', icon: Package, roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist'] },
  // AC-2: consultant/coordinator → 진료도구 신규 접근
  { to: '/admin/doctor-tools', label: '진료 도구', icon: BookOpen, roles: ['admin', 'manager', 'consultant', 'coordinator'] },
  // AC-1: 3역할 → 서비스관리 접근 (뷰 전용; WRITE=admin만)
  { to: '/admin/services', label: '서비스관리', icon: Stethoscope, roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist'] },
  // AC-1: 3역할 → 직원·공간관리 접근
  { to: '/admin/staff', label: '직원·공간', icon: UserCog, roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist'] },
  // AC-1: 3역할 → 병원·원장 정보 접근 (뷰 전용)
  { to: '/admin/clinic-settings', label: '병원·원장 정보', icon: Building2, roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist'] },
  { to: '/admin/treatment-table', label: '치료 테이블', icon: Table2 },
  // AC-1: 3역할 → 일마감 접근 (뷰 전용; WRITE=admin/manager만)
  { to: '/admin/closing', label: '일마감', icon: Receipt, roles: ['admin', 'manager', 'consultant', 'coordinator', 'therapist'] },
  { to: '/admin/history', label: '일일 이력', icon: ClipboardList },
  // AC-6: 통계 미노출 유지 (consultant/coordinator/therapist 제외)
  { to: '/admin/stats', label: '통계', icon: BarChart3, roles: ['admin', 'manager', 'part_lead'] },
  // AC-6: 매출집계 미노출 유지
  { to: '/admin/sales', label: '매출집계', icon: TrendingUp, roles: ['admin', 'manager'] },
  { to: '/admin/accounts', label: '계정관리', icon: ShieldCheck, roles: ['admin'] },
  // T-20260525-foot-MESSAGING-V1 AC-3: 메시지 설정
  // T-20260525-foot-ROLE-PERM-CUSTOM A안: consultant 추가 (통계·매출집계·계정관리 외 전권한)
  { to: '/admin/settings', label: '메시지 설정', icon: MessageSquare, roles: ['admin', 'manager', 'director', 'consultant'] },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const clinic = useClinic();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('foot-sidebar-collapsed') === 'true',
  );

  // T-20260522-foot-TABLET-DUAL-LAYOUT: AC-2 portrait 사이드바 자동 최소화
  // portrait 진입 시: viewport >= lg(1024px)이면 사이드바 자동 접기 (localStorage 보존)
  // landscape 복귀 시: localStorage 저장값 복원 (사용자 수동 설정 보존)
  const orientation = useOrientation();
  useEffect(() => {
    if (orientation === 'portrait') {
      // SM-X400 portrait(~800px)은 lg 이하라 desktop sidebar가 hidden — 무해
      // 혹시 lg+ 세로 태블릿이면 자동 최소화 (localStorage에는 쓰지 않아 landscape 복원 시 원래 값 유지)
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        setSidebarCollapsed(true);
      }
    } else {
      // landscape 복원
      const saved = localStorage.getItem('foot-sidebar-collapsed') === 'true';
      setSidebarCollapsed(saved);
    }
  }, [orientation]);

  // T-20260519-foot-STAFF-PW-CHANGE: 비밀번호 변경 다이얼로그
  const [pwChangeOpen, setPwChangeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone: string; birth_date: string | null; chart_number: string | null }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // UX-9: 사이드바 알림 뱃지 — 오늘 결제대기 건수
  const [paymentWaitingCount, setPaymentWaitingCount] = useState<number>(0);
  // T-20260516-foot-CHART2-STATE-UNIFY AC-1: 2번차트 단일 소스 (3개 분산 state 통합)
  // ─────────────────────────────────────────────────────────────────────────────
  // CRITICAL: DO NOT MODIFY — Chart Open Guard
  // T-20260519-foot-CHART-OPEN-GUARD: chartId/openChart/closeChart 는
  // 모든 고객(초진·재진·체험) 1·2번 차트 열림의 단일 상태 소스.
  // setChartId 직접 호출·state 분산·로직 우회 시 CHART2-REOPEN 재발 확정.
  // 회귀 방지 spec: tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts
  // ─────────────────────────────────────────────────────────────────────────────
  const [chartId, setChartId] = useState<string | null>(null);
  // LOGIC-LOCK: L-004 [CHART-LOCK-003] — openChart 단일 구현. setChartId 직접 노출 금지. 중복 구현 금지.
  const openChart = useCallback((customerId: string) => setChartId(customerId), []);
  const closeChart = useCallback(() => setChartId(null), []);
  const chartContextValue = useMemo(
    () => ({ chartId, openChart, closeChart }),
    [chartId, openChart, closeChart],
  );

  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;
    const fetchCount = async () => {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const start = `${dateStr}T00:00:00+09:00`;
      const end = `${dateStr}T23:59:59+09:00`;
      const { count } = await supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinic.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (!cancelled) setPaymentWaitingCount(count ?? 0);
    };
    fetchCount();
    // 1분마다 갱신
    const t = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [clinic]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !clinic) { setSearchResults([]); return; }
    const safe = q.trim().replace(/[%_]/g, '');
    // SEARCH-PHONE-DOB: E.164 phone 검색 정규화
    // T-20260513-foot-PHONE-E164-SEARCH fix가 InlinePatientSearch에만 적용됨.
    // 헤더 검색에서도 동일 로직 적용: leading 0 제거 → +821012345678 substring 매칭
    const digits = safe.replace(/\D/g, '');
    // E.164 phone: leading 0 제거 → +821012345678 substring 매칭 (010… → 10…)
    const digitsNoLeadingZero = digits.startsWith('0') && digits.length >= 5 ? digits.slice(1) : null;
    // DOB: YYYYMMDD(8자리) 입력 → DB 저장 YYMMDD(6자리)로 변환해 추가 매칭
    const dobYYMMDD = digits.length === 8 ? digits.slice(2) : null;
    const orParts = [
      `name.ilike.%${safe}%`,
      `phone.ilike.%${safe}%`,
      `birth_date.ilike.%${safe}%`,
      `chart_number.ilike.%${safe}%`,
    ];
    if (digitsNoLeadingZero) orParts.push(`phone.ilike.%${digitsNoLeadingZero}%`);
    if (dobYYMMDD) orParts.push(`birth_date.ilike.%${dobYYMMDD}%`);
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, birth_date, chart_number')
      .eq('clinic_id', clinic.id)
      .or(orParts.join(','))
      .limit(8);
    setSearchResults((data ?? []) as { id: string; name: string; phone: string; birth_date: string | null; chart_number: string | null }[]);
  }, [clinic]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('foot-sidebar-collapsed', String(next));
      return next;
    });
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const sidebarContent = (
    <>
      <div className="border-b px-5 py-5 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-teal-700">오블리브</div>
          <div className="mt-0.5 text-base font-bold">풋센터 종로</div>
        </div>
        <button className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center" onClick={() => setSidebarOpen(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 px-2 py-3">
        {NAV_ITEMS.filter((item) => !item.roles || (profile?.role && item.roles.includes(profile.role))).map((item) => {
          // UX-9: 결제대기 건수를 일마감(closing)/대시보드(/admin)에 뱃지 표시
          const showBadge = (item.to === '/admin' || item.to === '/admin/closing') && paymentWaitingCount > 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span
                  className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 py-0 text-[10px] font-semibold text-white min-w-[18px]"
                  title={`결제대기 ${paymentWaitingCount}건`}
                >
                  {paymentWaitingCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t px-4 py-3 text-xs">
        <div className="truncate font-medium">{profile?.name ?? profile?.email ?? '사용자'}</div>
        <div className="text-muted-foreground">{profile?.role}</div>
        {/* T-20260519-foot-STAFF-PW-CHANGE AC-1: 비밀번호 변경 — 모든 역할 노출 */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-8 w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setPwChangeOpen(true)}
        >
          <KeyRound className="h-3.5 w-3.5" />
          비밀번호 변경
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </Button>
      </div>
    </>
  );

  // LOGIC-LOCK: L-004 [CHART-LOCK-004] — ChartContext.Provider AdminLayout 단일 마운트. 중복 Provider 절대 금지.
  return (
    <ChartContext.Provider value={chartContextValue}>
    <div className="flex h-screen bg-muted/30">
      {/* Desktop sidebar — T-20260513-foot-SIDEBAR-COLLAPSE */}
      <aside
        data-testid="desktop-sidebar"
        className={cn(
          'hidden lg:flex shrink-0 flex-col border-r bg-background transition-[width] duration-200 overflow-hidden',
          sidebarCollapsed ? 'w-10' : 'w-56',
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'border-b flex items-center',
            sidebarCollapsed ? 'px-1.5 py-5 justify-center' : 'px-5 py-5 justify-between',
          )}
        >
          {!sidebarCollapsed && (
            <div>
              <div className="text-sm font-semibold text-teal-700">오블리브</div>
              <div className="mt-0.5 text-base font-bold">풋센터 종로</div>
            </div>
          )}
          <button
            data-testid="sidebar-toggle"
            className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
          >
            {sidebarCollapsed
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav */}
        {/* T-20260522-foot-TABLET-DUAL-LAYOUT: data-sidebar-nav — landscape 터치 타겟 CSS용 */}
        <nav className={cn('flex-1 py-3', sidebarCollapsed ? 'px-1' : 'px-2')} data-sidebar-nav>
          {NAV_ITEMS.filter((item) => !item.roles || (profile?.role && item.roles.includes(profile.role))).map((item) => {
            const showBadge = (item.to === '/admin' || item.to === '/admin/closing') && paymentWaitingCount > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-md text-sm font-medium transition-colors',
                    sidebarCollapsed ? 'justify-center px-1.5 py-2' : 'gap-2.5 px-3 py-2',
                    isActive
                      ? 'bg-teal-50 text-teal-700'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                <div className="relative shrink-0">
                  <item.icon className="h-4 w-4" />
                  {sidebarCollapsed && showBadge && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" />
                  )}
                </div>
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {showBadge && (
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 py-0 text-[10px] font-semibold text-white min-w-[18px]"
                        title={`결제대기 ${paymentWaitingCount}건`}
                      >
                        {paymentWaitingCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        {sidebarCollapsed ? (
          <div className="border-t py-3 flex flex-col items-center gap-1">
            {/* T-20260519-foot-STAFF-PW-CHANGE AC-1: 비밀번호 변경 아이콘 (축소 상태) */}
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={() => setPwChangeOpen(true)}
              title="비밀번호 변경"
            >
              <KeyRound className="h-4 w-4" />
            </button>
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={handleLogout}
              title="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="border-t px-4 py-3 text-xs">
            <div className="truncate font-medium">{profile?.name ?? profile?.email ?? '사용자'}</div>
            <div className="text-muted-foreground">{profile?.role}</div>
            {/* T-20260519-foot-STAFF-PW-CHANGE AC-1: 비밀번호 변경 (확장 상태) */}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-8 w-full justify-start gap-2 text-muted-foreground"
              onClick={() => setPwChangeOpen(true)}
            >
              <KeyRound className="h-3.5 w-3.5" />
              비밀번호 변경
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 text-muted-foreground"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </Button>
          </div>
        )}
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex w-56 h-full flex-col bg-background shadow-lg">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* T-20260510-foot-DASH-DUAL-HSCROLL v2: min-w-0 추가 — flex-1 아이템은 min-width:auto가 기본이라
          칸반 컨텐츠(2000px+)가 main 폭을 뷰포트 밖으로 팽창시켜 페이지 레벨 가로스크롤 발생.
          min-w-0으로 min-width:0 강제 → main이 할당 폭(viewport-sidebar) 내에 고정됨. */}
      <main className="flex h-full flex-1 flex-col min-w-0">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold">{clinic?.name ?? '풋센터 종로'}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">{today}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* T-20260517-foot-RESV-NAV-DIRECT: 전역 [예약하기] — 고객 컨텍스트 없음, 빈 예약 생성 */}
            {/* LOGIC-LOCK: L-002 — [예약하기] 클릭 시 항상 /admin/reservations full page 전환. 예외 없음. 변경 시 현장 승인 필수 */}
            <button
              onClick={() =>
                navigate('/admin/reservations', {
                  state: {
                    openReservationFor: {
                      customer_id: null,
                      name: '',
                      phone: '',
                      visit_type: 'returning' as const,
                    },
                  },
                })
              }
              className="hidden sm:flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition"
              data-testid="btn-header-make-reservation"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              예약하기
            </button>
          <div className="relative">
            <button
              onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }}
              className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">고객 검색</span>
              <kbd className="hidden sm:inline rounded border bg-background px-1.5 text-[10px]">⌘K</kbd>
            </button>
            {searchOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border bg-background shadow-lg">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (searchTimer.current) clearTimeout(searchTimer.current);
                      searchTimer.current = setTimeout(() => doSearch(e.target.value), 300);
                    }}
                    placeholder="이름 · 전화번호 · 생년월일(YYMMDD) · 차트번호"
                    className="flex-1 bg-transparent text-sm outline-none"
                    onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                  />
                  <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}>
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="max-h-64 overflow-auto p-1">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSearchOpen(false);
                          setSearchQuery('');
                          setSearchResults([]);
                          navigate(`/admin/customers?id=${c.id}`);
                        }}
                        className="w-full flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-muted transition text-left"
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {c.chart_number && <span className="rounded bg-teal-50 px-1.5 py-0 text-teal-700">{c.chart_number}</span>}
                          {c.birth_date && <span>{c.birth_date}</span>}
                          <span>{formatPhone(c.phone)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.trim() && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">검색 결과 없음</div>
                )}
              </div>
            )}
          </div>
          </div>
        </header>
        {/* T-20260509-foot-DASH-SCROLL-FIX: overflow-hidden으로 변경 — 뷰포트 고정 레이아웃.
            각 페이지가 자체 스크롤(overflow-y-auto)을 담당.
            T-20260510-foot-CALENDAR-NOTICE AC v4: 좌측 CalendarNoticePanel 고정 (우측→좌측 이동). */}
        {/* T-20260514-foot-MOBILE-CAL-COLLAPSE: 모바일에서 flex-col, PC에서 flex-row */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
          <CalendarNoticePanel />
          {/* T-20260510-foot-DASH-DUAL-HSCROLL v2: min-w-0 추가 — row-flex 내 flex-1 아이템
              min-width:auto로 Dashboard 칸반 폭만큼 팽창 → overflow-hidden이 무력화됨.
              min-w-0 추가 시 overflow-hidden이 정상 동작 → Dashboard 내용이 이 div 안에 갇힘. */}
          {/* T-20260522-foot-SPA-NAV-RELOAD: Outlet에 독립 Suspense 경계 — AdminLayout unmount 방지 */}
          <div data-testid="page-content-area" className="flex-1 min-w-0 min-h-0 overflow-hidden">
            <ChunkErrorBoundary>
              <Suspense fallback={<OutletPageLoader />}>
                <Outlet />
              </Suspense>
            </ChunkErrorBoundary>
          </div>
        </div>
      </main>
    </div>
    {/* T-20260516-foot-CHART2-STATE-UNIFY AC-2: 단일 렌더 (4곳 중복 제거) — createPortal로 document.body에 마운트 */}
    {/* CRITICAL: DO NOT MODIFY — Chart Open Guard
        T-20260519-foot-CHART-OPEN-GUARD: CustomerChartSheet는 이 1곳에서만 렌더.
        다른 위치에 중복 렌더 추가 금지. customerId/onClose 대체 구현 금지.
        회귀 방지 spec: tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts */}
    {/* LOGIC-LOCK: L-004 [CHART-LOCK-005] — CustomerChartSheet 이 1곳 단일 렌더. 중복 렌더 추가 금지. */}
    <CustomerChartSheet customerId={chartId} onClose={closeChart} />
    {/* T-20260519-foot-STAFF-PW-CHANGE: 비밀번호 변경 다이얼로그 */}
    <ChangePasswordDialog open={pwChangeOpen} onOpenChange={setPwChangeOpen} />
    </ChartContext.Provider>
  );
}
