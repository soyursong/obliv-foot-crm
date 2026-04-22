import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, session, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (profile && !profile.approved && profile.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm space-y-3 text-center">
          <h2 className="text-lg font-semibold">승인 대기 중</h2>
          <p className="text-sm text-muted-foreground">
            관리자 승인 후 이용하실 수 있습니다.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RoleGuard({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}
