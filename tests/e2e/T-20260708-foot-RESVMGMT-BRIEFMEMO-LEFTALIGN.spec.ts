import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260708-foot-RESVMGMT-BRIEFMEMO-LEFTALIGN — 예약격자 고객박스 간략메모 칩 좌측정렬 정정
 * 원천: 旣요청 누락 완결(증거 스샷 F0BFNLT8D0T, 20260708_113019.png — 중앙정렬 현상태).
 *   RC: 부모 격자 컨테이너(resv-day-xaxis)가 `text-center`라, 성함 아래 간략메모 block <div>가 중앙정렬로 상속됨.
 *       성함은 flex 행(items-center, justify default=flex-start)이라 좌측인데, 메모만 중앙 → 성함 좌측 기준선과 어긋남.
 *   FIX: 간략메모 block <div> + 힐러 pkgtype fallback block <div>(同 슬롯)에 `text-left` 명시 → 성함 좌측 기준선 정렬.
 *
 * 검증 = renderDayCard(4행 일간격자 카드) source-integrity, FE-only·스키마 무접촉.
 *   실 렌더 좌측정렬 육안 confirm 은 supervisor field-soak(갤탭 실기기) 담당.
 *   ※ 부모 CUSTBOX-PADDING-MEMO-POS(성함→메모 순서)·OVERHAUL AC5-2 와 무모순: 박스 세로순서 = 이름 → 간략메모(좌측) → 상태/기타.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

function renderDayCardBlock(): string {
  const start = RESV_PAGE.indexOf('const renderDayCard = (r: Reservation) =>');
  expect(start, 'renderDayCard 정의 누락').toBeGreaterThan(-1);
  const end = RESV_PAGE.indexOf('return (\n              /* T-20260701-foot-RESVGRID-TIMEAXIS-EXCELCELL', start);
  expect(end, 'renderDayCard 종료 경계 탐지 실패').toBeGreaterThan(start);
  return RESV_PAGE.slice(start, end);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 간략메모 칩 좌측정렬(성함 좌측 기준선 정렬), 중앙정렬 흔적 제거
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 간략메모 좌측정렬', () => {
  test('AC1-1: 간략메모 block <div> 에 text-left 명시(중앙정렬 상속 override)', () => {
    const block = renderDayCardBlock();
    // 간략메모 블록 = resv-day-brief. text-left 포함 클래스.
    expect(block, '간략메모 좌측정렬(text-left) 미적용').toContain('mt-0.5 whitespace-normal break-words text-left text-[8px] font-medium leading-tight text-gray-600');
    expect(block, 'brief testid 회귀').toContain('data-testid={`resv-day-brief-${r.id}`}');
  });

  test('AC1-2: 힐러 pkgtype fallback(同 메모 슬롯)도 좌측정렬 통일', () => {
    const block = renderDayCardBlock();
    expect(block, 'pkgtype fallback testid 회귀').toContain('data-testid={`resv-day-pkgtype-${r.id}`}');
    // 성함 아래 메모 슬롯 2종(brief / pkgtype fallback) 모두 text-left → 2건 이상 존재
    const leftAligned = block.split('mt-0.5 whitespace-normal break-words text-left text-[8px] font-medium leading-tight text-gray-600').length - 1;
    expect(leftAligned, '메모 슬롯 좌측정렬 클래스 2건(brief+pkgtype) 미충족').toBeGreaterThanOrEqual(2);
  });

  test('AC1-3: 중앙정렬 흔적 제거 — 메모 슬롯에 text-center 직접 부여 없음', () => {
    const block = renderDayCardBlock();
    // 메모 블록 자체에 text-center 를 직접 붙인 잔재 없음(좌측정렬 override 가 유효하도록)
    expect(block, '간략메모 슬롯에 text-center 직접 부여 잔재').not.toContain('whitespace-normal break-words text-center');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 칩 미선택 예약은 이름만(빈 영역 잔류 금지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 칩 미선택 시 빈 영역 잔류 금지', () => {
  test('AC2-1: 간략메모는 값 있을 때만 조건부 렌더(빈 블록 잔류 없음)', () => {
    const block = renderDayCardBlock();
    // brief_note 가 truthy 일 때만 블록 렌더 → 미선택 시 DOM 자체 부재(빈 영역 없음)
    expect(block, '간략메모 조건부 렌더 가드 회귀').toContain("r.status !== 'cancelled' && r.brief_note?.trim() && (");
  });

  test('AC2-2: 성함 → 간략메모 순서 유지(부모 CUSTBOX-PADDING-MEMO-POS 무모순)', () => {
    const block = renderDayCardBlock();
    const nameIdx = block.indexOf("r.customer_name?.trim() || '이름없음'");
    const briefIdx = block.indexOf('data-testid={`resv-day-brief-${r.id}`}');
    expect(nameIdx, '성함 렌더 누락').toBeGreaterThan(-1);
    expect(briefIdx, '간략메모 블록 누락').toBeGreaterThan(-1);
    expect(nameIdx, '간략메모가 성함보다 위(순서 회귀)').toBeLessThan(briefIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 표시 소스·저장경로 무변경(정렬만)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 소스·저장경로 무변경(정렬만)', () => {
  test('AC3-1: 표시 소스 = r.brief_note.trim() 불변(오버로드/치환 없음)', () => {
    const block = renderDayCardBlock();
    expect(block, '간략메모 표시 소스(brief_note) 회귀').toContain('{r.brief_note.trim()}');
  });

  test('AC3-2: 4행 매트릭스 격자 구조 불변(회귀 가드)', () => {
    expect(RESV_PAGE, '4행 map 렌더 회귀').toContain('DAY_ROW_KINDS.map((row)');
    expect(RESV_PAGE, 'dayRowOf 파티션 회귀').toContain('list.filter((r) => dayRowOf(r) === row.kind)');
  });
});
