/**
 * T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS
 * 상용구관리 > 상용구(펜차트)·상용구(고객차트) coordinator write 개방 (RLS ADDITIVE).
 *
 * 요청 (김주연 총괄 U0ATDB587PV, coordinator 계정 기준, #풋센터 C0ATE5P6JTH):
 *   서비스항목 > 상용구관리 의 펜차트·고객차트 상용구 저장이 coordinator 에서 막힘.
 *   FE(canEditStaffAreaPhrase)는 coordinator 포함(열림)이나 phrase_templates RLS write 가
 *   PROD 실측 {admin,manager,director} 한정 → coordinator INSERT/UPDATE/DELETE RLS 거부(미스매치).
 *
 * PROD 실측(2026-06-30 pg_policies, dev-foot 직접 확인):
 *   · admin_write_phrase_templates [ALL] {admin,manager,director} (모든 type; 20260624180000 이 director 추가)
 *   · staff_read_phrase_templates  [SELECT] USING(true)
 *   ※ staff_write_staffarea_phrases(20260620) 는 PROD 미존재(DRIFT) → 본 티켓은 coordinator 만 ADDITIVE 추가.
 *
 * 패턴 = STAFFPHRASE-EDIT-UNLOCK AC-3 DA CONSULT(08in, GO_WARN) 2-policy permissive ADDITIVE 재사용.
 *   신규 coordinator_write_staffarea_phrases (coordinator, pen/customer 가드) ADD only.
 *   medical_chart write = coordinator 무부여(§11.1 의사영역, OPINIONPHRASE-EDIT-DIRECTOR-ONLY 무회귀).
 *
 * 본 spec = permissions.ts 헬퍼(FE 게이트) + RLS 정책 §A 가드(USING/WITH CHECK phrase_type) 파일 정합 검증.
 *   coordinator 토큰 라이브 침투테스트 3종은 supervisor DDL-diff 단계(apply 후) 실행.
 *
 * 실행: npx playwright test T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canEditStaffAreaPhrase } from '../../src/lib/permissions';

// process.cwd() = 레포 루트(playwright 실행 기준). ESM 환경이라 __dirname 미정의.
const MIG_DIR = join(process.cwd(), 'supabase/migrations');
const MIG = '20260701030000_phrase_templates_coordinator_write_staffarea.sql';
const ROLLBACK = '20260701030000_phrase_templates_coordinator_write_staffarea.rollback.sql';

test.describe('T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS — 상용구(펜/고객차트) coordinator write 개방', () => {
  // ── 시나리오 1: coordinator — 펜/고객차트 상용구 편집 가능 (FE 게이트 旣 열림) ──
  test('시나리오1: coordinator → 펜/고객차트 상용구 편집 O (FE 게이트, RLS 가 서버측 정합)', () => {
    expect(canEditStaffAreaPhrase('coordinator'), 'coordinator 는 펜/고객차트 상용구 편집 가능해야 함').toBe(true);
  });

  // ── 시나리오 3: 상위 역할 무회귀 (admin/manager/director) ────────────────────
  test('시나리오3: admin/manager → 편집 O (확대만, 제거 X · 회귀 0)', () => {
    expect(canEditStaffAreaPhrase('admin')).toBe(true);
    expect(canEditStaffAreaPhrase('manager')).toBe(true);
  });

  // ── 시나리오 2(음성 가드): director 는 상용구관리 탭 FE 게이트 미포함(현행 유지) ──
  //   (director write 자체는 admin_write RLS 로 서버측 허용되나, 상용구관리 탭 FE 노출 정책은 director 제외 유지.)
  test('director → 상용구관리 탭 FE 편집 게이트 X (현행 유지, AC-4 선점 금지)', () => {
    expect(canEditStaffAreaPhrase('director')).toBe(false);
  });

  // null/undefined 방어
  test('빈 role(null/undefined) → 편집 X (안전 기본값)', () => {
    expect(canEditStaffAreaPhrase(null)).toBe(false);
    expect(canEditStaffAreaPhrase(undefined)).toBe(false);
  });

  // ── AC1·AC2 §A: 신규 RLS 정책 = coordinator + USING·WITH CHECK 둘 다 phrase_type 가드 ──
  test('AC1·AC2 §A: coordinator 정책 USING·WITH CHECK 둘 다 phrase_type 가드 (의사영역 hole 차단)', () => {
    const mig = readFileSync(join(MIG_DIR, MIG), 'utf-8');
    // A-1: USING 과 WITH CHECK 양쪽에 phrase_type IN ('pen_chart','customer_chart') 가드 = 2회.
    const guardCount = (mig.match(/phrase_type IN \('pen_chart', 'customer_chart'\)/g) || []).length;
    expect(guardCount, 'USING+WITH CHECK 양쪽 phrase_type 가드 = 2회').toBe(2);
    // WITH CHECK 절 존재(phrase_type 변조 hole 차단)
    expect(mig).toContain('WITH CHECK');
    // 신규 정책 role = coordinator 단일 (요청 scope). USING/WITH CHECK 각 1회 = 2회.
    const roleCount = (mig.match(/user_profiles\.role = 'coordinator'/g) || []).length;
    expect(roleCount, 'coordinator role 매칭 = USING+WITH CHECK 2회').toBe(2);
    // 정책명 = coordinator_write_staffarea_phrases (STAFFPHRASE staff 정책과 별개 → 이중정책 회피)
    expect(mig).toContain('coordinator_write_staffarea_phrases');
    // A-2: 기존 admin_write 정책에 대한 실행문(DROP/ALTER/CREATE) 부재(주석 언급은 허용 — ADD only).
    expect(mig).not.toMatch(/(DROP|ALTER|CREATE)\s+POLICY[^;]*admin_write_phrase_templates/i);
    // AC2: medical_chart 가 coordinator 정책 가드(IN 절)에 미포함(의사영역 미터치). 주석 언급은 허용.
    expect(mig).not.toMatch(/IN \([^)]*'medical_chart'/);
    // AC5: 미대상 직원 role(consultant/therapist/part_lead/staff) write 신설 없음(coordinator 단일).
    for (const role of ['consultant', 'therapist', 'part_lead', 'staff']) {
      expect(mig).not.toMatch(new RegExp(`role = '${role}'`));
    }
  });

  // ── AC4 롤백: 신규 정책만 DROP (기존 admin_write 복원 불요) ────────────────────
  test('AC4 롤백: coordinator 정책만 DROP (기존 admin_write 복원 불요)', () => {
    const rb = readFileSync(join(MIG_DIR, ROLLBACK), 'utf-8');
    expect(rb).toContain('DROP POLICY IF EXISTS "coordinator_write_staffarea_phrases"');
    // 기존 admin_write 정책에 대한 실행문(DROP/ALTER/CREATE) 부재(주석 언급은 허용)
    expect(rb).not.toMatch(/(DROP|ALTER|CREATE)\s+POLICY[^;]*admin_write_phrase_templates/i);
  });
});
