/**
 * E2E spec — T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS (문지은 대표원장 CONFIRM, A안)
 *
 * A안 확정 (MSG-20260620-023304-oyu3 item4):
 *   "잠금유지하면서 차트는 열리게 해줘. 직접 차트 열어서 수정만 가능하게 (귀가완료환자 기준)."
 *
 * 진료대시보드(DoctorCallDashboard) 진료완료 섹션 — 귀가(status='done', discharged) 환자 행의
 *   처방/임상경과 진입점을 '데드버튼·숨김으로 찾아 들어가야 하던' 동선 대신
 *   **클릭 시 진료차트(MedicalChartPanel '서랍')가 1클릭으로 바로 열림**으로 통일.
 *   수정은 차트 내부에서만. 대시보드 인플레이스 처방 mutate(apply/cancel/confirm)는 여전히 차단.
 *
 * ★ 안전게이트 무회귀(reporter "잠금유지" 명시 조건):
 *   T-20260609-QUICKRX-INCLINIC-GATE / T-20260611-DISCHARGED-DASH-RXMUTATE-LOCK /
 *   T-20260616-DISCHARGED-DASH-RX-TOGGLE-READONLY 의 fail-closed 게이트(inClinicRxGate/rxMutationGuard) 무접촉.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(라이브 DB 비의존, 구조/패턴 정밀 검증).
 * 실기기 시각 confirm(갤탭)은 supervisor 게이트.
 *
 * 현장 클릭 시나리오 A안 2종(티켓 본문):
 *   S1 귀가 행 클릭 → 진료차트 1클릭 오픈(처방 '-'/임상경과 '—' 진입점이 onOpenChart 'full' 호출)
 *   S2 인플레이스 mutate 차단 유지(귀가 잠금 무회귀 — 게이트/연필/QuickRxBar in-place apply 미노출)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';
import { rxGateError, IN_CLINIC_GATE_CODE } from '../../src/lib/rxMutationGuard';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const QUICKRX = () => SRC('components/doctor/QuickRxBar.tsx');

// 완료 섹션(CompletedRow) 처방 셀 td 블록만 잘라낸다(대기 섹션 CallFeedRow 와 격리).
function completedRxCellBlock(): string {
  const s = DASH();
  const start = s.indexOf('data-testid="doctor-completed-rx-cell"');
  expect(start, '완료 섹션 처방 셀이 존재해야 함').toBeGreaterThan(-1);
  const end = s.indexOf('doctor-completed-clinical-cell', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
}

// 완료 섹션 임상경과 셀 td 블록만 잘라낸다(인라인 편집행 직전까지).
function completedClinicalCellBlock(): string {
  const s = DASH();
  const start = s.indexOf('data-testid="doctor-completed-clinical-cell"');
  expect(start, '완료 섹션 임상경과 셀이 존재해야 함').toBeGreaterThan(-1);
  const end = s.indexOf('doctor-completed-chart-inline-row', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// S1 — 귀가 행 클릭 → 진료차트 1클릭 오픈 (데드 동선 → onOpenChart 'full')
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 귀가 행 1클릭 차트오픈', () => {
  test('S1-a — 귀가·미처방 처방셀이 정적 데드텍스트가 아니라 차트오픈 버튼(onOpenChart \'full\')', () => {
    const block = completedRxCellBlock();
    // 귀가 미처방 진입점 testid 유지(no-rx), 단 이제 <button onClick=onOpenChart>.
    expect(block).toContain('data-testid="doctor-completed-no-rx"');
    const idx = block.indexOf('data-testid="doctor-completed-no-rx"');
    const scope = block.slice(idx - 260, idx + 120);
    // 클릭 시 진료차트('full') 오픈 — 데드텍스트(클릭 불가)가 아님.
    expect(scope).toContain('onOpenChart(checkIn.customer_id, \'full\')');
    // 인플레이스 처방 작성(QuickRxBar 컴포넌트)을 이 진입점에서 렌더하지 않는다.
    expect(scope).not.toContain('<QuickRxBar');
    expect(scope).not.toContain('setShowRx');
  });

  test('S1-b — 귀가 빈값 임상경과가 차트오픈 버튼(onOpenChart \'full\'), 인라인 작성(setShowClinical) 아님', () => {
    const block = completedClinicalCellBlock();
    expect(block).toContain('discharged ?');
    expect(block).toContain('data-testid="doctor-completed-clinical-empty-chart-btn"');
    const idx = block.indexOf('doctor-completed-clinical-empty-chart-btn');
    const scope = block.slice(idx - 240, idx + 160);
    expect(scope).toContain('onOpenChart(checkIn.customer_id, \'full\')');
    // 차트오픈만 — 인플레이스 작성 토글(setShowClinical) 미사용.
    expect(scope).not.toContain('setShowClinical');
  });

  test('S1-c — 확정 처방(RxConfirmedSummary) 귀가 행은 \'차트에서 수정\' 진입(onOpenChart)으로 일관', () => {
    const q = QUICKRX();
    // 귀가(blockedByGate)면 펼침(읽기) + 차트 진입 동선만 — 차트오픈 버튼 노출.
    expect(q).toContain('{blockedByGate && onOpenChart && (');
    expect(q).toContain('data-testid="rx-cancel-open-chart"');
    // DoctorCallDashboard 가 RxConfirmedSummary 에 onOpenChart('full') 를 전달.
    const s = DASH();
    const rxConfIdx = s.indexOf('<RxConfirmedSummary');
    expect(rxConfIdx).toBeGreaterThan(-1);
    const rxConfScope = s.slice(rxConfIdx, rxConfIdx + 900);
    expect(rxConfScope).toContain("onOpenChart={() => checkIn.customer_id && onOpenChart(checkIn.customer_id, 'full')}");
  });

  test('S1-d — customer_id 결측 시 차트 진입 불가 → 종전 readonly(클릭 불가) 폴백 유지', () => {
    const clinicalBlock = completedClinicalCellBlock();
    // 차트 버튼은 customer_id 가드(checkIn.customer_id ? button : span).
    expect(clinicalBlock).toContain('checkIn.customer_id ? (');
    // 결측 폴백은 readonly span 유지(클릭 불가 — 데이터 부재로 차트 못 엶).
    expect(clinicalBlock).toContain('data-testid="doctor-completed-clinical-empty-readonly"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S2 — 인플레이스 mutate 차단 유지 (귀가 잠금 무회귀, reporter "잠금유지")
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 인플레이스 처방 mutate 차단 유지(귀가 잠금)', () => {
  test('S2-a — 귀가 행 처방 인플레이스 작성(QuickRxBar popover)은 !discharged 분기에서만 렌더', () => {
    const block = completedRxCellBlock();
    // QuickRxBar(인플레이스 처방 입력)는 !discharged 가지에만 존재. 귀가는 도달 불가.
    expect(block).toContain('!discharged ?');
    expect(block).toContain('<QuickRxBar');
    const rxBtnIdx = block.indexOf('data-testid="doctor-completed-rx-btn"');
    const noRxIdx = block.indexOf('data-testid="doctor-completed-no-rx"');
    // 처방 버튼(QuickRxBar 진입)은 no-rx(귀가 차트버튼)보다 앞(=!discharged 가지)에 위치.
    expect(rxBtnIdx).toBeGreaterThan(-1);
    expect(rxBtnIdx).toBeLessThan(noRxIdx);
  });

  test('S2-b — 귀가 인라인 임상경과 편집행(MedicalChartPanel editable)은 !discharged 게이트로 미렌더(fail-closed)', () => {
    const s = DASH();
    expect(s).toContain('{showClinical && !discharged && checkIn.customer_id && (');
  });

  test('S2-c — RxConfirmedSummary split: 귀가(blockedByGate)면 연필(빠른수정/취소) 미렌더', () => {
    const q = QUICKRX();
    expect(q).toContain('const cancellable = doctorMode && !!checkInId && !blockedByGate;');
    // 연필(빠른수정 진입)은 cancellable 일 때만 렌더 → 귀가는 false.
    expect(q).toContain('{cancellable && (');
  });

  test('S2-d — inClinicRxGate fail-closed 판정 회귀 0 (귀가 차단 / 원내잔류 허용 / 누락 차단)', () => {
    const TODAY = '2026-06-20';
    const TODAY_KST = '2026-06-20T00:30:00Z'; // KST 09:30 당일
    // 귀가(done) → 차단.
    const dis = checkRxInClinic({ status: 'done', checked_in_at: TODAY_KST }, TODAY);
    expect(dis.allowed).toBe(false);
    expect(dis.reason).toBe('discharged');
    // 원내잔류(pink, status 미done) → 허용(무회귀).
    const stay = checkRxInClinic({ status: 'treatment_waiting', status_flag: 'pink', checked_in_at: TODAY_KST }, TODAY);
    expect(stay.allowed).toBe(true);
    // 정보 누락 → fail-closed.
    expect(checkRxInClinic({ status: 'treatment_waiting' }, TODAY).allowed).toBe(false);
  });

  test('S2-e — rxMutationGuard 차단 에러 변환(IN_CLINIC_GATE) 회귀 0', () => {
    const err = rxGateError('discharged');
    expect(err.code).toBe(IN_CLINIC_GATE_CODE);
    expect(err.message).toContain('귀가');
    expect(err.message).toContain('차트');
  });
});
