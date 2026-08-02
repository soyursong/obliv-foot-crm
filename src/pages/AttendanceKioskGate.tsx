/**
 * AttendanceKioskGate — 키오스크 라우트 접근 분기 (키오스크 전용 링크)
 * T-20260802-foot-ATTENDANCE-QR-PORT.
 *
 * 경로: /attendance/kiosk/:slug
 *
 * 분기:
 *   - URL 에 ?k=<kiosk_token> 있으면  → 로그인 불요 → AttendanceKiosk 직접 렌더.
 *   - k 없으면                        → 관리자 로그인 요구(ProtectedRoute + RoleGuard admin/manager/director).
 *
 * ⚠ 보안 모델: FE 는 k 의 '존재 여부'로만 분기(토큰 유효성은 FE 검증 불가).
 *   토큰의 진짜 검증은 EF(attendance-otp action=qr_token)에서 per-clinic Vault 시크릿
 *   attendance_kiosk_token_<slug> 와 상수시간 대조로 강제한다. 키오스크는 QR 표시 전용(PII 0)이라
 *   무효 k 로 우회해도 QR 미발급(EF 401)으로 안전 — 대리출근으로 이어지지 않는다.
 */
import { useSearchParams } from 'react-router-dom';
import { ProtectedRoute, RoleGuard } from '@/components/ProtectedRoute';
import AttendanceKiosk from './AttendanceKiosk';

export default function AttendanceKioskGate() {
  const [sp] = useSearchParams();
  const hasKioskToken = !!(sp.get('k') ?? '').trim();

  if (hasKioskToken) {
    // 전용 링크 모드 — 로그인 불요. (EF 가 토큰을 Vault 로 최종검증)
    return <AttendanceKiosk />;
  }

  // 기본 모드 — 관리자 로그인 필수.
  return (
    <ProtectedRoute>
      <RoleGuard roles={['admin', 'manager', 'director']}>
        <AttendanceKiosk />
      </RoleGuard>
    </ProtectedRoute>
  );
}
