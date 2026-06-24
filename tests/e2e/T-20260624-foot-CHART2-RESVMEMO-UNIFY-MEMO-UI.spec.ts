/**
 * T-20260624-foot-CHART2-RESVMEMO-UNIFY-MEMO-UI
 *   2번차트(고객차트) 메모 UI 추가 정합. 김주연 총괄(풋센터) 현장 디자인 QA.
 *
 * AC-1 — 1구역 예약메모 레이아웃을 고객메모와 통일 + 노란색(amber) 제거
 *   ReservationMemoTimeline 1구역 호출부에 tone="neutral"(amber 박스 제거) + unifyInput(고객메모 칸과 동일 레이아웃:
 *   우측 상단 컴팩트 회색 [추가] 버튼 + 하단 full-width textarea text-[11px]).
 * AC-2 — 상세 상담/치료메모 기입칸 2.5배 확장(rows 3 → 8)
 *   상담메모(MemoHistoryPanel inputRows={8}) + 치료메모(전용 블록 textarea rows={8}). 고객메모(예약 탭)는 미대상.
 * AC-3 — 상세 고객메모 중간 이력칸 제거(표시만, 데이터/저장 hook 유지) + 추가 버튼명 "추가"
 *   MemoHistoryPanel hideHistory(이력 표시영역 숨김) + addBtnLabel="추가". 요약 블록은 유지(중복 해소).
 *
 * 본 spec 은 코드베이스 CHART2 spec 관행(정적 소스 미러링 가드)을 따른다 —
 * 통일/확장/이력숨김 불변식이 회귀하면 즉시 실패.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const chartSrc = readFileSync(resolve(__dir, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');
const memoSrc = readFileSync(resolve(__dir, '../../src/components/ReservationMemoTimeline.tsx'), 'utf-8');

// ── AC-1: 1구역 예약메모 통일 + 노란색 제거 ──────────────────────────────────────
test.describe('AC-1 — 1구역 예약메모 고객메모와 통일 + amber 제거', () => {
  test('ReservationMemoTimeline: unifyInput prop 정의 + 비고정 neutral 톤 분기 보존', () => {
    expect(memoSrc).toContain('unifyInput?: boolean');
    expect(memoSrc).toContain('unifyInput = false');
    // neutral 톤이면 amber 박스 미사용 (border-border bg-card)
    expect(memoSrc).toContain("tone === 'neutral'");
    expect(memoSrc).toContain('border-border bg-card');
  });

  test('unifyInput 입력부: 우측 상단 컴팩트 회색 [추가] 버튼 + textarea text-[11px] (teal/icon 제거)', () => {
    const idx = memoSrc.indexOf('unifyInput ? (');
    expect(idx).toBeGreaterThan(-1);
    const block = memoSrc.slice(idx, idx + 1400);
    // 고객메모 칸과 동일 톤: justify-end + 컴팩트 회색 버튼 + 라벨 '추가'
    expect(block).toContain('justify-end');
    expect(block).toContain('bg-[#666666]');
    expect(block).toContain('px-2.5 py-0.5');
    expect(block).toContain("'저장 중…' : '추가'");
    expect(block).toContain('text-[11px] resize-none');
  });

  test('1구역 호출부: tone="neutral" + unifyInput 적용 (amber 미사용)', () => {
    // 1구역 예약메모 = reservations[0]?.id + customerId fallback + compact
    const idx = chartSrc.indexOf('reservationId={reservations[0]?.id}');
    expect(idx).toBeGreaterThan(-1);
    const block = chartSrc.slice(idx, idx + 400);
    expect(block).toContain('tone="neutral"');
    expect(block).toContain('unifyInput');
  });

  test('회귀: 기존 amber 분기·non-unify(teal) 입력부는 타 서피스 위해 보존', () => {
    expect(memoSrc).toContain('border-amber-200 bg-amber-50');
    expect(memoSrc).toContain('border-teal-300 text-teal-700');
    expect(memoSrc).toContain("tone = 'amber'");
  });
});

// ── AC-2: 상담/치료메모 기입칸 2.5배(rows 3→8) ──────────────────────────────────
test.describe('AC-2 — 상담/치료메모 기입칸 2.5배 확장', () => {
  test('MemoHistoryPanel: inputRows prop(기본 3) 정의 + 새 메모 textarea에 적용', () => {
    expect(chartSrc).toContain('inputRows = 3');
    expect(chartSrc).toContain('inputRows?: number');
    expect(chartSrc).toContain('rows={inputRows}');
  });

  test('상담메모 호출부: inputRows={8} (2.5배)', () => {
    const idx = chartSrc.indexOf('testidPrefix="consult-memo"');
    expect(idx).toBeGreaterThan(-1);
    const block = chartSrc.slice(idx, idx + 400);
    expect(block).toContain('inputRows={8}');
  });

  test('치료메모 전용 블록: 새 메모 textarea rows={8}', () => {
    const idx = chartSrc.indexOf('치료 메모를 입력하세요…');
    expect(idx).toBeGreaterThan(-1);
    const block = chartSrc.slice(idx - 250, idx + 50);
    expect(block).toContain('rows={8}');
  });

  test('회귀: 고객메모(예약 탭)는 2.5배 미대상 — inputRows 미지정(기본 3)', () => {
    const idx = chartSrc.indexOf('testidPrefix="resv-memo"');
    const block = chartSrc.slice(idx, idx + 400);
    expect(block).not.toContain('inputRows={8}');
  });
});

// ── AC-3: 고객메모 중간 이력칸 제거 + 버튼명 "추가" ──────────────────────────────
test.describe('AC-3 — 고객메모 이력칸 제거(표시만) + 버튼명 단축', () => {
  test('MemoHistoryPanel: hideHistory prop(기본 false) + 이력 표시영역 조건부 숨김', () => {
    expect(chartSrc).toContain('hideHistory = false');
    expect(chartSrc).toContain('hideHistory?: boolean');
    // hideHistory=true면 이력 블록 렌더 안 함
    expect(chartSrc).toContain('hideHistory ? null :');
  });

  test('고객메모(예약 탭) 호출부: hideHistory 적용 + addBtnLabel="추가"', () => {
    const idx = chartSrc.indexOf('testidPrefix="resv-memo"');
    expect(idx).toBeGreaterThan(-1);
    const block = chartSrc.slice(idx, idx + 400);
    expect(block).toContain('addBtnLabel="추가"');
    expect(block).toContain('hideHistory');
    // 더 이상 '고객메모 추가' 버튼명 아님
    expect(block).not.toContain('addBtnLabel="고객메모 추가"');
  });

  test('데이터/저장 hook 보존(표시만 제거) — saveNew·hook 동작 불변', () => {
    expect(chartSrc).toContain('onClick={hook.saveNew}');
    // 요약 블록은 유지 — 고객메모 최신 1건 표시 (중복 해소의 단일 표시처)
    expect(chartSrc).toContain('memo-summary-block');
    expect(chartSrc).toContain("{ label: '고객메모', content: reservationMemoHistory.latest?.content ?? null }");
  });

  test('회귀: 상담/치료메모 탭은 이력칸 유지(hideHistory 미적용)', () => {
    const idx = chartSrc.indexOf('testidPrefix="consult-memo"');
    const block = chartSrc.slice(idx, idx + 400);
    expect(block).not.toContain('hideHistory');
  });
});
