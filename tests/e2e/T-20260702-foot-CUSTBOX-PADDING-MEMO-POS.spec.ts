import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260702-foot-CUSTBOX-PADDING-MEMO-POS — 예약격자 고객박스 여백 확대 + 간략메모 위치 이동
 * 원천: 김주연 총괄(C0ATE5P6JTH, 2026-07-02 13:40, 스샷 F0BEQ3Z2DL1). RESVGRID-4ROW-BODYSPLIT(3e564b6a) 배포 후 후속 정제.
 *   ① 빈 셀(예약 생성칸) 내 고객박스 주변 여백 확대 → 빈공간 클릭영역 확보(p-1→px-2 py-1.5, 가로 위주 / 세로 소폭).
 *   ② 고객박스 내부 표시순서 [성함]→[간략메모]로 재배치(부모 7ADJ⑤ 는 메모 상단 → 본 티켓이 성함 아래로 supersede).
 *
 * 검증 = renderDayCard(4행 일간격자 카드) source-integrity: ① 셀 패딩 확대 + min-h/4행 구조 불변(회귀 가드)
 *   ② 성함(customer_name) 렌더가 간략메모(resv-day-brief) 블록보다 앞(위)에 옴. FE-only, 스키마 무접촉.
 *   실 렌더 클릭 동선·스샷은 supervisor field-soak(갤탭 실기기 confirm) 담당.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// renderDayCard 함수 본문만 슬라이스(성함 vs 간략메모 순서 판정 스코프 격리)
function renderDayCardBlock(): string {
  const start = RESV_PAGE.indexOf('const renderDayCard = (r: Reservation) =>');
  expect(start, 'renderDayCard 정의 누락').toBeGreaterThan(-1);
  // 다음 최상위 렌더 함수/return 경계까지
  const end = RESV_PAGE.indexOf('return (\n              /* T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL', start);
  expect(end, 'renderDayCard 종료 경계 탐지 실패').toBeGreaterThan(start);
  return RESV_PAGE.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 / AC1 — 빈 셀 고객박스 여백 확대 → 빈공간 클릭영역 확보
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 빈 셀 여백 확대(클릭영역 확보)', () => {
  test('AC1-1: 4행 셀 패딩 p-1 → px-2 py-1.5 확대(가로 위주)', () => {
    // 셀 클래스에 확대된 패딩 적용
    expect(RESV_PAGE, '셀 패딩 확대(px-2 py-1.5) 미적용').toContain('min-h-[56px] space-y-1 border-b border-l px-2 py-1.5 align-top');
    // 기존 타이트 패딩(p-1) 회귀 방지 — 셀 라인에서 제거됨
    expect(RESV_PAGE, '구 셀 패딩(p-1) 잔존 회귀').not.toContain('min-h-[56px] space-y-1 border-b border-l p-1 align-top');
  });

  test('AC1-2: 빈 칸 클릭 생성 동선(handleCellCreate) — onClick 배선 유지', () => {
    // 여백 영역 클릭 = 셀 onClick → 신규예약(openNewSlot 경유) 동선 불변
    expect(RESV_PAGE, '셀 onClick 배선 회귀').toContain('onClick={handleCellCreate}');
    expect(RESV_PAGE, 'openNewSlot 경유(CUSTCTX-PREFILL 분기) 회귀').toContain('openNewSlot(selectedDay, time)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 / AC2·AC4 — 간략메모 위치: [성함] → [간략메모] 재배치
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2/AC4: 간략메모를 성함 바로 아래로 재배치', () => {
  test('AC2-1: renderDayCard 내 성함(customer_name)이 간략메모(brief)보다 앞', () => {
    const block = renderDayCardBlock();
    const nameIdx = block.indexOf('{r.customer_name}');
    const briefIdx = block.indexOf('data-testid={`resv-day-brief-${r.id}`}');
    expect(nameIdx, '성함 렌더 누락').toBeGreaterThan(-1);
    expect(briefIdx, '간략메모 블록 누락').toBeGreaterThan(-1);
    // 성함이 간략메모보다 소스 상 먼저(위) 등장 = [성함]→[간략메모]
    expect(nameIdx, '간략메모가 성함보다 위에 있음(재배치 미반영)').toBeLessThan(briefIdx);
  });

  test('AC2-2: 간략메모 블록 상단 여백 mt-0.5(성함과의 간격) — mb-0.5 아님', () => {
    const block = renderDayCardBlock();
    // 성함 아래 배치이므로 위쪽 마진(mt-0.5)으로 간격
    expect(block, '간략메모 mt-0.5(성함 하단 간격) 미적용').toContain('mt-0.5 whitespace-normal break-words text-[8px] font-medium leading-tight text-gray-600');
    // 구 상단배치(mb-0.5) 회귀 방지
    expect(block, '구 상단배치 마진(mb-0.5) 잔존 회귀').not.toContain('mb-0.5 whitespace-normal break-words text-[8px] font-medium leading-tight text-gray-600');
  });

  test('AC4-1: 취소건은 간략메모 미표기(가드 유지) + brief testid 보존', () => {
    const block = renderDayCardBlock();
    expect(block, '취소 가드 회귀').toContain("r.status !== 'cancelled' && r.brief_note?.trim()");
    expect(block, 'brief testid 회귀').toContain('data-testid={`resv-day-brief-${r.id}`}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 / AC3 — RESVGRID-4ROW-BODYSPLIT 4행 매트릭스 구조 회귀 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 4행 매트릭스 구조 유지(회귀 가드)', () => {
  test('AC3-1: DAY_ROW_KINDS 4행(초진/재진/힐러/리본) 구성 불변', () => {
    expect(RESV_PAGE, 'DAY_ROW_KINDS 정의 누락').toContain('const DAY_ROW_KINDS');
    for (const k of ['new', 'returning', 'healer', 'ribbon']) {
      expect(RESV_PAGE, `DAY_ROW_KINDS ${k} 행 회귀`).toContain(`kind: '${k}'`);
    }
    expect(RESV_PAGE, '4행 map 렌더 회귀').toContain('DAY_ROW_KINDS.map((row)');
    expect(RESV_PAGE, 'dayRowOf 파티션 회귀').toContain('list.filter((r) => dayRowOf(r) === row.kind)');
  });

  test('AC3-2: 셀 min-h-[56px] 동등높이 baseline 유지(세로밀림/스크롤 억제)', () => {
    // 여백 확대(px-2 py-1.5)에도 4행 동등높이 기준(min-h-[56px])은 불변 → 세로 매트릭스 유지
    expect(RESV_PAGE, 'min-h-[56px] baseline 회귀').toContain('min-h-[56px]');
    expect(RESV_PAGE, '4행 셀 testid 회귀').toContain('data-testid={`resv-day-cell-${row.kind}-${time}`}');
    expect(RESV_PAGE, '4행 rowlabel testid 회귀').toContain('data-testid={`resv-day-rowlabel-${row.kind}`}');
  });
});
