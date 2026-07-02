/**
 * E2E spec — T-20260702-foot-PKG-CREATE-CHECKIN-GATE-REMOVE
 * 미체크인(내원 전) 고객에 대한 '패키지 생성' 차단(요청 안 한 check-in precondition) 제거 검증.
 *
 * 배경(김주연 총괄): 직원/실장(상위 role) 공통으로 "고객이 체크인(내원) 안 된 상태"면
 *   고객관리 컨텍스트 메뉴 [수납]이 '대시보드에서 해당 환자 체크인 후 수납해주세요' 토스트만
 *   띄우고 닫히는 dead-end → 미내원 고객에 결제·패키지 등록 자체가 막힘.
 *   실장(상위 role)까지 막힘 = role/RLS 아님 = 전역 check-in precondition 게이트.
 *   계좌이체 선결제 → 미내원 패키지 생성이 정상 업무 → 그 게이트 제거.
 *
 * fix: 고객관리 컨텍스트 메뉴 [수납] → 고객차트(onOpenChart) 오픈으로 연결.
 *   차트의 '구입 티켓 추가'(PackagePurchaseFromTemplateDialog)는 packages를
 *   clinic_id + customer_id 로 insert(= check_in FK 없음) → 체크인 비종속.
 *
 * 본 spec은 소스단언(regression guard) — prod DB 오염 방지 위해 실제 패키지 insert는 하지 않음.
 * (실 동선 확인은 supervisor 필드 검증 + 시나리오 가이드 참조)
 *
 * 시나리오 1: 미체크인 고객 [수납] dead-end 제거 + 차트 오픈 경로 연결
 * 시나리오 2: 차트 패키지 생성 insert에 check_in_id 없음 (체크인 비종속 · 데이터 무결)
 * 시나리오 3(무회귀): 예약건 수납 게이트('체크인 후 수납')는 유지 (가짜 check_in 결제 방지)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260702-foot-PKG-CREATE-CHECKIN-GATE-REMOVE', () => {
  test('시나리오 1: 고객관리 [수납] dead-end 제거 + 차트 오픈 경로 연결', () => {
    const src = SRC('pages/Customers.tsx');

    // CustomerContextMenu 4번 [수납] 핸들러 영역 추출 (아이콘 CreditCard 로 위치 고정)
    const suapAnchor = src.indexOf('T-20260702-foot-PKG-CREATE-CHECKIN-GATE-REMOVE');
    expect(suapAnchor, '수납 핸들러 fix 앵커 존재').toBeGreaterThan(-1);
    const handlerSlice = src.slice(suapAnchor, suapAnchor + 900);

    // (a) dead-end 토스트 제거: '체크인 후 수납해주세요' 류 차단 문구가 [수납] 핸들러에 없음
    expect(handlerSlice.includes('대시보드에서 해당 환자 체크인 후 수납해주세요'),
      '요청 안 한 check-in precondition dead-end 토스트 제거됨').toBe(false);

    // (b) 차트 오픈 경로 연결: onOpenChart(customer) 호출로 결제·패키지 등록 진입 제공
    expect(handlerSlice.includes('onOpenChart(customer)'),
      '[수납] → 고객차트(결제·패키지 등록) 오픈 경로 연결').toBe(true);
  });

  test('시나리오 2: 차트 패키지 생성 insert = check-in 비종속(check_in_id 없음) · 데이터 무결', () => {
    const src = SRC('pages/CustomerChartPage.tsx');

    // PackagePurchaseFromTemplateDialog 정의 이후 packages insert 블록 검사
    const dlgIdx = src.indexOf('function PackagePurchaseFromTemplateDialog');
    expect(dlgIdx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
    const dlgSlice = src.slice(dlgIdx, dlgIdx + 8000);

    const pkgInsertIdx = dlgSlice.indexOf(".from('packages').insert({");
    expect(pkgInsertIdx, '패키지 생성 insert 존재').toBeGreaterThan(-1);
    const insertBlock = dlgSlice.slice(pkgInsertIdx, pkgInsertIdx + 1200);

    // 체크인 비종속: insert payload에 check_in_id 없음
    expect(insertBlock.includes('check_in_id'),
      '패키지 생성 insert 에 check_in_id 없음 (체크인 비종속)').toBe(false);
    // 데이터 무결: clinic_id + customer_id 로 지점·고객 정상 연결
    expect(insertBlock.includes('clinic_id'), '패키지 → 지점(clinic_id) 연결 유지').toBe(true);
    expect(insertBlock.includes('customer_id'), '패키지 → 고객(customer_id) 연결 유지').toBe(true);
  });

  test('시나리오 3(무회귀): 예약건 수납 게이트는 유지 (가짜 check_in 결제 방지)', () => {
    // 예약(미체크인)에서 '수납'은 정당한 게이트 — check_in 조회 후에만 결제, 없으면 안내.
    // 이는 패키지 생성 게이트와 별개이며 제거 대상 아님.
    const resv = SRC('pages/Reservations.tsx');
    expect(resv.includes('체크인 후 수납이 가능합니다'),
      '예약건 수납 게이트 유지 (가짜 check_in 결제 방지 — 무회귀)').toBe(true);

    const dash = SRC('pages/Dashboard.tsx');
    expect(dash.includes('체크인 후 수납이 가능합니다'),
      '대시보드 예약 수납 게이트 유지 (무회귀)').toBe(true);
  });
});
