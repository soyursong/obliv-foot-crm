import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/types';

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
  { to: '/admin/packages', label: '패키지', icon: Package, roles: ['admin', 'manager', 'consultant', 'coordinator'] },
  { to: '/admin/staff', label: '직원·공간', icon: UserCog, roles: ['admin', 'manager'] },
  { to: '/admin/closing', label: '일마감', icon: Receipt, roles: ['admin', 'manager'] },
  { to: '/admin/history', label: '일일 이력', icon: ClipboardList },
  { to: '/admin/stats', label: '통계', icon: BarChart3, roles: ['admin', 'manager', 'part_lead'] },
  { to: '/admin/services', label: '서비스관리', icon: Stethoscope, roles: ['admin', 'manager'] },
  { to: '/admin/doctor-tools', label: '진료 도구', icon: BookOpen, roles: ['admin', 'manager'] },
  { to: '/admin/accounts', label: '계정관리', icon: ShieldCheck, roles: ['admin'] },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const clinic = useClinic();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; phone: string; birth_date: string | null; chart_number: string | null }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // UX-9: 사이드바 알림 뱃지 — 오늘 결제대기 건수
  const [paymentWaitingCount, setPaymentWaitingCount] = useState<number>(0);

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
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, birth_date, chart_number')
      .eq('clinic_id', clinic.id)
      .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,birth_date.ilike.%${safe}%,chart_number.ilike.%${safe}%`)
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
        <button className="lg:hidden p-2 min-h-[36px] min-w-[36px] flex items-center justify-center" onClick={() => setSidebarOpen(false)}>
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
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-8 w-full justify-start gap-2 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r bg-background">
        {sidebarContent}
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

      <main className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 min-h-[36px] min-w-[36px] flex items-center justify-center" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold">{clinic?.name ?? '풋센터 종로'}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">{today}</span>
          </div>
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
                          <span>{c.phone}</span>
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
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
