/**
 * E2E spec — T-20260624-foot-DOCDASH-RXCLIN-DROPDOWN-EDIT-STATE (문지은 대표원장, #foot, "수정빨리")
 *
 * ★ DEDUP/CANONICAL: 본 티켓은 同일자 선행 티켓
 *   T-20260624-foot-DOCDASH-RXCLIN-DISCHARGE-PREVIEW-EDIT-GATE (deployed 49f1793b) 와
 *   동일 reporter("수정빨리") 요청을 다른 티켓ID로 재기술한 것이다.
 *   기능 코드(DoctorCallDashboard CompletedRow + QuickRxBar.RxConfirmedSummary splitMode)는
 *   旣 배포·라이브 — 본 spec 은 신규 코드 델타 없이 4 AC 불변식을 본 티켓ID 회귀앵커로 재고정한다.
 *   상세 시나리오(S1/S2/S3 12 case)는 canonical spec(...DISCHARGE-PREVIEW-EDIT-GATE.spec.ts) 참조.
 *
 * AC 매핑(요청):
 *   AC-1 귀가완료(discharged): 미리보기 → 클릭 시 read-only 전체보기 펼침(편집 input 없음).
 *   AC-2 비귀가(원내잔류): 미리보기 → 클릭 시 편집 가능 드롭다운 바로 open(별도 편집클릭 없이 즉시 수정).
 *   AC-3 안전게이트(inClinicRxGate/rxMutationGuard fail-closed) 무접촉·무회귀.
 *   AC-4 귀가완료 차트(이름클릭 진입) readonly 무회귀.
 *
 * 정적 소스 검증 스타일(인접 RXCLIN spec 컨벤션 동일). 실기기 시각 confirm(갤탭)=supervisor 게이트.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const QUICKRX = () => SRC('components/doctor/QuickRxBar.tsx');

function completedRowBlock(): string {
  const s = DASH();
  const start = s.indexOf('function CompletedRow(');
  expect(start, 'CompletedRow 함수가 존재해야 함').toBeGreaterThan(-1);
  return s.slice(start);
}
function rxSplitRenderBlock(): string {
  const s = QUICKRX();
  const start = s.indexOf('if (splitMode) {');
  expect(start, 'splitMode 렌더 분기가 존재해야 함').toBeGreaterThan(-1);
  return s.slice(start);
}

test.describe('AC-1 귀가완료 = 미리보기 → read-only 전체보기 펼침(편집 input 없음)', () => {
  test('AC-1a — 임상경과: discharged → setExpandClinical(읽기 펼침), 편집 위젯 미포함', () => {
    const block = completedRowBlock();
    expect(block).toContain('doctor-completed-clinical-expand-btn');
    expect(block).toMatch(/if \(discharged\) setExpandClinical/);
    const popIdx = block.indexOf('doctor-completed-clinical-expand-pop');
    expect(popIdx).toBeGreaterThan(-1);
    const popBlock = block.slice(popIdx, popIdx + 600);
    expect(popBlock).toContain('whitespace-pre-wrap'); // 읽기전용 텍스트
    expect(popBlock).not.toContain('MedicalChartPanel'); // 편집 위젯 없음
  });
  test('AC-1b — 처방: discharged → editableBodyClick=false → 읽기 펼침(onToggleExpand→expandRx)', () => {
    const block = completedRowBlock();
    expect(block).toContain('editableBodyClick={!discharged}');
    expect(block).toContain('onToggleExpand={() => setExpandRx((v) => !v)}');
  });
});

test.describe('AC-2 비귀가(원내잔류) = 미리보기 → 편집 드롭다운 바로 open', () => {
  test('AC-2a — 임상경과: !discharged → setShowClinical(true) 인라인 편집(그 자리 수정·저장)', () => {
    const block = completedRowBlock();
    expect(block).toMatch(/else if \(checkIn\.customer_id\) setShowClinical\(true\)/);
    expect(block).toContain('aria-expanded={discharged ? expandClinical : showClinical}');
  });
  test('AC-2b — 처방: 본문 클릭 = editableBodyClick → 빠른수정 팝오버 즉시 open(별도 편집클릭 불요)', () => {
    const rx = rxSplitRenderBlock();
    expect(rx).toContain('if (editableBodyClick && cancellable)');
    expect(rx).toMatch(/setEditPos\(\(cur\) => \(cur \? null : anchorBelow/);
    expect(rx).toContain('rx-confirmed-quickedit'); // QuickRxBar apply 동일 드롭다운
  });
});

test.describe('AC-3 안전게이트 fail-closed 무접촉·무회귀', () => {
  test('AC-3a — 편집 분기는 cancellable(=원내잔류·의사·!blockedByGate) 동반 필수', () => {
    const rx = rxSplitRenderBlock();
    expect(rx).toContain('editableBodyClick && cancellable');
  });
  test('AC-3b — cancellable SSOT(blockedByGate=checkRxInClinic 귀가 차단) 보존', () => {
    const s = QUICKRX();
    expect(s).toContain('const cancellable = doctorMode && !!checkInId && !blockedByGate;');
    expect(s).toContain('checkRxInClinic(');
    expect(block_showClinicalDoubleGuard()).toBe(true);
  });
});

test.describe('AC-4 귀가완료 차트(이름클릭) readonly 무회귀', () => {
  test('AC-4a — 이름 클릭 onOpenChart 3번째 인자=discharged(귀가완료=readonly 오픈)', () => {
    const block = completedRowBlock();
    expect(block).toContain("onOpenChart(checkIn.customer_id, 'full', discharged)");
  });
});

// 귀가완료 인라인 임상경과 편집창 이중방어(showClinical && !discharged) 잔존 확인 헬퍼.
function block_showClinicalDoubleGuard(): boolean {
  return completedRowBlock().includes('showClinical && !discharged && checkIn.customer_id');
}
