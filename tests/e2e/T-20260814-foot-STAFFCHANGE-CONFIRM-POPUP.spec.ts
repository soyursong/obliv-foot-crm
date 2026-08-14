/**
 * E2E — T-20260814-foot-STAFFCHANGE-CONFIRM-POPUP (풋센터 담당자 변경 확인 팝업 · SCOPE-EXPAND)
 *
 * reporter(김주연 총괄) 2026-08-14 요구 + SCOPE-EXPAND(MSG-20260814-205523-c4z3):
 *   - 트리거: 이미 담당자(assigned_staff_id)가 지정된 고객의 담당자를 '다른 값'으로 바꾸려는 시점.
 *   - 동작: 확인 다이얼로그 → [확인] 변경 진행 / [취소] 기존 담당자 유지.
 *   - 문구(원안): "담당자를 정말 변경하시겠습니까? 이후 매출은 신규 담당자 앞으로 귀속됩니다".
 *   - 비대상(엣지): 담당자 최초 지정(빈값 '' → 실장) = 변경 아님 → 팝업 없음, 그대로 저장.
 *
 * ★UI-only·db_change=false — 신규 컬럼/테이블/RPC 없음. window.confirm 클라이언트 가드만 추가.
 * ★공통 가드(SCOPE-EXPAND): 담당자 변경 확인은 canonical 공유 home `src/lib/staffChangeConfirm.ts` 의
 *   confirmStaffChange/isStaffReassignment 로 단일화. 차트 담당자 변경 '모든 경로'가 이 단일 모듈을 재사용:
 *     ① 2번차트(CustomerChartPage) 정보구역 select + 상담탭 select → changeAssignedStaffWithGuard 헬퍼 경유
 *     ② 예약상세 팝업(ReservationDetailPopup) 담당자 select → saveConsultant 에서 직접 가드 호출
 *   배분이력 담당자 변경 UI(T-20260724 AC-5, assigned_staff_id write UI)도 게이트 해소 후 동일 모듈 재사용 예정.
 *   = 중복구현 0(문구·판정 1곳 SSOT), 차트 assigned_staff_id write 진입점 누락 0(census 전수).
 * ★deploy_coordination(배포순서): STAFFCHANGE_CONFIRM_MSG 의 money-attribution 문장은 자매
 *   T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE(Branch A) 스냅샷 prod 반영 이후에만 사실과 일치.
 *
 * 현장 클릭 시나리오 3종(티켓 본문) — 가드 predicate 로 결정적 검증:
 *   [S1 정상확정] 기존 담당 A → B 선택 → confirm 노출 → [확인] → assigned_staff_id=B 저장 + 후속전파.
 *   [S2 취소]     기존 담당 A → B 선택 → confirm 노출 → [취소] → 저장/전파/state 무접점 → A 유지.
 *   [S3 최초지정] 담당 미지정('') → A 선택 → confirm 미노출(변경 아님) → 그대로 저장.
 *
 * window.confirm 결과는 소스 predicate(prev!=='' && next!==prev)로 완전 결정 → 정적 검증이 시나리오 커버리지.
 * 비파괴: 소스 정적 분석 only, prod write 0.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const shared = read('src/lib/staffChangeConfirm.ts');
const chart = read('src/pages/CustomerChartPage.tsx');
const resvPopup = read('src/components/ReservationDetailPopup.tsx');

// CustomerChartPage 공통 헬퍼 본문 슬라이스(선언 ~ 다음 useCallback 경계).
function chartHelperBody(): string {
  const idx = chart.indexOf('const changeAssignedStaffWithGuard');
  expect(idx, 'changeAssignedStaffWithGuard 헬퍼가 존재해야 함').toBeGreaterThan(0);
  return chart.slice(idx, idx + 1200);
}

// ReservationDetailPopup saveConsultant 본문 슬라이스.
function saveConsultantBody(): string {
  const idx = resvPopup.indexOf('const saveConsultant = async');
  expect(idx, 'saveConsultant 함수가 존재해야 함').toBeGreaterThan(0);
  return resvPopup.slice(idx, idx + 900);
}

test.describe('[정적] STAFFCHANGE-CONFIRM-POPUP — canonical 공유 가드 모듈', () => {
  test('G0: 공유 home(staffChangeConfirm.ts) 문구 상수 = 원안(변경 확인 + money-attribution) + 완화판(SOFT) 병존', () => {
    const i = shared.indexOf('export const STAFFCHANGE_CONFIRM_MSG');
    expect(i, 'STAFFCHANGE_CONFIRM_MSG export 존재').toBeGreaterThan(0);
    expect(shared).toContain('담당자를 정말 변경하시겠습니까?');
    expect(shared).toContain('이후 매출은 신규 담당자 앞으로 귀속됩니다');
    // 조기배포 fallback(완화판, money-attribution 생략) 도 shared home 에 상수로 준비 — deploy_coordination.
    expect(shared).toContain('export const STAFFCHANGE_CONFIRM_MSG_SOFT');
  });

  test('G1: 재지정 predicate(isStaffReassignment) = 기존값 지정(prev!=="") && 새 값이 기존과 다름 — 최초지정/동일값 제외', () => {
    const idx = shared.indexOf('export function isStaffReassignment');
    expect(idx, 'isStaffReassignment 판정 함수 존재').toBeGreaterThan(0);
    const body = shared.slice(idx, idx + 350);
    // 트리거: prev 비어있지 않고(최초지정 제외) && 새 값이 기존과 다름(동일값 제외)
    expect(body).toMatch(/p\s*!==\s*''\s*&&\s*n\s*!==\s*p/);
  });

  test('G2: confirmStaffChange = 재지정일 때만 window.confirm, 아니면 무팝업 통과(true)', () => {
    const idx = shared.indexOf('export function confirmStaffChange');
    expect(idx, 'confirmStaffChange 가드 함수 존재').toBeGreaterThan(0);
    const body = shared.slice(idx, idx + 400);
    // 재지정 아니면 즉시 true(최초지정/동일값 무팝업 통과)
    expect(body).toMatch(/if\s*\(!isStaffReassignment\([^)]*\)\)\s*return true/);
    // 재지정이면 window.confirm 결과 반환
    expect(body).toMatch(/return window\.confirm\(/);
  });
});

test.describe('[정적] 차트 담당자 변경 모든 경로 — 공유 가드 재사용(중복구현 0)', () => {
  test('S1 정상확정: 2번차트 [확인] 경로 → assigned_staff_id 저장 + 후속 하향전파(syncChartOwnerToTodayRoster)', () => {
    const b = chartHelperBody();
    // 공유 가드 경유(로컬 재구현 아님)
    expect(b).toMatch(/if\s*\(!confirmStaffChange\(prev,\s*rawValue\)\)\s*return;/);
    expect(b).toContain('saveCustomerField({ assigned_staff_id: nextValue })');
    expect(b).toContain('syncChartOwnerToTodayRoster(nextValue)');
    expect(b).toMatch(/if\s*\(error\)\s*return;/);
  });

  test('S2 취소: 2번차트 [취소] 시 confirmStaffChange 실패 → early-return 이 저장(saveCustomerField)보다 앞 = 무접점', () => {
    const b = chartHelperBody();
    const guardReturn = b.search(/if\s*\(!confirmStaffChange\(prev,\s*rawValue\)\)\s*return;/);
    const save = b.indexOf('saveCustomerField');
    expect(guardReturn, '가드 early-return 존재').toBeGreaterThan(0);
    expect(guardReturn).toBeLessThan(save);
  });

  test('S3 최초지정(엣지): prev 판정 소스 = customer.assigned_staff_id → 최초지정/동일값은 공유 predicate 로 팝업 미노출', () => {
    const b = chartHelperBody();
    expect(b).toContain("customer?.assigned_staff_id ?? ''");
    // 판정은 공유 모듈 소유(로컬 인라인 predicate 재구현 없음)
    expect(b).not.toMatch(/prev\s*!==\s*''\s*&&\s*rawValue\s*!==\s*prev/);
  });

  test('S1/S2 예약상세 팝업 경로: saveConsultant 도 공유 가드 경유 — 재지정 confirm + [취소] early-return(무접점)', () => {
    const b = saveConsultantBody();
    // prev = consultantBaseline.current(저장된 assigned_staff_id), next = nextNorm(__none__→'')
    expect(b).toMatch(/confirmStaffChange\(consultantBaseline\.current,\s*nextNorm\)/);
    // 취소 시 update/state 이전 early-return
    const guardReturn = b.search(/if\s*\(!confirmStaffChange\([^)]*\)\)\s*return;/);
    const update = b.indexOf(".update({ assigned_staff_id");
    expect(guardReturn, '예약상세 가드 early-return 존재').toBeGreaterThan(0);
    expect(guardReturn).toBeLessThan(update);
  });

  test('G3 공통 가드 census: 차트 assigned_staff_id write 진입점 모두 공유 모듈 import — 로컬 문구/predicate 재정의 0', () => {
    // 두 파일 모두 shared home 을 import
    expect(chart).toContain("from '@/lib/staffChangeConfirm'");
    expect(resvPopup).toContain("from '@/lib/staffChangeConfirm'");
    // 로컬 STAFFCHANGE_CONFIRM_MSG 상수 재정의가 shared home 밖(차트/팝업)에 남지 않음(중복구현 0)
    expect(chart).not.toContain('const STAFFCHANGE_CONFIRM_MSG');
    expect(resvPopup).not.toContain('const STAFFCHANGE_CONFIRM_MSG');
    // 2번차트 두 진입경로 onChange 는 헬퍼 경유(직접 저장 인라인 0) — assigned_staff_id 저장 호출 1곳
    expect(chart.slice(chart.indexOf('value={customer.assigned_staff_id ?? \'\'}'), chart.indexOf('value={customer.assigned_staff_id ?? \'\'}') + 600))
      .toContain('changeAssignedStaffWithGuard(e.target.value, true)');
    expect(chart.slice(chart.indexOf('value={consultationStaffId}'), chart.indexOf('value={consultationStaffId}') + 600))
      .toContain('changeAssignedStaffWithGuard(e.target.value, false)');
    const directSaves = chart.split('saveCustomerField({ assigned_staff_id:').length - 1;
    expect(directSaves, 'assigned_staff_id 저장은 공통 헬퍼 1곳에서만').toBe(1);
  });
});
