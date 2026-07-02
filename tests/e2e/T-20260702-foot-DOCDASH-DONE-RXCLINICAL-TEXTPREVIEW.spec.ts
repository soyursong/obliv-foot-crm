/**
 * E2E spec — T-20260702-foot-DOCDASH-DONE-RXCLINICAL-TEXTPREVIEW (문지은 대표원장)
 *
 * 현장 원문 (2026-07-02, #foot):
 *   "진료 대시보드에서 진료완료 된 환자의 처방이나 임상경과 텍스트로 다 미리보게 해줘.
 *    수정이 안된다는 거지 차트보기 버튼으로 대체하라는 게 아님. 이해했어?"
 *
 * 요지: 진료완료(완료계열) 환자 행의 처방·임상경과 '내용'을 '차트 열기/차트보기' 버튼 뒤에 숨기지 말고
 *   셀에 읽기전용 텍스트로 인라인 노출. 편집만 막고(안전게이트 유지) 표시는 연다.
 *
 * ★ absorb-on-baseline (planner MSG-…-4ixw): 선행 T-20260616-DISCHARGED(commit 7f8fe9b6, 미배포 HOLD)의
 *   프롬넌트 '차트 열기' chip 을 baseline 삼아, 그 위에서 chip → 보조 진입점(읽기전용 '-'/'—' + 클릭 시
 *   진료차트 readonly 오픈)으로 강등하고 내용 셀은 읽기전용 텍스트 프리뷰로 노출한다. 단일 커밋 병합.
 *   → 본 spec 이 선행 DISCHARGED spec S3(프롬넌트 chip 요구)를 supersede.
 *
 * ★ 안전게이트 무접촉(AC③): inClinicRxGate / rxMutationGuard / RX-TOGGLE-READONLY(fail-closed).
 *   편집 경로 신설 0 — 표시(읽기)만 추가.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(라이브 DB 비의존).
 * 실기기 시각 confirm(갤탭)은 supervisor 게이트.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';

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

// testid 를 가진 <button ...>...</button> 요소 전체(여는 태그 속성 + 본문)를 잘라낸다.
//   onClick/className 등 data-testid 앞 속성까지 포함하도록 직전 '<button' 부터 캡처.
function fullButton(block: string, testid: string): string {
  const anchor = block.indexOf(`data-testid="${testid}"`);
  expect(anchor, `${testid} 진입점이 존재해야 함`).toBeGreaterThan(-1);
  const open = block.lastIndexOf('<button', anchor);
  expect(open).toBeGreaterThan(-1);
  const close = block.indexOf('</button>', anchor);
  expect(close).toBeGreaterThan(anchor);
  return block.slice(open, close + '</button>'.length);
}
// 여는 태그 닫힘('>' — onClick 화살표 '=>' 회피 위해 </button> 직전 마지막 '>') 이후 children(본문)만.
function buttonBody(block: string, testid: string): string {
  const full = fullButton(block, testid);
  const closeTag = full.indexOf('</button>');
  const gt = full.lastIndexOf('>', closeTag - 1);
  return full.slice(gt + 1, closeTag);
}

// ═══════════════════════════════════════════════════════════════════════════
// S1 — 내용 있는 셀: 처방·임상경과가 읽기전용 텍스트 프리뷰로 인라인 노출 (AC①②)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 완료 환자 처방·임상경과 텍스트 프리뷰', () => {
  test('S1-a — 확정 처방은 셀에 읽기전용 약명 텍스트(RxConfirmedSummary plainText)로 인라인 노출', () => {
    const block = completedRxCellBlock();
    // 확정처방 분기가 최우선 — 버튼 뒤가 아니라 RxConfirmedSummary 로 내용 표시.
    expect(block).toContain("checkIn.prescription_status === 'confirmed'");
    expect(block).toContain('<RxConfirmedSummary');
    expect(block).toContain('plainText');
    // RxConfirmedSummary 는 약 요약을 파란 텍스트(sky-600)로 렌더(내용 노출) — QuickRxBar 소스에서 검증.
    const q = QUICKRX();
    expect(q).toContain('data-testid="rx-confirmed-drugs"');
    expect(q).toContain('text-sky-600');
  });

  test('S1-b — 임상경과 내용은 셀에 truncate 텍스트(clinicalPreview)로 인라인 노출', () => {
    const block = completedClinicalCellBlock();
    // clinicalPreview 있으면 truncate 텍스트 프리뷰 버튼으로 본문 노출.
    expect(block).toContain('clinicalPreview ?');
    const scope = fullButton(block, 'doctor-completed-clinical-expand-btn');
    expect(scope).toContain('truncate');
    expect(scope).toContain('{clinicalPreview}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S2 — 버튼 대체 금지: 프롬넌트 '차트 열기' chip 강등, 빈값 '-'/'—', 차트진입 보조 유지 (AC④⑥)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 차트보기 버튼 대체 금지 + 빈값 처리', () => {
  test('S2-a — 빈 셀 진입점 어디에도 프롬넌트 \'차트 열기\' 라벨/아이콘 chip 이 남아있지 않음(강등)', () => {
    // 진입점 요소 자체(주석 제외)에 프롬넌트 chip 흔적이 없다.
    const rxBtn = fullButton(completedRxCellBlock(), 'doctor-completed-no-rx');
    expect(rxBtn).not.toContain('차트 열기');
    expect(rxBtn).not.toContain('<FileText');
    expect(rxBtn).not.toContain('bg-sky-50');
    const clinicalBtn = fullButton(completedClinicalCellBlock(), 'doctor-completed-clinical-empty-chart-btn');
    expect(clinicalBtn).not.toContain('차트 열기');
    expect(clinicalBtn).not.toContain('<FileText');
    expect(clinicalBtn).not.toContain('bg-sky-50');
  });

  test('S2-b — 귀가·미처방 처방셀 = 읽기전용 \'-\'(AC⑥), 클릭 시 진료차트 readonly 오픈 보조(AC④)', () => {
    const btn = fullButton(completedRxCellBlock(), 'doctor-completed-no-rx');
    // 빈값 표기 '-' (본문이 '-').
    expect(buttonBody(completedRxCellBlock(), 'doctor-completed-no-rx').trim()).toBe('-');
    // 보조 진입점: readonly(discharged) 로 차트 오픈 — 폐기 아님.
    expect(btn).toContain("onOpenChart(checkIn.customer_id, 'full', discharged)");
  });

  test('S2-c — 귀가 빈값 임상경과셀 = 읽기전용 \'—\'(AC⑥), 클릭 시 진료차트 readonly 오픈 보조(AC④)', () => {
    const btn = fullButton(completedClinicalCellBlock(), 'doctor-completed-clinical-empty-chart-btn');
    expect(buttonBody(completedClinicalCellBlock(), 'doctor-completed-clinical-empty-chart-btn').trim()).toBe('—');
    expect(btn).toContain("onOpenChart(checkIn.customer_id, 'full', discharged)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S3 — 읽기전용 보장 + 안전게이트 무회귀 (AC③)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 읽기전용 보장 + 안전게이트 무회귀', () => {
  test('S3-a — 귀가(discharged) 확정처방은 인플레이스 편집 비활성(editableBodyClick={!discharged})', () => {
    const block = completedRxCellBlock();
    // 귀가면 본문클릭=읽기 펼침(onToggleExpand), 편집 드롭다운 미개방.
    expect(block).toContain('editableBodyClick={!discharged}');
    expect(block).toContain('onToggleExpand={() => setExpandRx((v) => !v)}');
  });

  test('S3-b — 귀가 빈 처방셀 진입점에 인플레이스 mutate(QuickRxBar/setShowRx) 미노출(잠금 무회귀)', () => {
    const scope = fullButton(completedRxCellBlock(), 'doctor-completed-no-rx');
    expect(scope).not.toContain('<QuickRxBar');
    expect(scope).not.toContain('setShowRx');
  });

  test('S3-c — 귀가 빈 임상경과 진입점은 차트 readonly 오픈만(인라인 작성 setShowClinical 미사용)', () => {
    const scope = fullButton(completedClinicalCellBlock(), 'doctor-completed-clinical-empty-chart-btn');
    expect(scope).not.toContain('setShowClinical');
  });

  test('S3-d — 인플레이스 처방 mutate 게이트(checkRxInClinic) 무회귀: 귀가=차단, 원내잔류=허용', () => {
    const TODAY = '2026-07-02';
    const TODAY_KST = '2026-07-02T00:30:00Z'; // KST 09:30 당일
    // 귀가(수납완료, status='done') — 인플레이스 처방 mutate 차단(fail-closed) 유지.
    const dis = checkRxInClinic({ status: 'done', checked_in_at: TODAY_KST }, TODAY);
    expect(dis.allowed).toBe(false);
    expect(dis.reason).toBe('discharged');
    // 원내 잔류(진료완료 pink) — 처방 허용(무회귀).
    const stay = checkRxInClinic(
      { status: 'treatment_waiting', status_flag: 'pink', checked_in_at: TODAY_KST },
      TODAY,
    );
    expect(stay.allowed).toBe(true);
  });
});
