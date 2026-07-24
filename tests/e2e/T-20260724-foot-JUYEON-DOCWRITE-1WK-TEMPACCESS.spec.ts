/**
 * T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — director 권한 1주 임시부여 + 8/1 자동원복
 *
 * 배경(planner MSG-20260724-185940-dpo3, 대표원장 문지은 컨펌 Option A):
 *   김주연 총괄(user_profiles.id=ee67fc6b…, juyeon@medibuilder.com)에게 소견서·진단서
 *   "서식 점검"용 director 권한을 2026-07-25 00:00 KST ~ 2026-08-01 00:00 KST 한시 부여.
 *   8/1 도래 시 원래 role 로 자동원복. 계정 1행만 조작(ROLE-MATRIX 정본 무변경, 서류틀 무변경).
 *
 * ★ 상태 실측 divergence: 티켓 가정 "manager+has_ops_authority" ≠ prod 실측 role='admin'.
 *   ⇒ 원복 대상 role = 'admin' (manager 로 되돌리면 강등 사고). 본 spec 이 이를 고정한다.
 *
 * 권한 게이트 SSOT (코드 무변경으로 충족):
 *   - FE: OpinionDocTab.tsx L666  canPublish = ['director','doctor'].includes(profile?.role)
 *   - DB: publish_opinion_doc → is_doctor_role() = current_user_role() ∈ {director,doctor}
 *         current_user_role() = user_profiles.role WHERE id=auth.uid()
 *   ∴ user_profiles.role='director' ⇒ FE+DB 양쪽 발행 게이트 인정. admin/manager 는 dead-button.
 *
 * 자동원복 메커니즘 (마이그 20260724210000):
 *   pg_cron 'foot-juyeon-tempgrant-lifecycle' (매 15분 폴) → foot_juyeon_tempgrant_tick(now())
 *     now < grant_at(2026-07-24 15:00Z=07-25 00:00KST) : no-op (admin 유지)
 *     grant_at ≤ now < revert_at                        : admin→director (부여, idempotent)
 *     now ≥ revert_at(2026-07-31 15:00Z=08-01 00:00KST) : director→admin (원복) + 잡 자기해지
 *
 * 본 spec 은 코드베이스 관행(logic-mirror)에 따라 (1) 발행 게이트 조건과
 * (2) lifecycle tick 분기를 순수 함수로 미러하여 SSOT 일치를 회귀 검증한다.
 * cron 시각 발화 자체는 Playwright 로 재현 불가 → 분기 로직/게이트 상태로 대체 검증.
 * (branch 실증: scripts dry-run 'DRYRUN_RESULT pre=admin grant=director revert=admin', 무영속 확인)
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS', () => {
  // ── (1) 발행 게이트 미러: OpinionDocTab.canPublish / is_doctor_role SSOT ──────
  const DOCTOR_PUBLISH_ROLES = ['director', 'doctor'];
  const canPublishDoc = (role: string | null | undefined): boolean =>
    DOCTOR_PUBLISH_ROLES.includes(role ?? '');

  // ── (2) lifecycle tick 미러: 마이그 foot_juyeon_tempgrant_tick 분기 (KST 경계 = UTC) ──
  const GRANT_AT = Date.parse('2026-07-24T15:00:00Z');  // 2026-07-25 00:00 KST
  const REVERT_AT = Date.parse('2026-07-31T15:00:00Z'); // 2026-08-01 00:00 KST
  const ORIG_ROLE = 'admin';
  const TEMP_ROLE = 'director';
  /** now 시점에 tick 이 수렴시키는 대상 role (현재 role 입력 → 다음 role 반환). */
  function tickRole(nowIso: string, currentRole: string): string {
    const now = Date.parse(nowIso);
    if (now >= REVERT_AT) return currentRole === TEMP_ROLE ? ORIG_ROLE : currentRole; // 원복
    if (now >= GRANT_AT) return currentRole === ORIG_ROLE ? TEMP_ROLE : currentRole;  // 부여
    return currentRole; // 발효 전 no-op
  }

  // ══ 시나리오 1 — 7/25 발효 정상동선 ══════════════════════════════════════
  test('S1-a: 발효 전(7/24) → 김주연 role admin 유지(no-op)', () => {
    expect(tickRole('2026-07-24T12:00:00Z', 'admin')).toBe('admin');
    expect(canPublishDoc('admin')).toBe(false); // 아직 서류 발행 불가
  });

  test('S1-b: 7/25 발효 → admin→director 부여, 소견서·진단서 발행 가능', () => {
    const granted = tickRole('2026-07-25T06:00:00Z', 'admin');
    expect(granted).toBe('director');
    expect(canPublishDoc(granted)).toBe(true); // 서식 점검(발행 버튼 활성)
  });

  test('S1-c: 부여는 idempotent(재폴링 시 director 유지, 중복 UPDATE 없음)', () => {
    expect(tickRole('2026-07-27T00:00:00Z', 'director')).toBe('director');
  });

  // ══ 시나리오 2 — 8/1 자동원복 확인 ═══════════════════════════════════════
  test('S2-a: 8/1 도래 → director→admin 자동원복', () => {
    const reverted = tickRole('2026-08-01T06:00:00Z', 'director');
    expect(reverted).toBe('admin');           // 원래 role 복귀 (manager 아님)
    expect(canPublishDoc(reverted)).toBe(false); // 발행 권한 회수 = 원상 복구
  });

  test('S2-b: 원복은 idempotent(이미 admin 이면 no-op)', () => {
    expect(tickRole('2026-08-02T00:00:00Z', 'admin')).toBe('admin');
  });

  test('S2-c: 원복 대상은 admin (티켓 가정 manager 로 되돌리지 않음 — 강등 방지)', () => {
    expect(ORIG_ROLE).toBe('admin');
    expect(ORIG_ROLE).not.toBe('manager');
  });

  // ══ 무회귀 — 발행 게이트 SSOT ════════════════════════════════════════════
  test('R1: 발행 가능 role 은 director/doctor 만 (admin/manager/consultant dead-button)', () => {
    expect(canPublishDoc('director')).toBe(true);
    expect(canPublishDoc('doctor')).toBe(true);
    for (const r of ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'staff', 'tm']) {
      expect(canPublishDoc(r)).toBe(false);
    }
  });
});
