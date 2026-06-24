/**
 * E2E spec — T-20260624-foot-DOCDASH-RXCLIN-DISCHARGE-PREVIEW-EDIT-GATE (문지은 대표원장, #foot, 2026-06-24 21:46)
 *
 * 진료대시보드 처방·임상경과 셀 — 귀가상태별 미리보기/펼침·편집 분기 정밀화.
 *   · 귀가완료(discharged): 미리보기(truncate) → 클릭 시 셀 아래 read-only 전체보기 펼침(편집 위젯 없음).
 *   · 귀가전(원내잔류, !discharged): 미리보기(truncate) → 클릭 시 편집 가능 드롭다운(그 자리 수정·저장).
 *
 * canonical=T-20260620-foot-DOCDASH-RXCLIN-PREVIEW-DROPDOWN(deployed) 의 셀 구현부 위에 차분(diff) 적용 — 同방향 정밀화.
 * 안전게이트(T-20260609/11/16 귀가환자 처방 mutate-lock)와 同방향(귀가=readonly) → 무회귀.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/RXCLIN-PREVIEW-DROPDOWN spec 컨벤션 동일(라이브 DB 비의존).
 * 실기기 시각 confirm(갤탭)은 supervisor 게이트.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const QUICKRX = () => SRC('components/doctor/QuickRxBar.tsx');

// CompletedRow(진료완료 섹션) 함수 블록만 잘라낸다 — CallFeedRow(대기/원내잔류)와 격리.
function completedRowBlock(): string {
  const s = DASH();
  const start = s.indexOf('function CompletedRow(');
  expect(start, 'CompletedRow 함수가 존재해야 함').toBeGreaterThan(-1);
  return s.slice(start);
}

// RxConfirmedSummary 의 splitMode 렌더 블록(본문 버튼) 추출.
function rxSplitRenderBlock(): string {
  const s = QUICKRX();
  const start = s.indexOf('if (splitMode) {');
  expect(start, 'splitMode 렌더 분기가 존재해야 함').toBeGreaterThan(-1);
  return s.slice(start);
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 귀가완료: 미리보기 → read-only 전체보기 펼침(편집 위젯 없음)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 귀가완료 = 미리보기 → read-only 전체보기', () => {
  test('S1-a — 임상경과 미리보기 클릭은 discharged 면 expandClinical(읽기 ColumnExpandPopover) 로 분기', () => {
    const block = completedRowBlock();
    // 미리보기 truncate 버튼 보존
    expect(block).toContain('doctor-completed-clinical-expand-btn');
    expect(block).toMatch(/truncate/);
    // onClick 분기: discharged → setExpandClinical (읽기 펼침)
    expect(block).toMatch(/if \(discharged\) setExpandClinical/);
    // 읽기전용 읽기 펼침 ColumnExpandPopover 보존(전문, 편집 위젯 없음)
    expect(block).toContain('doctor-completed-clinical-expand-pop');
  });

  test('S1-b — 처방 본문 클릭은 귀가완료(discharged) 면 읽기 펼침(onToggleExpand→expandRx) 유지', () => {
    const block = completedRowBlock();
    // 처방 읽기 펼침 메커니즘 보존
    expect(block).toContain('onToggleExpand={() => setExpandRx((v) => !v)}');
    expect(block).toContain('doctor-completed-rx-expand-pop');
    // editableBodyClick 는 !discharged 일 때만 true → 귀가완료는 false(읽기 펼침)
    expect(block).toContain('editableBodyClick={!discharged}');
  });

  test('S1-c — 귀가완료는 인라인 임상경과 편집창(MedicalChartPanel editable) 미렌더(fail-closed 무회귀)', () => {
    const block = completedRowBlock();
    // showClinical 인라인 편집은 !discharged 게이트로 한 번 더 차단(이중방어 보존)
    expect(block).toContain('showClinical && !discharged && checkIn.customer_id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 귀가전(원내잔류): 미리보기 → 편집 가능 드롭다운(그 자리 수정·저장)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 귀가전(원내잔류) = 미리보기 → 편집 드롭다운', () => {
  test('S2-a — 임상경과 미리보기 클릭은 !discharged 면 setShowClinical(true)(인라인 편집) 로 분기', () => {
    const block = completedRowBlock();
    // discharged 아니면 setShowClinical(true) → 인라인 임상경과 편집창(그 자리 수정·저장)
    expect(block).toMatch(/else if \(checkIn\.customer_id\) setShowClinical\(true\)/);
    // aria-expanded 도 귀가상태별 분기(읽기=expandClinical / 편집=showClinical)
    expect(block).toContain('aria-expanded={discharged ? expandClinical : showClinical}');
  });

  test('S2-b — 처방 본문 클릭(원내잔류) = editableBodyClick → 빠른수정 팝오버(편집 가능 드롭다운)', () => {
    const rx = rxSplitRenderBlock();
    // 본문 버튼 onClick: editableBodyClick && cancellable → editPos(빠른수정 팝오버) 즉시 오픈
    expect(rx).toContain('if (editableBodyClick && cancellable)');
    expect(rx).toMatch(/setEditPos\(\(cur\) => \(cur \? null : anchorBelow/);
    // 빠른수정 팝오버(QuickRxBar apply mutation 동일) 보존
    expect(rx).toContain('rx-confirmed-quickedit');
  });

  test('S2-c — editableBodyClick prop 선언·기본 false(미지정 소비처 무회귀)', () => {
    const s = QUICKRX();
    expect(s).toContain('editableBodyClick = false,');
    expect(s).toContain('editableBodyClick?: boolean;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 / AC — 안전게이트 무회귀: 귀가완료는 절대 편집 불가
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 안전게이트 무회귀(귀가완료 편집 차단)', () => {
  test('S3-a — 처방 본문 편집 분기는 cancellable(=원내잔류·의사·!blockedByGate) 일 때만 동작', () => {
    const rx = rxSplitRenderBlock();
    // editableBodyClick 만으로는 부족 — cancellable 동반 필수(귀가완료=blockedByGate → cancellable=false → 읽기 펼침)
    expect(rx).toContain('editableBodyClick && cancellable');
    // disabled / aria-expanded / title 모두 (editableBodyClick && cancellable) 게이트
    expect(rx).toContain('editableBodyClick && cancellable ? false : !canExpand');
  });

  test('S3-b — cancellable 정의는 blockedByGate(귀가) 차단 SSOT 유지(무회귀)', () => {
    const s = QUICKRX();
    expect(s).toContain('const cancellable = doctorMode && !!checkInId && !blockedByGate;');
    expect(s).toContain('checkRxInClinic(');
  });

  test('S3-c — 귀가완료 임상경과는 read-only 펼침만(편집 위젯 없는 ColumnExpandPopover div)', () => {
    const block = completedRowBlock();
    // 읽기 전용 펼침 본문 = whitespace-pre-wrap 텍스트(편집 input 아님)
    const popIdx = block.indexOf('doctor-completed-clinical-expand-pop');
    expect(popIdx).toBeGreaterThan(-1);
    const popBlock = block.slice(popIdx, popIdx + 600);
    expect(popBlock).toContain('whitespace-pre-wrap');
    expect(popBlock).toContain('doctor-completed-clinical-expand');
    // 편집 위젯(MedicalChartPanel/QuickRxBar)이 읽기 펼침 popover 안에 없음
    expect(popBlock).not.toContain('MedicalChartPanel');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 축1 무회귀 — canonical(미리보기 + 드롭다운 전문) 셀 골격 보존(전면 재구현 금지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('canonical 무회귀(차분 적용)', () => {
  test('C-a — 미리보기 truncate + ColumnExpandPopover(컬럼 폭 전문) 골격 보존', () => {
    const s = DASH();
    expect(s).toContain('ColumnExpandPopover');
    expect(s).toContain('doctor-completed-rx-expand-pop');
    expect(s).toContain('doctor-completed-clinical-expand-pop');
  });

  test('C-b — 비귀가(!discharged) QuickRxBar 인라인 처방(미처방 신규작성) 분기 보존', () => {
    const block = completedRowBlock();
    expect(block).toContain('<QuickRxBar');
    expect(block).toContain('!discharged ?');
  });
});
