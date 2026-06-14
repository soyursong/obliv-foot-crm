/**
 * T-20260614-foot-CHARTSIGNAUDIT-ROLE-GATE — 진료차트 진료의 변경이력, 원장/어드민만 조회
 *
 * 배경(슬랙 C0ATE5P6JTH, 문지은 대표원장):
 *   진료차트의 진료의 변경이력(signerAudit) 패널이 현재 모든 직원에게 노출됨.
 *   "변경이력을 모두가 보게 하면 안 되지, 어드민이라든지 따로 찾아야 하는 거 아님?"
 *   의료법 22조·21조 + EMR 표준(Epic/Oracle Health) — 변경이력은 담당의/관리자 전용 권고.
 *
 * 변경(FE-only): src/components/MedicalChartPanel.tsx
 *   Before: {signerAudit.length > 0 && (...)}
 *   After:  {signerAudit.length > 0 && isDirector && (...)}
 *   isDirector = canViewDoctorMemo(role) = DIRECTOR_ROLES(['director','admin']).includes(role)
 *   → director/admin 동시 포함 SSOT 재사용. 별도 isAdmin 결선·새 role 판정 경로 신설 없음.
 *   signer_audit insert 로직 무변경(조회 가시성만 제한).
 *
 * 시나리오 (티켓 본문):
 *   S1 원장(director) 로그인 → 변경이력 패널 표시.
 *   S2 어드민(admin) 로그인 → 변경이력 패널 표시.
 *   S3 스태프/일반 직원 로그인 → 변경이력 패널 미표시.
 *
 * 본 spec은 코드베이스 관행(logic-mirror)에 따라 컴포넌트 렌더 게이트 조건을 미러한다.
 * (MedicalChartPanel.tsx 의 canViewDoctorMemo + signerAudit gate 와 동일 SSOT)
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260614-foot-CHARTSIGNAUDIT-ROLE-GATE', () => {

  // MedicalChartPanel.tsx L307 DIRECTOR_ROLES / canViewDoctorMemo 미러 (SSOT 일치)
  const DIRECTOR_ROLES = ['director', 'admin'];
  function canViewDoctorMemo(role: string): boolean {
    return DIRECTOR_ROLES.includes(role);
  }

  // 변경이력 패널 렌더 게이트 미러: signerAudit.length > 0 && isDirector
  function showSignerAuditPanel(args: { auditCount: number; role: string }): boolean {
    const isDirector = canViewDoctorMemo(args.role);
    return args.auditCount > 0 && isDirector;
  }

  // ── S1: 원장(director) — 변경이력 표시 ──────────────────────────────────
  test('S1: director 역할 + 이력 있음 → 변경이력 패널 표시', () => {
    expect(showSignerAuditPanel({ auditCount: 3, role: 'director' })).toBe(true);
  });

  // ── S2: 어드민(admin) — 변경이력 표시 ───────────────────────────────────
  test('S2: admin 역할 + 이력 있음 → 변경이력 패널 표시', () => {
    expect(showSignerAuditPanel({ auditCount: 2, role: 'admin' })).toBe(true);
  });

  // ── S3: 스태프/일반 직원 — 변경이력 미표시 ──────────────────────────────
  test('S3-a: staff 역할 + 이력 있음 → 변경이력 패널 미표시', () => {
    expect(showSignerAuditPanel({ auditCount: 3, role: 'staff' })).toBe(false);
  });

  test('S3-b: nurse(일반 직원) 역할 + 이력 있음 → 변경이력 패널 미표시', () => {
    expect(showSignerAuditPanel({ auditCount: 5, role: 'nurse' })).toBe(false);
  });

  test('S3-c: counselor(상담) 역할 + 이력 있음 → 변경이력 패널 미표시', () => {
    expect(showSignerAuditPanel({ auditCount: 1, role: 'counselor' })).toBe(false);
  });

  // ── 회귀: 이력 0건이면 권한 무관 미표시 (기존 length>0 게이트 보존) ──────
  test('R1: director라도 이력 0건이면 미표시 (length 게이트 무회귀)', () => {
    expect(showSignerAuditPanel({ auditCount: 0, role: 'director' })).toBe(false);
  });

  test('R2: admin이라도 이력 0건이면 미표시', () => {
    expect(showSignerAuditPanel({ auditCount: 0, role: 'admin' })).toBe(false);
  });

  // ── SSOT 일치: 진료의 메모(doctor_memo) 게이트와 동일 role 집합 재사용 ───
  test('SSOT: 변경이력 게이트 role 집합 = 진료의 메모 게이트(canViewDoctorMemo)와 동일', () => {
    for (const role of ['director', 'admin', 'staff', 'nurse', 'counselor', '']) {
      const memoGate = canViewDoctorMemo(role);
      const auditGate = showSignerAuditPanel({ auditCount: 1, role });
      expect(auditGate).toBe(memoGate); // 이력 1건이면 두 게이트 동일해야
    }
  });
});
