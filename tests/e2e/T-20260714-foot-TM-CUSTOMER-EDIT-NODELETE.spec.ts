import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260714-foot-TM-CUSTOMER-EDIT-NODELETE — TM 역할, 고객관리 수정 권한 부여(삭제 제외)
 * 원천: planner NEW-TASK(MSG-20260714-131335). foot 현장(C0ATE5P6JTH) 요구:
 *   "계정관리 'TM'역할인 계정은 고객관리 페이지에서 수정가능한 버튼 열어줘(삭제권한X)"
 *
 * FE-only·무DDL(db_change=false). tm 은 user_profiles.role enum 旣존재(cross_crm_data_contract §2-3).
 * 거대-인라인/established 컴포넌트(Customers.tsx)·권한 게이트 = source-integrity gating(정적 단언).
 * 실 브라우저 동작(tm 로그인 → 수정 저장 / 삭제 부재)은 supervisor field-soak(갤탭 실기기 confirm)로 닫음.
 *
 *   AC1 tm 수정 버튼 노출     — canEditCustomer 에 'tm' 포함(ADDITIVE)
 *   AC2 tm 저장 정상(RLS union) — customers UPDATE RLS = customers_staff_update → is_floor_staff() 에 tm 旣포함
 *   AC3 tm 삭제 버튼 미노출    — canDeleteCustomer(admin/director) 에 tm 미포함
 *   AC4 tm 삭제 서버거부       — customers DELETE RLS = customers_admin_all(FOR ALL, is_admin_or_manager) 에 tm 부재
 *   AC5 회귀0                 — admin/manager/director/staff/part_lead 수정 · admin/director 삭제 불변
 *   AC6 최소권한              — 민감정보(canEditSensitive=isStaffUnlockRole)·RRN(canViewRrn) 에 tm 미포함 유지
 */

const CUSTOMERS = fs.readFileSync(path.resolve('src/pages/Customers.tsx'), 'utf-8');
const PERMISSIONS = fs.readFileSync(path.resolve('src/lib/permissions.ts'), 'utf-8');

// customers UPDATE(staff) RLS 최신 정본 = clinic-isolation 재적용본
const RLS_CLINIC_ISO = fs.readFileSync(
  path.resolve('supabase/migrations/20260615160000_rls_clinic_isolation_patient_tables.sql'),
  'utf-8',
);
// is_floor_staff() 최신 정의(tm 포함) = customers_staff_update reapply
const RLS_FLOOR_STAFF = fs.readFileSync(
  path.resolve('supabase/migrations/20260522090010_customers_staff_update_rls_reapply.sql'),
  'utf-8',
);

