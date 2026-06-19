/**
 * E2E spec — T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY (문지은 대표원장)
 * 진료대시보드(DoctorCallDashboard) 진료완료 섹션 — 귀가(discharged) 환자 처방/임상경과 영역의
 *   토글이 열리며 editable input 이 활성화되던 누수 close. 펼침(읽기)은 유지하되 작성·수정 진입만 차단.
 *
 * 배경: deployed 안전정책 T-20260609-QUICKRX-INCLINIC-GATE + T-20260611-DISCHARGED-DASH-RXMUTATE-LOCK
 *   의 누수 close(강화). 정책 역전 아님 — fail-closed 게이트를 UI 진입점에서도 한 번 더 막는다.
 *
 * 누수 진단(diff-first, planner read-only):
 *   · 처방 셀: 귀가는 이미 '-'(잠김) / RxConfirmedSummary 는 split 모드에서 cancellable=false → 연필 미렌더 → 펼침(읽기)만.
 *   · ⚠ 임상경과 빈값 '—' 셀: 귀가도 클릭 → setShowClinical(true) → MedicalChartPanel(editable) 인라인 오픈 = 본 누수.
 *
 * fix(DoctorCallDashboard.tsx, CompletedRow):
 *   (1) 임상경과 빈값 셀 — discharged 분기 신설 → 클릭 불가 readonly '<span>—</span>'(작성 진입점 제거).
 *   (2) 인라인 임상경과 편집행 — `showClinical && !discharged` 이중방어(editable input 미렌더, fail-closed).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(라이브 DB 비의존, className/구조 패턴 정밀 검증).
 * 실기기 시각 confirm(갤탭)은 supervisor 게이트.
 *
 * 시나리오 3종(티켓 본문):
 *   S1 (AC-1/AC-2/AC-3) 귀가 행 임상경과 작성 토글 차단 + readonly 텍스트 + disabled UX + 인라인 편집행 미렌더
 *   S2 (AC-4) 원내잔류(!discharged) 무회귀 — 빈값 작성 버튼·Rx popover·QuickRxBar 인라인 보존
 *   S3 (AC-5) 안전게이트 무접촉 — RxConfirmedSummary 귀가 연필 미렌더 + inClinicRxGate/rxMutationGuard fail-closed 판정 회귀 0
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

// 완료 섹션(CompletedRow)에서 임상경과 셀 td 블록만 잘라낸다(대기 섹션 CallFeedRow 와 격리).
function completedClinicalCellBlock(): string {
  const s = DASH();
  const start = s.indexOf('data-testid="doctor-completed-clinical-cell"');
  expect(start, '완료 섹션 임상경과 셀이 존재해야 함').toBeGreaterThan(-1);
  // 셀 td 닫힘 직후(인라인 편집행 직전)까지.
  const end = s.indexOf('doctor-completed-chart-inline-row', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// S1 (AC-1/AC-2/AC-3) — 귀가(discharged) 임상경과 작성 토글 차단 + readonly + disabled UX
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 귀가 임상경과 작성 진입 차단(readonly)', () => {
  // ⚠ T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS A안 supersede (문지은 대표원장 CONFIRM MSG-20260620-023304):
  //   "잠금유지하면서 차트는 열리게 해줘. 직접 차트 열어서 수정만 가능하게(귀가완료환자 기준)."
  //   → 귀가 빈값 임상경과는 readonly 데드가 아니라 1클릭 차트오픈 버튼(onOpenChart 'full')이 됐다.
  //     단 인플레이스 작성(setShowClinical→MedicalChartPanel embed editable)은 여전히 차단(수정은 풀차트 서랍 안에서만).
  test('AC-1(A안 supersede) — 귀가 빈값 임상경과는 인라인 작성(setShowClinical) 진입이 아니라 차트오픈 버튼(onOpenChart)', () => {
    const block = completedClinicalCellBlock();
    // discharged 분기가 신설되어 있다(빈값 셀에서 분기).
    expect(block).toContain('discharged ?');
    // A안: 차트오픈 진입 버튼 존재(onOpenChart 'full').
    expect(block).toContain('data-testid="doctor-completed-clinical-empty-chart-btn"');
    const btnIdx = block.indexOf('doctor-completed-clinical-empty-chart-btn');
    const btnScope = block.slice(btnIdx - 220, btnIdx + 160);
    // 인플레이스 작성 차단 무회귀 — 이 진입점은 setShowClinical 을 호출하지 않는다(차트 서랍만 연다).
    expect(btnScope).not.toContain('setShowClinical');
    expect(btnScope).toContain('onOpenChart');
  });

  test('AC-1 fail-closed — 인라인 임상경과 편집행(MedicalChartPanel)이 !discharged 게이트로 미렌더', () => {
    const s = DASH();
    // 완료 섹션 인라인 편집행은 showClinical && !discharged && customer_id 삼중 조건.
    expect(s).toContain('{showClinical && !discharged && checkIn.customer_id && (');
    // editable 패널은 여전히 variant clinical singleLine(원내잔류 작성 경로 보존) — 구현 자체는 유지.
    expect(s).toContain('variant="clinical"');
  });

  test('AC-2 — clinicalPreview(내용 있음) 펼침은 read-only 텍스트(editable input 아님)', () => {
    const s = DASH();
    // 완료 섹션 펼침 팝오버는 div(텍스트) — input/textarea/select 없음.
    const expIdx = s.indexOf('data-testid="doctor-completed-clinical-expand"');
    expect(expIdx).toBeGreaterThan(-1);
    const expScope = s.slice(expIdx - 200, expIdx + 200);
    expect(expScope).toContain('whitespace-pre-wrap');
    expect(expScope).not.toMatch(/<(input|textarea|select)\b/);
  });

  test('AC-3 — 차단된 readonly 진입점 disabled UX(회색 + cursor default + hover 효과 제거)', () => {
    const block = completedClinicalCellBlock();
    const readonlyIdx = block.indexOf('doctor-completed-clinical-empty-readonly');
    const spanScope = block.slice(readonlyIdx, readonlyIdx + 260);
    // 회색(text-gray-300) + cursor-default + select-none. hover 클래스 부재.
    expect(spanScope).toContain('text-gray-300');
    expect(spanScope).toContain('cursor-default');
    expect(spanScope).not.toContain('hover:');
    expect(spanScope).not.toContain('underline');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S2 (AC-4) — 원내잔류(!discharged) 무회귀: 작성/처방 동선 기존 그대로
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 원내잔류 무회귀(!discharged)', () => {
  test('AC-4 — 원내잔류 빈값 임상경과는 종전 작성 버튼(setShowClinical(true)) 보존', () => {
    const block = completedClinicalCellBlock();
    // !discharged 경로의 작성 진입 버튼이 그대로 존재(편집 흐름 무회귀).
    expect(block).toContain('data-testid="doctor-completed-clinical-empty-btn"');
    const btnIdx = block.indexOf('doctor-completed-clinical-empty-btn');
    const btnScope = block.slice(btnIdx - 200, btnIdx + 60);
    expect(btnScope).toContain('setShowClinical(true)');
  });

  test('AC-4 — 원내잔류 처방버튼 + QuickRxBar 인라인(처방 popover) 분기 보존', () => {
    const s = DASH();
    // !discharged 처방 popover/QuickRxBar 분기 유지.
    expect(s).toContain('!discharged ?');
    expect(s).toContain('data-testid="doctor-completed-rx-btn"');
    expect(s).toContain('<QuickRxBar');
    // 귀가 미처방은 여전히 '-'(잠김, 회귀 아님).
    expect(s).toContain('data-testid="doctor-completed-no-rx"');
  });

  test('AC-4 — 대기 섹션(CallFeedRow)은 discharged 개념 없음 → 빈값 작성 버튼 무변경', () => {
    const s = DASH();
    // 대기 섹션 빈값 임상경과 버튼은 종전 그대로(귀가 분기 비도입).
    expect(s).toContain('data-testid="doctor-call-clinical-empty-btn"');
    // 대기 섹션 셀 블록에 귀가 readonly span 이 침범하지 않음.
    const callStart = s.indexOf('data-testid="doctor-call-clinical-cell"');
    const callEnd = s.indexOf('doctor-call-chart-inline-row', callStart);
    const callBlock = s.slice(callStart, callEnd);
    expect(callBlock).not.toContain('doctor-completed-clinical-empty-readonly');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S3 (AC-5) — 안전게이트 무접촉: RxConfirmedSummary 귀가 처리 + 게이트 판정 회귀 0
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 안전게이트 무접촉(AC-5)', () => {
  test('AC-5 — RxConfirmedSummary split 모드: 귀가(blockedByGate)면 연필(빠른수정 진입) 미렌더', () => {
    const q = QUICKRX();
    // cancellable = doctorMode && checkInId && !blockedByGate → 귀가는 false → 연필 {cancellable && (...)} 미렌더.
    expect(q).toContain('const cancellable = doctorMode && !!checkInId && !blockedByGate;');
    expect(q).toContain('{cancellable && (');
    // 귀가는 펼침(읽기)·차트 진입 동선만 — '차트에서 수정' 안내 유지.
    expect(q).toContain('{blockedByGate && onOpenChart && (');
    expect(q).toContain('data-testid="rx-cancel-open-chart"');
  });

  test('AC-5 — DoctorCallDashboard 가 RxConfirmedSummary 에 귀가 게이트 컨텍스트 prop 전달(LOCK 보존)', () => {
    const s = DASH();
    // 게이트 판정 입력(checkInStatus/checkInFlag/checkedInAt)이 전달되어야 blockedByGate 판정 성립.
    expect(s).toContain('checkInStatus={checkIn.status}');
    expect(s).toContain('checkInFlag={checkIn.status_flag}');
    expect(s).toContain('checkedInAt={checkIn.checked_in_at}');
  });

  test('AC-5 — inClinicRxGate fail-closed 판정 회귀 0(귀가 차단 / 원내잔류 허용)', () => {
    const TODAY = '2026-06-16';
    const TODAY_KST = '2026-06-16T00:30:00Z'; // KST 09:30 당일
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

  test('AC-5 — rxMutationGuard 차단 에러 변환(IN_CLINIC_GATE) 회귀 0', () => {
    const err = rxGateError('discharged');
    expect(err.code).toBe(IN_CLINIC_GATE_CODE);
    expect(err.message).toContain('귀가');
    expect(err.message).toContain('차트');
  });
});
