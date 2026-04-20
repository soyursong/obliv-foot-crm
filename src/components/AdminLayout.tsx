import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Package,
  UserCog,
  Receipt,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getClinic } from '@/lib/clinic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Clinic } from '@/lib/types';

const NAV_ITEMS = [
  { to: '/admin', label: '대시보드', icon: LayoutDashboard, end: true },
  { to: '/admin/reservations', label: '예약관리', icon: CalendarDays },
  { to: '/admin/customers', label: '고객관리', icon: Users },
  { to: '/admin/packages', label: '패키지', icon: Package },
  { to: '/admin/staff', label: '직원·공간', icon: UserCog },
  { to: '/admin/closing', label: '일마감', icon: Receipt },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
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
        {NAV_ITEMS.map((item) => (
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
            {item.label}
          </NavLink>
        ))}
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
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