// canEditCustomer 정의 라인 추출 헬퍼
function canEditLine(): string {
  const line = CUSTOMERS.split('\n').find((l) => l.includes('const canEditCustomer ='));
  expect(line, 'canEditCustomer 정의 라인 부재').toBeTruthy();
  return line as string;
}
function canDeleteLine(): string {
  const line = CUSTOMERS.split('\n').find((l) => l.includes('const canDeleteCustomer ='));
  expect(line, 'canDeleteCustomer 정의 라인 부재').toBeTruthy();
  return line as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (AC1) — tm 고객정보 수정 버튼 노출
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: tm 수정 권한 부여 (AC1)', () => {
  test('AC1-1: canEditCustomer 에 tm 포함(ADDITIVE)', () => {
    const line = canEditLine();
    expect(line, "canEditCustomer 에 'tm' 미추가").toMatch(/\btm\b/);
    // 인라인 role 배열에 tm 명시
    expect(line, "['staff', 'part_lead', 'tm'] 형태의 tm 추가 누락")
      .toMatch(/\[[^\]]*'part_lead'[^\]]*'tm'[^\]]*\]|\[[^\]]*'tm'[^\]]*'part_lead'[^\]]*\]/);
  });

  test('AC1-2: 수정 버튼 렌더가 canEditCustomer 게이트(회귀0 — 게이트 경로 유지)', () => {
    const idx = CUSTOMERS.indexOf('title="고객 정보 수정"');
    expect(idx, '수정 버튼 부재').toBeGreaterThan(-1);
    const region = CUSTOMERS.slice(Math.max(0, idx - 400), idx);
    expect(region, '수정 버튼 canEditCustomer 조건부 렌더 누락').toContain('canEditCustomer && (');
  });

  test('AC1-3: 컨텍스트 메뉴 [정보 수정]도 canEditCustomer 전달(리스트/우클릭 parity)', () => {
    expect(CUSTOMERS, 'CustomerContextMenu 에 canEditCustomer 미전달')
      .toContain('canEditCustomer={canEditCustomer}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (AC2) — tm 저장 정상: FE union = RLS union
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: tm UPDATE RLS union (AC2, lock-out-in-disguise 방지)', () => {
  test('AC2-1: is_floor_staff() 에 tm 포함(customers UPDATE 판정 함수)', () => {
    const idx = RLS_FLOOR_STAFF.indexOf('FUNCTION is_floor_staff()');
    expect(idx, 'is_floor_staff() 정의 부재').toBeGreaterThan(-1);
    const body = RLS_FLOOR_STAFF.slice(idx, idx + 400);
    expect(body, "is_floor_staff() IN(...) 에 'tm' 누락").toContain("'tm'");
  });

  test('AC2-2: customers_staff_update = FOR UPDATE / is_floor_staff (clinic-scoped)', () => {
    const idx = RLS_CLINIC_ISO.indexOf('"customers_staff_update"');
    expect(idx, 'customers_staff_update 정책 부재(clinic-iso 정본)').toBeGreaterThan(-1);
    const region = RLS_CLINIC_ISO.slice(idx, idx + 260);
    expect(region, 'FOR UPDATE 아님').toContain('FOR UPDATE');
    expect(region, 'is_floor_staff() 판정 미사용').toContain('is_floor_staff()');
    expect(region, 'clinic 스코프 누락').toContain('clinic_id = current_user_clinic_id()');
  });

  test('AC2-3: 저장 경로 코멘트가 db_change=false·RLS union 을 명시(추적성)', () => {
    expect(CUSTOMERS, 'db_change=false / RLS union 근거 코멘트 누락')
      .toContain('TM-CUSTOMER-EDIT-NODELETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 (AC3·AC4) — tm 삭제 차단: FE 숨김 + 서버 RLS 이중
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: tm 삭제 차단 (AC3·AC4)', () => {
  test('AC3-1: canDeleteCustomer 는 admin/director 만 — tm 미포함', () => {
    const line = canDeleteLine();
    expect(line, 'canDeleteCustomer admin 게이트 누락').toContain("=== 'admin'");
    expect(line, 'canDeleteCustomer director 게이트 누락').toContain("=== 'director'");
    expect(line, 'canDeleteCustomer 에 tm 이 잘못 포함됨(삭제권한 누출)').not.toMatch(/'tm'/);
  });

  test('AC3-2: 삭제 버튼이 canDeleteCustomer 조건부 렌더(tm 미노출)', () => {
    const idx = CUSTOMERS.indexOf('title="삭제"');
    expect(idx, '삭제 버튼 부재').toBeGreaterThan(-1);
    const region = CUSTOMERS.slice(Math.max(0, idx - 400), idx);
    expect(region, '삭제 버튼 canDeleteCustomer 조건부 렌더 누락').toContain('canDeleteCustomer && (');
  });

  test('AC4-1: customers DELETE RLS = customers_admin_all(FOR ALL) / is_admin_or_manager — tm 부재(서버거부)', () => {
    const idx = RLS_CLINIC_ISO.indexOf('"customers_admin_all"', RLS_CLINIC_ISO.indexOf('CREATE POLICY'));
    expect(idx, 'customers_admin_all 정책 부재').toBeGreaterThan(-1);
    const region = RLS_CLINIC_ISO.slice(idx, idx + 200);
    expect(region, 'FOR ALL(DELETE 포함) 아님').toContain('FOR ALL');
    expect(region, 'is_admin_or_manager 게이트 미사용').toContain('is_admin_or_manager()');
    // floor-staff/tm 은 DELETE 정책 없음 → 별 UPDATE 정책만 존재. DELETE 전용 tm 정책 부재 확인.
    expect(RLS_CLINIC_ISO, 'tm 대상 DELETE 정책이 잘못 존재')
      .not.toMatch(/FOR DELETE[\s\S]{0,120}is_floor_staff/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 (AC5) — 회귀0: 기존 역할 권한 불변
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 기존 역할 회귀0 (AC5)', () => {
  test('AC5-1: canEditCustomer 기존 집합(isStaffUnlockRole ∪ staff/part_lead) 보존', () => {
    const line = canEditLine();
    expect(line, 'isStaffUnlockRole(6역할) 게이트 회수됨').toContain('isStaffUnlockRole(profile?.role)');
    expect(line, 'staff 회수됨(lock-out)').toContain("'staff'");
    expect(line, 'part_lead 회수됨(lock-out)').toContain("'part_lead'");
  });

  test('AC5-2: canDeleteCustomer 집합(admin/director) 불변', () => {
    const line = canDeleteLine();
    expect(line, 'canDeleteCustomer 게이트 변경(회귀 위험)')
      .toMatch(/profile\?\.role === 'admin' \|\| profile\?\.role === 'director'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 5 (AC6) — 최소권한: tm 은 민감정보·RRN 제외
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오5: tm 최소권한 유지 (AC6)', () => {
  test('AC6-1: 민감정보 편집 게이트(canEditSensitive)는 isStaffUnlockRole — tm 미포함', () => {
    expect(CUSTOMERS, 'canEditSensitive 게이트가 isStaffUnlockRole 이 아님')
      .toContain('canEditSensitive={isStaffUnlockRole(profile?.role)}');
    // STAFF_UNLOCK_ROLES 에 tm 없음(permissions.ts SSOT) → tm 은 민감필드 readonly.
    const idx = PERMISSIONS.indexOf('STAFF_UNLOCK_ROLES: UserRole[] = [');
    expect(idx, 'STAFF_UNLOCK_ROLES 정의 부재').toBeGreaterThan(-1);
    const arr = PERMISSIONS.slice(idx, PERMISSIONS.indexOf('];', idx));
    expect(arr, 'STAFF_UNLOCK_ROLES 에 tm 이 잘못 포함(민감정보 누출)').not.toMatch(/'tm'/);
  });

  test('AC6-2: RRN 조회(canViewRrn)는 STAFF_UNLOCK_ROLES 기반 — tm 미포함(주민번호 비노출)', () => {
    const idx = PERMISSIONS.indexOf('RRN_VIEW_ROLES: UserRole[] =');
    expect(idx, 'RRN_VIEW_ROLES 정의 부재').toBeGreaterThan(-1);
    const line = PERMISSIONS.slice(idx, PERMISSIONS.indexOf('\n', idx));
    expect(line, 'RRN_VIEW_ROLES 가 STAFF_UNLOCK_ROLES 파생이 아님(tm 누출 위험)')
      .toContain('STAFF_UNLOCK_ROLES');
  });
});
