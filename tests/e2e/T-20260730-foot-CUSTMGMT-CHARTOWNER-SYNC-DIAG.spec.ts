/**
 * T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG
 *
 * 고객관리 담당자 표시 일관화 (결정 B = "퇴사 김수린 담당 7건 미지정 + 양화면 일관 표시").
 *
 * 배경(진단 D1~D5): 고객관리(Customers.tsx)는 customers.assigned_staff_id 를 direct read 하되,
 *   staffNameMap 이 role/active 무관 전체 staff 를 로드해 퇴사(active=false) 실장(김수린) 이름까지 표시(ⓑ).
 *   2번차트 Zone1(CustomerChartPage.tsx) 드롭다운은 active-only 라 퇴사자 blank → 총괄이 '담당자 없음'으로
 *   인식 → 두 화면 divergence. 양종필(F-0155)이 대표 증상(assigned_staff_id=김수린, active=false).
 *
 * 확정 fix (2-Part):
 *   · Part 1(데이터): 퇴사 김수린 담당 7건 assigned_staff_id → NULL(백필, data_correction_backfill_sop, 별도 러너/evidence).
 *   · Part 2(표시, 본 spec 대상):
 *       - Customers.tsx: staffNameMap active-only 로드 → NULL·퇴사/부재 staff(map miss) → '미지정' resolve.
 *       - Customers.tsx: 담당자 컬럼 fallback '-' → '미지정' (현장 요구 "일관되게 표시").
 *       - CustomerChartPage.tsx Zone1: 담당자 드롭다운 빈 옵션 라벨 "— 선택 —" → "미지정" (양화면 통일).
 *
 * RED LINE(INV-1): assigned_staff_id 라인만. assigned_consultant_id(매출/인센티브 귀속) 무접촉.
 *
 * 본 spec = 순수 로직(표시 resolution 미러) + 정적 소스 가드. auth/server/DB 불요·결정론.
 *   진짜 UI 관측 게이트 = supervisor field-soak(고객관리 목록 + 2번차트 Zone1 실렌더).
 * 실행: npx playwright test T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CUSTOMERS = path.join(ROOT, 'src/pages/Customers.tsx');
const CHARTPAGE = path.join(ROOT, 'src/pages/CustomerChartPage.tsx');

/**
 * Customers.tsx 담당자 컬럼 표시 resolution 미러.
 *   실제 코드: {(c.assigned_staff_id && staffNameMap.get(c.assigned_staff_id)) || '미지정'}
 *   staffNameMap = active=true staff 만 로드 → 퇴사/부재 staff id 는 map 에 없음(undefined).
 */
function resolveAssignedStaffLabel(
  assignedStaffId: string | null,
  activeStaffNameMap: Map<string, string>,
): string {
  return (assignedStaffId && activeStaffNameMap.get(assignedStaffId)) || '미지정';
}

// active staff 만 담긴 map (staffNameMap active-only 로드 반영). 퇴사 김수린은 부재.
const ACTIVE_MAP = new Map<string, string>([
  ['staff-active-엄경은', '엄경은'],
  ['staff-active-송지현', '송지현'],
]);
const KIMSURIN_INACTIVE_ID = '5b3a3a5f-9d14-4099-897b-95c6ae86b763'; // active=false → map 부재

// ── 시나리오 2: NULL(미지정) 고객 → 양화면 "미지정" (임의 실장 미표시) ─────────────
test.describe('시나리오2 — assigned_staff_id NULL → "미지정"(임의 실장 미표시)', () => {
  test('NULL → "미지정" (공란/"-" 아님)', () => {
    const label = resolveAssignedStaffLabel(null, ACTIVE_MAP);
    expect(label).toBe('미지정');
    expect(label).not.toBe('-');
    expect(label).not.toBe('');
  });
  test('NULL → 임의(active) 실장 이름으로 채워지지 않음', () => {
    const label = resolveAssignedStaffLabel(null, ACTIVE_MAP);
    expect([...ACTIVE_MAP.values()]).not.toContain(label);
  });
});

// ── 시나리오 3: 퇴사(active=false) 실장 담당 → 양화면 "미지정" 일관 (하드닝 = ⓑ 재발방지) ─
test.describe('시나리오3 — 퇴사 실장(김수린) 담당 → 양화면 "미지정" 일관', () => {
  test('퇴사 staff id (map miss) → "미지정" resolve (퇴사자 이름 미표시)', () => {
    const label = resolveAssignedStaffLabel(KIMSURIN_INACTIVE_ID, ACTIVE_MAP);
    expect(label).toBe('미지정');
    expect(label).not.toContain('김수린');
  });
  test('부재(삭제)·dangling staff id (map miss) → "미지정"', () => {
    expect(resolveAssignedStaffLabel('nonexistent-uuid', ACTIVE_MAP)).toBe('미지정');
  });
  test('active 실장은 정상 이름 표시(회귀 — 하드닝이 정상 담당자를 지우지 않음)', () => {
    expect(resolveAssignedStaffLabel('staff-active-엄경은', ACTIVE_MAP)).toBe('엄경은');
    expect(resolveAssignedStaffLabel('staff-active-송지현', ACTIVE_MAP)).toBe('송지현');
  });
});

// ── 정적 소스 가드: Customers.tsx (staffNameMap active-only + fallback '미지정') ────────
test.describe('소스 가드 — Customers.tsx', () => {
  const src = () => fs.readFileSync(CUSTOMERS, 'utf-8');

  test('staffNameMap 로드 쿼리 = active=true (퇴사자 resolve 차단, ⓑ 원인 제거)', () => {
    const s = src();
    // staffNameMap useEffect 블록 내 active 필터. select('id, name') 뒤 .eq('active', true) 존재.
    expect(s).toMatch(/\.select\('id, name'\)[\s\S]*?\.eq\('active', true\)/);
  });
  test('담당자 컬럼 fallback = "미지정" (종전 "-" 폐기)', () => {
    const s = src();
    expect(s).toContain("staffNameMap.get(c.assigned_staff_id)) || '미지정'");
    expect(s).not.toContain("staffNameMap.get(c.assigned_staff_id)) || '-'");
  });
  test('RED LINE — assigned_consultant_id write 부재(매출귀속 무접촉)', () => {
    const s = src();
    expect(s).not.toMatch(/assigned_consultant_id\s*:/);
  });
});

// ── 정적 소스 가드: CustomerChartPage.tsx Zone1 (빈 옵션 "미지정") ──────────────────────
test.describe('소스 가드 — CustomerChartPage.tsx Zone1', () => {
  const src = () => fs.readFileSync(CHARTPAGE, 'utf-8');

  test('Zone1 담당자 드롭다운 빈 옵션 = "미지정" (종전 "— 선택 —" 폐기)', () => {
    const s = src();
    expect(s).toContain('<option value="">미지정</option>');
    // Zone1 담당자 select 블록(value={customer.assigned_staff_id}) 내부에 "미지정" 빈 옵션이
    //   존재하고, 종전 "— 선택 —" 라벨이 그 블록에 남지 않았는지 스코프 확인(타 드롭다운 방문경로 등은 무관).
    const zStart = s.indexOf("value={customer.assigned_staff_id ?? ''}");
    const zone1 = s.slice(zStart, s.indexOf('</select>', zStart) + 9);
    expect(zone1).toContain('<option value="">미지정</option>');
    expect(zone1).not.toContain('— 선택 —');
  });
  test('Zone1 값 소스 = assigned_staff_id (담당자 소스 불변)', () => {
    const s = src();
    expect(s).toContain("value={customer.assigned_staff_id ?? ''}");
  });
});
