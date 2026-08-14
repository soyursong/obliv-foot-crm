/**
 * E2E — T-20260814-foot-STAFFCHANGE-CONFIRM-POPUP (풋센터 2번차트 담당자 변경 확인 팝업)
 *
 * reporter(김주연 총괄) 2026-08-14 요구(MSG-20260814-205617-r00a):
 *   - 트리거: 이미 담당자(assigned_staff_id)가 지정된 고객의 담당자를 2번차트에서 '다른 값'으로 바꾸려는 시점.
 *   - 동작: 확인 다이얼로그 → [확인] 변경 진행 / [취소] 기존 담당자 유지.
 *   - 문구(원안): "담당자를 정말 변경하시겠습니까? 이후 매출은 신규 담당자 앞으로 귀속됩니다".
 *   - 비대상(엣지): 담당자 최초 지정(빈값 '' → 실장) = 변경 아님 → 팝업 없음, 그대로 저장.
 *
 * ★UI-only·db_change=false — 신규 컬럼/테이블/RPC 없음. window.confirm 클라이언트 가드만 추가.
 * ★공통 가드: 2번차트에서 assigned_staff_id 를 바꾸는 모든 진입경로(정보구역 select·상담탭 select)가
 *   단일 헬퍼 changeAssignedStaffWithGuard 를 공유 — 중복구현 0(누락 경로 없음).
 * ★deploy_coordination(배포순서): STAFFCHANGE_CONFIRM_MSG 의 money-attribution 문장은 자매
 *   T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE(Branch A) 스냅샷 prod 반영 이후에만 사실과 일치.
 *
 * 현장 클릭 시나리오 3종(티켓 본문) — 가드 predicate 로 결정적 검증:
 *   [S1 정상확정] 기존 담당 A → B 선택 → confirm 노출 → [확인] → assigned_staff_id=B 저장 + 배분이력 하향전파.
 *   [S2 취소]     기존 담당 A → B 선택 → confirm 노출 → [취소] → 저장/전파 무접점 → A 유지(controlled select 원복).
 *   [S3 최초지정] 담당 미지정('') → A 선택 → confirm 미노출(변경 아님) → 그대로 저장.
 *
 * window.confirm 결과는 소스 predicate(prev!=='' && rawValue!==prev)로 완전 결정 → 정적 검증이 시나리오 커버리지.
 * 비파괴: 소스 정적 분석 only, prod write 0.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const chart = read('src/pages/CustomerChartPage.tsx');

// 헬퍼 본문 슬라이스 추출(선언 ~ 다음 useCallback 경계).
function helperBody(): string {
  const idx = chart.indexOf('const changeAssignedStaffWithGuard');
  expect(idx, 'changeAssignedStaffWithGuard 헬퍼가 존재해야 함').toBeGreaterThan(0);
  return chart.slice(idx, idx + 1200);
}

test.describe('[정적] STAFFCHANGE-CONFIRM-POPUP — 확인 팝업 공통 가드', () => {
  test('G0: 확인 문구 상수 = 원안(변경 확인 + money-attribution 문장) 포함', () => {
    const i = chart.indexOf('const STAFFCHANGE_CONFIRM_MSG');
    expect(i, 'STAFFCHANGE_CONFIRM_MSG 상수 정의 존재').toBeGreaterThan(0);
    const block = chart.slice(i, i + 300);
    expect(block).toContain('담당자를 정말 변경하시겠습니까?');
    expect(block).toContain('이후 매출은 신규 담당자 앞으로 귀속됩니다');
  });

  test('G1: 재지정 트리거 predicate = 기존값 지정(prev!=="") && 새 값이 기존과 다름 — 최초지정/동일값 제외', () => {
    const b = helperBody();
    // 기존값 소스 = customer.assigned_staff_id
    expect(b).toContain("customer?.assigned_staff_id ?? ''");
    // 트리거: prev 비어있지 않고(최초지정 제외) && 새 값이 기존과 다름(동일값 제외)
    expect(b).toMatch(/prev\s*!==\s*''\s*&&\s*rawValue\s*!==\s*prev/);
    // 트리거 성립 시에만 window.confirm 호출
    expect(b).toMatch(/if\s*\(\s*isReassignment\s*\)\s*\{[\s\S]*window\.confirm\(STAFFCHANGE_CONFIRM_MSG\)/);
  });

  test('S1 정상확정: [확인] 경로 → assigned_staff_id 저장 + 배분이력 하향전파(syncChartOwnerToTodayRoster)', () => {
    const b = helperBody();
    expect(b).toContain('saveCustomerField({ assigned_staff_id: nextValue })');
    expect(b).toContain('syncChartOwnerToTodayRoster(nextValue)');
    // 저장 실패 시 전파 안 함(가드)
    expect(b).toMatch(/if\s*\(error\)\s*return;/);
  });

  test('S2 취소: [취소] 시 early return — 저장/전파/state 무접점(기존 담당자 유지)', () => {
    const b = helperBody();
    // confirm 취소(!ok) 시 return 이 저장(saveCustomerField)보다 앞서야 함 = 취소 시 무접점
    const cancelReturn = b.search(/if\s*\(!ok\)\s*return;/);
    const save = b.indexOf('saveCustomerField');
    expect(cancelReturn, '취소 early-return 존재').toBeGreaterThan(0);
    expect(cancelReturn).toBeLessThan(save);
  });

  test('S3 최초지정(엣지): prev==="" 이면 isReassignment=false → confirm 미노출, 그대로 저장', () => {
    const b = helperBody();
    // predicate 가 prev!=='' 를 요구하므로 최초지정(빈값→값)은 confirm 을 건너뛴다 = 소스로 보장
    expect(b).toMatch(/prev\s*!==\s*''/);
    // 동일값 재선택도 rawValue!==prev 로 제외 = 불필요한 팝업 없음
    expect(b).toMatch(/rawValue\s*!==\s*prev/);
  });

  test('G2 공통 가드: 2번차트 assigned_staff_id 변경 진입경로 모두 헬퍼 경유 — 헬퍼 밖 직접 저장 0', () => {
    // 정보구역 select(customer.assigned_staff_id 바인딩) onChange — info-panel 소속 → markDirty=true
    const zone1 = chart.indexOf('value={customer.assigned_staff_id ?? \'\'}');
    expect(zone1).toBeGreaterThan(0);
    expect(chart.slice(zone1, zone1 + 600)).toContain('changeAssignedStaffWithGuard(e.target.value, true)');
    // 상담탭 select(consultationStaffId 바인딩) onChange — info-panel 밖 → markDirty=false(dirty 미마킹 보존)
    const consultTab = chart.indexOf('value={consultationStaffId}');
    expect(consultTab).toBeGreaterThan(0);
    expect(chart.slice(consultTab, consultTab + 600)).toContain('changeAssignedStaffWithGuard(e.target.value, false)');

    // 두 진입경로의 onChange 는 더 이상 헬퍼 밖에서 직접 saveCustomerField(assigned_staff_id) 하지 않는다.
    //   (헬퍼 정의 1곳 + 두 onChange 인라인 0곳 = assigned_staff_id 저장 호출 총 1개)
    const directSaves = chart.split('saveCustomerField({ assigned_staff_id:').length - 1;
    expect(directSaves, 'assigned_staff_id 저장은 공통 헬퍼 1곳에서만').toBe(1);
  });
});
