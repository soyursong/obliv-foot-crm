/**
 * T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK
 * 상용구관리 > 상용구(펜차트)·상용구(고객차트) 직원 편집권 개방 (AC-2 FE + AC-3 RLS).
 *
 * 요청 (김주연 총괄 U0ATDB587PV, #풋센터 C0ATE5P6JTH):
 *   "상용구(펜차트)·상용구(고객차트)·수가세트 직원 계정에서 추가·수정 막힘. 직원들이 메인으로 쓰는 곳."
 *   - 수가세트(AC-1) = PHRASE-STAFF-PERM-BLOCKED Phase 1 旣배포(canEditStaffArea, fee_set_templates auth_all).
 *   - 펜/고객차트(AC-2 FE + AC-3 RLS) = 본 트랙. phrase_templates RLS write 확대 동반(DA CONSULT GO).
 *
 * DA CONSULT-REPLY (MSG-20260620-114351-dnok / 08in, GO · ADDITIVE-safe):
 *   2-policy permissive ADDITIVE — 기존 admin_write_phrase_templates({admin,manager}, 모든 type) 무변경 +
 *   신규 staff_write_staffarea_phrases({consultant,coordinator,therapist,part_lead,staff}, pen/customer 가드) ADD.
 *   → effective write union = FE PHRASE_STAFFAREA_EDIT_ROLES(= ALL_STAFF_ROLES − director, 7역할).
 *   medical_chart write = {admin,manager} 불변(의사영역 보호). director 제외(AC-4 human_pending).
 *
 * role 실측(2026-06-20, user_profiles active): consultant4·coordinator7·therapist10·staff2 사용중,
 *   part_lead0(enum 유효·future-proof). enum 밖 직원 role 0 → lock-out 없음.
 *
 * 본 spec 은 permissions.ts 헬퍼(FE 게이트) + RLS 정책 §A 가드(USING/WITH CHECK phrase_type)를 검증.
 * RLS 침투테스트 3종 라이브 실행은 supervisor DDL-diff 단계(staff 토큰) — 여기선 마이그 파일 정합 검증.
 *
 * 실행: npx playwright test T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canEditStaffAreaPhrase,
  PHRASE_STAFFAREA_EDIT_ROLES,
} from '../../src/lib/permissions';

// process.cwd() = 레포 루트(playwright 실행 기준). ESM 환경이라 __dirname 미정의.
const MIG_DIR = join(process.cwd(), 'supabase/migrations');

// 본 티켓이 직원 편집을 여는 펜/고객차트 surface 의 대상 직원 role(director 제외).
const PHRASE_STAFF_ROLES = ['consultant', 'coordinator', 'therapist', 'part_lead', 'staff'] as const;

test.describe('T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK — 상용구(펜/고객차트) 직원 편집 개방', () => {
  // ── 시나리오 2·3: 직원 — 펜/고객차트 상용구 편집 가능 (AC-2 FE) ─────────────
  test('시나리오2·3: 운영 직원(consultant/coordinator/therapist/part_lead/staff) → 펜/고객차트 상용구 편집 O', () => {
    for (const role of PHRASE_STAFF_ROLES) {
      expect(canEditStaffAreaPhrase(role), `${role} 은 펜/고객차트 상용구 편집 가능해야 함`).toBe(true);
    }
  });

  // ── AC-4 lock-out-safe: admin/manager 무회귀 (편집권 제거 안 됨) ─────────────
  test('AC-4: admin/manager → 펜/고객차트 상용구 편집 여전히 O (확대만, 제거 X · lock-out 0)', () => {
    expect(canEditStaffAreaPhrase('admin')).toBe(true);
    expect(canEditStaffAreaPhrase('manager')).toBe(true);
  });

  // ── director 제외 (현행 유지 — PHRASE-AREA-SEPARATION-AUDIT AC-4 human_pending 선점 금지) ──
  test('director(의사) → 펜/고객차트 상용구 편집 X (현행 유지, AC-4 사람결정 선점 금지)', () => {
    expect(canEditStaffAreaPhrase('director')).toBe(false);
  });

  // tm = 최소권한(STAFF-ROLE-TM-ADD) → 직원영역 상용구 편집 미포함
  test('tm → 펜/고객차트 상용구 편집 X (4메뉴 최소권한)', () => {
    expect(canEditStaffAreaPhrase('tm')).toBe(false);
  });

  // null/undefined 방어
  test('빈 role(null/undefined) → 편집 X (안전 기본값)', () => {
    expect(canEditStaffAreaPhrase(null)).toBe(false);
    expect(canEditStaffAreaPhrase(undefined)).toBe(false);
  });

  // ── role-set 1지점 SSOT: PHRASE_STAFFAREA_EDIT_ROLES = ALL_STAFF_ROLES − director (7역할) ──
  test('role-set 1지점: PHRASE_STAFFAREA_EDIT_ROLES = 7역할(director·tm 제외)', () => {
    expect(PHRASE_STAFFAREA_EDIT_ROLES).toEqual(
      expect.arrayContaining(['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff']),
    );
    expect(PHRASE_STAFFAREA_EDIT_ROLES).toHaveLength(7);
    expect(PHRASE_STAFFAREA_EDIT_ROLES).not.toContain('director');
    expect(PHRASE_STAFFAREA_EDIT_ROLES).not.toContain('tm');
  });

  // ── AC-3 RLS 마이그 §A 정합 (라이브 침투테스트는 supervisor DDL-diff 단계) ──────
  test('AC-3 §A: 신규 RLS 정책 USING·WITH CHECK 둘 다 phrase_type 가드 보유 (의사영역 hole 차단)', () => {
    const mig = readFileSync(
      join(MIG_DIR, '20260620120000_phrase_templates_staff_write_staffarea.sql'),
      'utf-8',
    );
    // A-1: USING 과 WITH CHECK 양쪽에 phrase_type IN ('pen_chart','customer_chart') 가드.
    const guardCount = (mig.match(/phrase_type IN \('pen_chart', 'customer_chart'\)/g) || []).length;
    expect(guardCount, 'USING+WITH CHECK 양쪽 phrase_type 가드 = 2회').toBe(2);
    // WITH CHECK 절 존재(phrase_type 변조 hole 차단)
    expect(mig).toContain('WITH CHECK');
    // 신규 정책 role set = 5직원 role (admin/manager 미포함 = 기존 정책 커버)
    expect(mig).toContain("'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'");
    // A-2: 기존 admin_write 정책에 대한 ALTER/DROP/CREATE 실행문 부재(주석 언급은 허용 — ADD only).
    expect(mig).not.toMatch(/(DROP|ALTER|CREATE)\s+POLICY[^;]*admin_write_phrase_templates/i);
    // medical_chart 가 staff 정책 가드(IN 절)에 미포함(의사영역 미터치). 주석 언급은 허용.
    expect(mig).not.toMatch(/IN \([^)]*'medical_chart'/);
  });

  test('AC-3 롤백: 신규 정책만 DROP (기존 admin_write 복원 불요)', () => {
    const rb = readFileSync(
      join(MIG_DIR, '20260620120000_phrase_templates_staff_write_staffarea.rollback.sql'),
      'utf-8',
    );
    expect(rb).toContain('DROP POLICY IF EXISTS "staff_write_staffarea_phrases"');
    // 기존 admin_write 정책에 대한 실행문(DROP/ALTER/CREATE) 부재(주석 언급은 허용)
    expect(rb).not.toMatch(/(DROP|ALTER|CREATE)\s+POLICY[^;]*admin_write_phrase_templates/i);
  });
});
