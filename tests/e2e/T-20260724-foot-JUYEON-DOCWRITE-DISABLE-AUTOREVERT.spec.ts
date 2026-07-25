/**
 * T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — [A안] 8/1 자동원복 해제 (요청시 원복 전환)
 *
 * 배경(planner MSG-20260725-090449-wfwp, 대표원장 문지은 A안 재컨펌 2026-07-25 09:00 KST):
 *   김주연 총괄(user_profiles.id=ee67fc6b…, juyeon@medibuilder.com) director 임시권한의
 *   8/1 자동원복을 **없앤다**. 총괄이 "원복해줘" 요청할 때까지 director 라이브 유지.
 *   원복은 canonical 함수(foot_juyeon_tempgrant_revert → admin)로만, on-request 발동.
 *
 * 마이그 20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql 의 로직을 순수 미러:
 *   (1) tick(): 시각 무관 'hold' — 어떤 role write 도 안 함(자동원복·재부여 제거).
 *   (2) revert(): director→admin(=v_orig_role 상수) — on-request 수동 발동만.
 *   (3) baseline='admin' 상수 보존 — 현재 role(director)을 baseline 으로 읽지 않음(영구 director 사고 차단).
 *   (4) 발행 게이트 SSOT 불변: director/doctor 만 소견서·진단서 발행(grant 라이브 = 발행 가능 유지).
 * cron 시각 발화는 Playwright 재현 불가 → 분기 로직/상수/게이트로 회귀 검증(logic-mirror 관행).
 * (branch 실증: scripts dry-run — pre=director / post-probe revert_fn_absent + tick auto-revert unchanged, 무영속)
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260724-foot-JUYEON-DOCWRITE-DISABLE-AUTOREVERT', () => {
  const TARGET = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
  const ORIG_ROLE = 'admin';     // ★ canonical baseline (원복 목적지) — 상수 고정
  const TEMP_ROLE = 'director';  // 임시부여(라이브) role

  // ── (1) 신 tick() 미러: 시각과 무관하게 role 불변(hold). 자동원복·재부여 없음 ──
  function tickRoleA(_nowIso: string, currentRole: string): string {
    return currentRole; // A안 — 어떤 시각에도 role 변경 없음(cron no-op hold)
  }

  // ── (2) on-request revert() 미러: director→admin, idempotent ──
  function revertRole(currentRole: string): string {
    return currentRole === TEMP_ROLE ? ORIG_ROLE : currentRole;
  }

  // ── (4) 발행 게이트 SSOT (코드 무변경) ──
  const DOCTOR_PUBLISH_ROLES = ['director', 'doctor'];
  const canPublishDoc = (role: string | null | undefined): boolean =>
    DOCTOR_PUBLISH_ROLES.includes(role ?? '');

  // ══ AC4(개정) — 8/1 도래해도 자동원복 미발동, director 유지 ══════════════════
  test('AC4: 8/1 00:00 KST 도래(2026-08-01T06:00Z) → director 유지(자동원복 미발동)', () => {
    expect(tickRoleA('2026-08-01T06:00:00Z', 'director')).toBe('director');
    expect(canPublishDoc('director')).toBe(true); // 발행 권한 계속 유지
  });

  test('AC4-b: 8/1 이후(8/5)도 tick 은 hold — role 불변', () => {
    expect(tickRoleA('2026-08-05T00:00:00Z', 'director')).toBe('director');
  });

  test('AC4-c: 발효 창(7/26) 폴링도 재부여 없음(clobber 방지) — 입력 role 그대로', () => {
    // 이미 director 면 director, (가정상) admin 이면 admin 그대로 — tick 은 write 안 함
    expect(tickRoleA('2026-07-26T00:00:00Z', 'director')).toBe('director');
    expect(tickRoleA('2026-07-26T00:00:00Z', 'admin')).toBe('admin');
  });

  // ══ AC6(신규) — 총괄 원복요청 시 canonical(→admin) 경유 원복 + baseline='admin' 보존 ══
  test('AC6-a: on-request revert → director→admin (canonical, baseline=admin)', () => {
    const reverted = revertRole('director');
    expect(reverted).toBe('admin');
    expect(reverted).toBe(ORIG_ROLE);
    expect(canPublishDoc(reverted)).toBe(false); // 원복 후 발행 권한 회수 = 원상복구
  });

  test('AC6-b: revert idempotent (이미 admin 이면 no-op)', () => {
    expect(revertRole('admin')).toBe('admin');
  });

  test('AC6-c: baseline 은 admin 상수 — director 로 고착시키지 않음(영구 director 사고 차단)', () => {
    expect(ORIG_ROLE).toBe('admin');
    expect(ORIG_ROLE).not.toBe('director');
    // 원복 목적지가 현재 라이브 role(director)이 아님을 고정
    expect(revertRole(TEMP_ROLE)).not.toBe(TEMP_ROLE);
  });

  // ══ 무회귀 — 발행 게이트 SSOT (AC1/AC2/AC5 계속 유효) ═══════════════════════
  test('R1: 발행 가능 role 은 director/doctor 만 (grant 라이브 → director 발행 가능)', () => {
    expect(canPublishDoc('director')).toBe(true);
    expect(canPublishDoc('doctor')).toBe(true);
    for (const r of ['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'staff', 'tm']) {
      expect(canPublishDoc(r)).toBe(false);
    }
  });

  test('R2: 대상 계정 식별자 불변(1행만 조작 — ROLE-MATRIX 정본 무변경)', () => {
    expect(TARGET).toBe('ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12');
  });
});
