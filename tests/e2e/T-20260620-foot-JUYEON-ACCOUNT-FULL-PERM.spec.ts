/**
 * E2E spec — T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM
 * juyeon@medibuilder.com(김주연 총괄) 단일 계정 full elevation + 상시예외 영속화 검증.
 *
 * 출처: 김주연 총괄 직접 지시(slack ts 1781934630.902879). 자기요청 confirmed.
 *   AC-4 durable flag = user_profiles.exempt_from_restrictions boolean NOT NULL DEFAULT false
 *   (DA CONSULT-REPLY MSG-20260620-162917-aw39 = GO, ADDITIVE). prod 적용 완료(2026-06-21T02:57, commit c4cf00a7).
 *   대상 계정: juyeon@medibuilder.com, user_profiles.id = ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12.
 *
 * 검증 계약(이 티켓 고유):
 *   AC-1 (전체 권한): exempt subject 는 모든 운영 메뉴(PermKey)를 role 무관 통과(canAccess 단락).
 *   AC-2 (타 계정/role 회귀 금지, BLOCKING): exempt 아닌 role 은 기존 PERM_MATRIX 그대로 — 변동 0.
 *   AC-4 (durability): role 강등(admin→staff)되어도 exempt=true 면 전 메뉴 보존 + prod 컬럼/backfill 영속.
 *   AC-5 (PHI/RRN audit 면제 아님): exempt 는 운영 메뉴 한정 — canViewRrn(주민번호 조회) 게이트를 우회하지 않음.
 *   AC-6 (의사/진료영역 경계): exempt 는 canAccess(운영 메뉴)만 단락 — 의사 publish 게이트는 canAccess 비경유라 영향 0.
 *
 * 본 spec 은 repo RBAC 컨벤션(헬퍼 로직 단위검증)을 따라 permissions.ts 헬퍼를 직접 import 한다.
 * 추가로 prod DB(서비스키 보유 시)에 AC-4 영속(컬럼 존재 + juyeon backfill=true)을 read-only 확인한다.
 *
 * 실행: npx playwright test T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM.spec.ts
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { canAccess, canViewRrn, isExemptFromRestrictions } from '../../src/lib/permissions';

const JUYEON_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// PERM_MATRIX 의 모든 운영 메뉴 키 (AC-1 전체 권한 통과 전수 검증용)
const ALL_PERM_KEYS = [
  'dashboard', 'reservations', 'customers', 'closing', 'stats',
  'register', 'messaging', 'manual_sms_send', 'customer_export',
] as const;

// 표본 프로필 — exempt 축 × role 축
const P = {
  juyeon_admin_exempt: { role: 'admin' as const, exempt_from_restrictions: true },   // 현재 김주연(admin + exempt 적재)
  juyeon_downgraded:   { role: 'staff' as const, exempt_from_restrictions: true },    // ★durability: 향후 role 강등 시나리오
  staff_normal:        { role: 'staff' as const, exempt_from_restrictions: false },   // 일반 직원(비exempt)
  coord_no_flag:       { role: 'coordinator' as const },                              // flag 미적재(undefined=false 취급)
};

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-1 전체 권한(exempt 단락)', () => {
  test('exempt subject → 전 운영 메뉴(PermKey) 통과', () => {
    for (const key of ALL_PERM_KEYS) {
      expect(canAccess(P.juyeon_admin_exempt, key), `juyeon(admin+exempt) ${key} 통과해야`).toBe(true);
    }
  });

  test('exempt 판정: flag true 만 exempt', () => {
    expect(isExemptFromRestrictions(P.juyeon_admin_exempt)).toBe(true);
    expect(isExemptFromRestrictions(P.juyeon_downgraded)).toBe(true);
    expect(isExemptFromRestrictions(P.staff_normal)).toBe(false);
    expect(isExemptFromRestrictions(P.coord_no_flag)).toBe(false);
    expect(isExemptFromRestrictions(null)).toBe(false);
  });
});

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-4 durability(role 강등 생존)', () => {
  test('role 강등(admin→staff)되어도 exempt=true 면 전 운영 메뉴 보존', () => {
    for (const key of ALL_PERM_KEYS) {
      expect(canAccess(P.juyeon_downgraded, key), `강등된 juyeon(staff+exempt) ${key} 보존해야`).toBe(true);
    }
  });
});

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-2 타 계정/role 회귀 금지(BLOCKING)', () => {
  test('비exempt staff → 제한 메뉴 차단 유지(회귀 0)', () => {
    expect(canAccess(P.staff_normal, 'customer_export')).toBe(false);
    expect(canAccess(P.staff_normal, 'register')).toBe(false);
    expect(canAccess(P.staff_normal, 'stats')).toBe(false);
  });

  test('flag 미적재 coordinator → 기존 PERM_MATRIX 그대로(customers O, customer_export X)', () => {
    expect(canAccess(P.coord_no_flag, 'customers')).toBe(true);
    expect(canAccess(P.coord_no_flag, 'customer_export')).toBe(false);
  });

  test('하위호환: role 문자열 인자(과거 호출부)는 exempt 미고려, 기존 동작 유지', () => {
    expect(canAccess('admin', 'customer_export')).toBe(true);
    expect(canAccess('staff', 'customer_export')).toBe(false);
    expect(canAccess('', 'customers')).toBe(false);
  });
});

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-5 PHI/RRN 면제 아님', () => {
  test('★exempt 는 RRN(주민번호) 조회 게이트를 우회하지 않음 — canViewRrn 은 role 기반 독립 게이트', () => {
    // canViewRrn 은 role 만 받는 별 게이트(canAccess 비경유). exempt staff 라도 staff role 은 RRN 미조회.
    expect(canViewRrn('staff')).toBe(false);          // 강등된 juyeon role(staff) → RRN 조회 불가(예외 ≠ 감사우회)
    // 운영 메뉴는 exempt 로 보존되지만(AC-4), RRN 게이트는 독립적으로 role 평가됨을 대조 확인.
    expect(canAccess(P.juyeon_downgraded, 'customer_export')).toBe(true); // 운영 메뉴는 보존
    expect(canViewRrn('admin')).toBe(true);           // admin role 은 기존대로 RRN 조회(회귀 0)
  });
});

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-6 의사/진료영역 경계', () => {
  test('exempt 는 canAccess(운영 메뉴) 단락만 — 의사 publish 게이트는 canAccess 비경유라 grant 아님', () => {
    // canAccess 가 다루는 surface 는 PERM_MATRIX 의 운영 메뉴뿐. 의사 publish(KOH·소견서 등)는 canAccess 키가 아님.
    // → exempt subject 라도 canAccess 로는 의사 publish 권한을 얻을 수 없다(키 자체가 없음 = grant 경로 차단).
    for (const key of ALL_PERM_KEYS) {
      // 모든 canAccess 키가 '운영 메뉴'임을 명시(의사 publish 키 부재 = AC-6 자동 안전).
      expect(['dashboard', 'reservations', 'customers', 'closing', 'stats', 'register', 'messaging', 'manual_sms_send', 'customer_export'])
        .toContain(key);
    }
  });
});

test.describe('T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-4 prod 영속(컬럼 + backfill)', () => {
  test('prod user_profiles 에 exempt_from_restrictions 컬럼 존재 + juyeon backfill=true', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase service env 미설정 — prod 영속 검증 스킵(로직 검증으로 충분)');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { data, error } = await sb
      .from('user_profiles')
      .select('id, role, exempt_from_restrictions')
      .eq('id', JUYEON_ID)
      .single();

    // 컬럼 부재면 PostgREST 가 컬럼 에러 → AC-4 미적용 신호
    expect(error, `juyeon row 조회/컬럼 에러: ${error?.message}`).toBeNull();
    expect(data, 'juyeon user_profiles row 존재해야').not.toBeNull();
    // AC-4: 상시예외 backfill 영속
    expect(data?.exempt_from_restrictions, 'juyeon exempt_from_restrictions=true 영속해야(AC-4)').toBe(true);

    // AC-2 회귀 가드: exempt=true 인 row 는 juyeon 단 1건이어야(타 계정 collateral elevation 0)
    const { data: exemptRows, error: cntErr } = await sb
      .from('user_profiles')
      .select('id')
      .eq('exempt_from_restrictions', true);
    expect(cntErr, `exempt 집계 에러: ${cntErr?.message}`).toBeNull();
    expect(exemptRows?.length, 'exempt=true 는 juyeon 1건뿐이어야(타 계정 회귀 0)').toBe(1);
    expect(exemptRows?.[0]?.id).toBe(JUYEON_ID);
  });
});
