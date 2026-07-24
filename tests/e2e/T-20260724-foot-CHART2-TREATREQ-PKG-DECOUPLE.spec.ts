/**
 * E2E/Unit — T-20260724-foot-CHART2-TREATREQ-PKG-DECOUPLE  (Surface B)
 *
 * 현장 증상(김주연 총괄, C0ATE5P6JTH thread 1784868083.758109):
 *   2번 차트에서 피검사·균검사(KOH) '치료 신청' 을 체크해도, 치료테이블 명단으로 이동/재진입하면
 *   체크가 계속 풀린다. 어제(7/23)부터 빈도 급증. 앞선 2배포(check_ins.package_id 링크-보존) 후에도 재발.
 *
 * 지배 RC (dev_rca_deep, MSG-20260724-212401-w90d):
 *   앞 2배포는 체크박스가 읽지도 않는 check_ins.package_id 를 고쳐 증상 생존.
 *   실제 원인 = 피검사/KOH 신청 플래그(check_in_services.blood_test_requested/koh_requested)를
 *   결제 저장/자동저장(PaymentMiniWindow.saveCheckInServices / handleClose)이 DELETE+reinsert 할 때
 *   재적용하지 않아 매번 false 로 clobber. 치료테이블 동선의 재저장이 곧 "화면 이동 시 체크 풀림".
 *
 * FIX: DELETE 前 스냅샷한 플래그를 reinsert 행에 복원(applyExamFlagsToReinsert) — package_session_id
 *   C3 보존과 동일 패턴. no-DDL(기존 컬럼 재사용), db_change:false.
 *
 * ⚠ 본 spec 은 프로덕션이 실제 호출하는 SSOT 순수 함수(applyExamFlagsToReinsert)를 그대로 검증한다.
 *    (이전 실패 spec 은 체크박스가 읽지도 않는 shouldLinkCheckInPackage 를 검증 → green 인데 증상 생존.
 *     본 spec 은 그 안티패턴을 피해 실제 persist 경로의 clobber→보존 사이클을 결정적으로 재현한다.)
 *    mount→선택(플래그 ON)→이탈(치료테이블=결제 재저장 DELETE+reinsert)→복귀(재조회 some(true))=여전히 checked.
 *
 * ⛔ 순수 함수 read-only 검증. 어떤 값도 DB write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import {
  applyExamFlagsToReinsert,
  isKohServiceName,
  type CisInsertRow,
} from '../../src/lib/examFlagPreserve';

const CI = '03b76420-2143-48ae-966a-7b4e36bd9f0c'; // 오늘 내원(2번차트 latestCheckIn)

// 결제 재저장 시 새로 만들어지는 실제 서비스 행(플래그 미포함 = DELETE 직후 reinsert 원본).
function baseRows(names: string[]): CisInsertRow[] {
  return names.map((service_name) => ({
    check_in_id: CI,
    service_id: `svc-${service_name}`,
    service_name,
    price: 30000,
    original_price: 30000,
    is_package_session: false,
    package_session_id: null,
  }));
}

// 2번차트/치료테이블이 체크상태를 판정하는 방식과 동형: customer 의 non-cancelled 행에 대해 some(flag).
const bloodChecked = (rows: CisInsertRow[]) => rows.some((r) => r.blood_test_requested === true);
const kohChecked = (rows: CisInsertRow[]) => rows.some((r) => r.koh_requested === true);

test.describe('T-20260724 Surface B — 치료테이블 이동(재저장) 후에도 피검사/KOH 신청 유지', () => {
  test('AC-1/AC-2 (피검사): 신청 ON → 결제 재저장 DELETE+reinsert → 여전히 checked', () => {
    // 재저장 원본 행에는 플래그가 없다(=DELETE 로 소실된 상태) → 보존 전에는 unchecked 로 풀린다(RC 재현).
    const rows = baseRows(['각질제거', '레이저']);
    expect(bloodChecked(rows)).toBe(false);

    // 보존 로직 적용(스냅샷된 blood=true) → 재저장 행에 플래그 복원.
    applyExamFlagsToReinsert(rows, CI, { blood: true, koh: false });
    expect(bloodChecked(rows)).toBe(true); // 명단 이동 후 재조회해도 유지(재풀림 종결)
    // 피검사는 check-in 전체 행에 적용(RPC UPDATE-all 동형).
    expect(rows.filter((r) => r.service_id !== null).every((r) => r.blood_test_requested === true)).toBe(true);
  });

  test('AC-1/AC-2 (KOH, KOH명 행 없음): 신청 ON → 재저장 → 요청 마커 행으로 보존', () => {
    const rows = baseRows(['각질제거', '레이저']); // KOH명 서비스 없음
    applyExamFlagsToReinsert(rows, CI, { blood: false, koh: true });
    expect(kohChecked(rows)).toBe(true);
    // KOH명 행이 없으므로 마커 행(service_id NULL)이 정확히 1개 추가된다.
    const markers = rows.filter((r) => r.service_id === null && r.koh_requested === true);
    expect(markers).toHaveLength(1);
    expect(isKohServiceName(markers[0].service_name)).toBe(true);
  });

  test('AC-1/AC-2 (KOH, KOH명 행 있음): 마커 없이 KOH명 행에 플래그 복원', () => {
    const rows = baseRows(['KOH 진균검사', '레이저']);
    applyExamFlagsToReinsert(rows, CI, { blood: false, koh: true });
    expect(kohChecked(rows)).toBe(true);
    expect(rows.filter((r) => r.service_id === null)).toHaveLength(0); // 마커 불필요
    expect(rows.find((r) => r.service_name === 'KOH 진균검사')!.koh_requested).toBe(true);
    expect(rows.find((r) => r.service_name === '레이저')!.koh_requested).toBe(false); // KOH명 아님
  });

  test('피검사+KOH 동시 ON: 두 신청 모두 재저장 후 유지', () => {
    const rows = baseRows(['각질제거']);
    applyExamFlagsToReinsert(rows, CI, { blood: true, koh: true });
    expect(bloodChecked(rows)).toBe(true);
    expect(kohChecked(rows)).toBe(true);
  });
});

test.describe('T-20260724 회귀 방지 (AC-3/AC-4)', () => {
  test('AC-4 (no-op): 신청 OFF → 재저장 행에 플래그 false, 마커/불필요 행 0 (차감·청구 무접점)', () => {
    const rows = baseRows(['각질제거', '레이저']);
    const before = rows.length;
    applyExamFlagsToReinsert(rows, CI, { blood: false, koh: false });
    expect(rows).toHaveLength(before); // 행 개수 불변 = 차감/청구 경로 무접점
    expect(bloodChecked(rows)).toBe(false);
    expect(kohChecked(rows)).toBe(false);
    expect(rows.some((r) => r.service_id === null)).toBe(false); // 마커 없음
  });

  test('AC-3: 패키지 세션 마킹(is_package_session/package_session_id)은 플래그 복원과 무관하게 보존', () => {
    const rows: CisInsertRow[] = [{
      check_in_id: CI,
      service_id: 'svc-pkg',
      service_name: '패키지 시술',
      price: 0,
      original_price: 100000,
      is_package_session: true,
      package_session_id: 'psid-123',
    }];
    applyExamFlagsToReinsert(rows, CI, { blood: true, koh: false });
    expect(rows[0].is_package_session).toBe(true);
    expect(rows[0].package_session_id).toBe('psid-123');
    expect(rows[0].blood_test_requested).toBe(true); // 플래그도 함께 복원
  });

  test('멱등: 재저장(DELETE+reinsert)이 반복돼도 마커 누적 없음 — 매 저장 최대 1개', () => {
    // 각 재저장 사이클은 DELETE 로 시작하므로 baseRows 부터 다시 시작. 반복해도 마커 1개로 수렴.
    for (let i = 0; i < 3; i++) {
      const rows = baseRows(['레이저']); // KOH명 없음
      applyExamFlagsToReinsert(rows, CI, { blood: false, koh: true });
      expect(rows.filter((r) => r.service_id === null)).toHaveLength(1);
    }
  });

  test('엣지: 재저장 행 0 + 피검사 ON → 피검사 마커로 보존', () => {
    const rows = baseRows([]); // 빈 재저장
    applyExamFlagsToReinsert(rows, CI, { blood: true, koh: false });
    expect(bloodChecked(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].service_id).toBeNull();
  });
});
