/**
 * E2E spec — T-20260620-foot-DOCDASH-RXCLIN-PREVIEW-DROPDOWN (문지은 대표원장, #foot, 2026-06-20 14:04)
 *
 * 재구현 3축:
 *   축1 — 처방·임상경과 셀: 내용 미리보기(truncate) + 드롭다운 전문(ColumnExpandPopover). 귀가/비귀가 공통. (기존 보존)
 *   축2 — ★신규★ 차트(이름 클릭 진입)는 귀가완료(discharged) 환자'만' 수정 불가(완전 readonly).
 *          진입점(1클릭 차트오픈)은 유지(AC-8), 차트 내부 편집만 차단.
 *   축3 — 비귀가(원내잔류)는 진료대시보드 테이블뷰 인라인 즉시수정(기존 보존).
 *
 * supersede: T-20260616-RX-CHART-ACCESS '차트 열어 수정만 가능' → '차트에서도 수정 불가(귀가완료)'.
 *   진입점·대시보드 인플레이스 차단·서버 fail-closed 게이트(inClinicRxGate/rxMutationGuard)는 무회귀.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/RX-CHART-ACCESS spec 컨벤션 동일(라이브 DB 비의존).
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
const CHART = () => SRC('components/MedicalChartPanel.tsx');

// CompletedRow(진료완료 섹션) 함수 블록만 잘라낸다 — CallFeedRow(대기/원내잔류)와 격리.
function completedRowBlock(): string {
  const s = DASH();
  const start = s.indexOf('function CompletedRow(');
  expect(start, 'CompletedRow 함수가 존재해야 함').toBeGreaterThan(-1);
  return s.slice(start);
}
// CallFeedRow(진료대기/원내잔류 섹션) 함수 블록만 잘라낸다(CompletedRow 시작 전까지).
function callFeedRowBlock(): string {
  const s = DASH();
  const start = s.indexOf('function CallFeedRow(');
  const end = s.indexOf('function CompletedRow(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// 축2 / AC-3 — 귀가완료(discharged) 환자 차트 = 완전 읽기전용
// ═══════════════════════════════════════════════════════════════════════════
test.describe('축2 귀가완료 차트 readonly', () => {
  test('AC-3a — openTreatmentChart 가 readOnly 인자를 받아 medicalChartReadOnly 상태로 전달', () => {
    const s = DASH();
    expect(s).toContain('const [medicalChartReadOnly, setMedicalChartReadOnly]');
    expect(s).toMatch(/openTreatmentChart\s*=\s*\(customerId: string, variant[^)]*readOnly = false\)/);
    expect(s).toContain('setMedicalChartReadOnly(readOnly)');
  });

  test('AC-3b — MedicalChartPanel(부모 렌더)에 readOnly={medicalChartReadOnly} 배선', () => {
    const s = DASH();
    expect(s).toContain('readOnly={medicalChartReadOnly}');
  });

  test('AC-3c — 차트 닫을 때 readOnly 초기화(다음 환자 잔여 잠금 상속 방지)', () => {
    const s = DASH();
    // onOpenChange 닫힘 핸들러에 setMedicalChartReadOnly(false) 존재
    expect(s).toContain('setMedicalChartReadOnly(false)');
  });

  test('AC-3d — MedicalChartPanel: readOnly=true 면 [수정] 진입 버튼 숨김 + readonly-locked 인디케이터 노출', () => {
    const c = CHART();
    expect(c).toContain('data-testid="medical-chart-readonly-locked"');
    // 저장/수정 버튼 블록 최상단 분기가 readOnly 우선 → [수정] 진입 차단
    const block = c.slice(c.indexOf('저장/수정 버튼'));
    const lockedIdx = block.indexOf('medical-chart-readonly-locked');
    const editIdx = block.indexOf('medical-chart-edit-btn');
    expect(lockedIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeGreaterThan(-1);
    // readonly-locked 분기가 [수정] 버튼보다 앞(우선) — readOnly 면 edit-btn 도달 불가
    expect(lockedIdx).toBeLessThan(editIdx);
  });

  test('AC-3e — addRxItems: 호출자 강제 readOnly 면 처방 적재 차단 안내(편집 진입 유도 X)', () => {
    const c = CHART();
    expect(c).toContain('읽기전용 차트예요 — 처방을 추가할 수 없어요');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-8 / 축2 — 진입점 유지: 귀가 행도 이름/차트열기 클릭 시 차트 오픈(단 discharged 전달)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-8 귀가 행 차트 진입점 유지 + discharged readonly 전달', () => {
  test('AC-8a — CompletedRow 의 차트오픈 호출은 discharged 플래그를 3번째 인자로 전달', () => {
    const block = completedRowBlock();
    // 이름 클릭 + 처방완료(RxConfirmedSummary) + 귀가 처방셀 차트열기 + 귀가 임상경과 차트열기 = 4종 모두 discharged 전달
    const matches = block.match(/onOpenChart\(checkIn\.customer_id, 'full', discharged\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  test('AC-8b — discharged 판정은 inClinicRxGate SSOT(checkRxInClinic reason==="discharged") 재사용(신설 금지)', () => {
    const block = completedRowBlock();
    expect(block).toContain('checkRxInClinic(');
    expect(block).toContain("dischargeGate.reason === 'discharged'");
    // SSOT 동작 검증 — status='done' = 귀가(discharged)
    const today = '2026-06-20';
    expect(
      checkRxInClinic({ status: 'done', checked_in_at: `${today}T01:00:00+09:00` }, today).reason,
    ).toBe('discharged');
    // 원내잔류(active)는 discharged 아님 → readonly 미적용
    expect(
      checkRxInClinic({ status: 'examination', checked_in_at: `${today}T01:00:00+09:00` }, today).allowed,
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 / AC-5 무회귀 — 비귀가(원내잔류)는 차트 readonly 아님 + 대시보드 인라인 수정 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4/AC-5 비귀가 무회귀', () => {
  test('AC-4a — CallFeedRow(원내잔류) 차트오픈은 readOnly 인자 미전달(=false 기본, 수정 가능)', () => {
    const block = callFeedRowBlock();
    // CallFeedRow 환자는 절대 discharged 아님 → discharged/true 전달 0건
    expect(block).not.toContain("onOpenChart(checkIn.customer_id, 'full', discharged)");
    expect(block).not.toContain("onOpenChart(checkIn.customer_id, 'full', true)");
    // 기존 2-인자 차트오픈은 유지(수정 가능 = 무회귀)
    expect(block).toContain("onOpenChart(checkIn.customer_id, 'full')");
  });

  test('AC-5a — 비귀가(!discharged) QuickRxBar 인라인 처방(대시보드 인플레이스 수정) 분기 보존', () => {
    const block = completedRowBlock();
    expect(block).toContain('<QuickRxBar');
    expect(block).toContain('!discharged ?');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 축1 무회귀 — 처방·임상경과 셀 미리보기 + 드롭다운 전문(귀가/비귀가 공통)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('축1 미리보기+드롭다운 전문 보존', () => {
  test('AC-1/AC-2 — truncate 미리보기 + ColumnExpandPopover(컬럼 폭 전문) 보존', () => {
    const s = DASH();
    // 임상경과 미리보기 truncate(말줄임) 버튼
    expect(s).toContain('doctor-completed-clinical-expand-btn');
    expect(s).toMatch(/truncate/);
    // 처방/임상경과 전문 드롭다운(컬럼 폭 앵커)
    expect(s).toContain('ColumnExpandPopover');
    expect(s).toContain('doctor-completed-rx-expand-pop');
    expect(s).toContain('doctor-completed-clinical-expand-pop');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-7 안전게이트 무접촉 — inClinicRxGate / rxMutationGuard 회귀 0
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-7 안전게이트 무접촉', () => {
  test('AC-7a — DoctorCallDashboard inClinicRxGate(checkRxInClinic) import·사용 유지', () => {
    const s = DASH();
    expect(s).toContain('checkRxInClinic');
    expect(s).toContain('inClinicRxGate');
  });

  test('AC-7b — QuickRxBar 인플레이스 처방은 surface 귀속(audit) prop 유지(잠금 무회귀)', () => {
    const block = completedRowBlock();
    expect(block).toContain('surface="doctor_call_dashboard"');
  });
});
