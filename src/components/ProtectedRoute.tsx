import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { hasOpsAuthority } from '@/lib/permissions';
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

export function RoleGuard({
  roles,
  requireOpsAuthority,
  children,
}: {
  roles: UserRole[];
  // T-20260619-foot-ROLE-MATRIX-3TIER-RBAC: 운영최고권한 라우트(계정·통계·매출). nav requiresOpsAuthority 와 패리티 SSOT.
  //   director(임상)는 has_ops_authority=true 일 때만 통과(봉직의 배제). admin/manager 등은 roles 로 통과(role-implied).
  //   ★lock-out-safe: 현 운영자 admin·prod director=0 → 현 영향 0. 메뉴 숨김 ↔ 라우트 가드 동일 규칙(NAV-BOUNCE 차단).★
  requireOpsAuthority?: boolean;
  children: React.ReactNode;
}) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) {
    return <Navigate to="/admin" replace />;
  }
  if (requireOpsAuthority && profile.role === 'director' && !hasOpsAuthority(profile)) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}
