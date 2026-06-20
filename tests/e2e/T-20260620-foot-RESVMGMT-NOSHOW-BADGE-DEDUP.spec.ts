/**
 * E2E spec — T-20260620-foot-RESVMGMT-NOSHOW-BADGE-DEDUP
 * 예약관리(Reservations.tsx) 예약 카드: 차트번호 옆 "노쇼 N회" destructive 배지 제거
 *
 * 현상: 예약 카드 차트번호 옆 destructive Badge("노쇼 N")가 같은 카드 상태줄
 *       STATUS_LABEL '노쇼'(L~1909, `{...} · {STATUS_LABEL[r.status]}`)와 정보 중복.
 * 요청: 차트번호 옆 destructive 배지만 제거. 상태줄 노쇼 표시는 유지.
 *
 * AC-1: 차트번호 옆 "노쇼 N" destructive 배지가 더 이상 렌더되지 않는다 (소스에서 제거).
 * AC-2: 상태줄 STATUS_LABEL '노쇼' 표시는 유지된다 (status==='noshow' → '노쇼').
 * AC-3: ReservationDetailPopup noshowCount prop 회귀 없음 — noshowByCustomer
 *       state/fetch(setNoshowByCustomer)는 유지되어 팝업에 전달된다.
 * AC-4: 노쇼 이력 없는 카드(noshowByCustomer 미존재)는 회귀 없음 (기존에도 배지 미표시).
 *
 * DB 변경 없음 — FE render 제거만.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESV_SRC = resolve(__dirname, '../../src/pages/Reservations.tsx');

// ── 소스 가드: 제거된 배지가 부활하지 않도록 + 유지 대상 보존 검증 ────────────────
test.describe('T-20260620 RESVMGMT-NOSHOW-BADGE-DEDUP — 소스 정합 검증', () => {
  const src = readFileSync(RESV_SRC, 'utf8');

  test('AC-1: 차트번호 옆 "노쇼 {count}" destructive 배지 렌더 블록이 제거됨', () => {
    // 제거 대상 정확 패턴: <Badge variant="destructive" ...>노쇼 {noshowByCustomer[...]}</Badge>
    const removedBadge = /노쇼 \{noshowByCustomer\[r\.customer_id\]\}/;
    expect(removedBadge.test(src)).toBe(false);
    // destructive variant + 노쇼 텍스트 조합도 잔존하지 않아야 함
    expect(/variant="destructive"[\s\S]{0,80}노쇼/.test(src)).toBe(false);
  });

  test('AC-2: 상태줄 STATUS_LABEL 표시 라인 유지', () => {
    expect(src.includes('STATUS_LABEL[r.status]')).toBe(true);
    // STATUS_LABEL 맵의 noshow → '노쇼' 정의 유지
    expect(/noshow:\s*'노쇼'/.test(src)).toBe(true);
  });

  test('AC-3: noshowByCustomer state/fetch + 팝업 noshowCount 경로 유지', () => {
    expect(src.includes('const [noshowByCustomer, setNoshowByCustomer]')).toBe(true);
    expect(src.includes('setNoshowByCustomer(')).toBe(true);
    // ReservationDetailPopup 으로 전달되는 noshowByCustomer 참조 유지
    expect(src.includes('noshowByCustomer[detail.customer_id]')).toBe(true);
  });
});

// ── 렌더 로직 미러: 배지 제거 후에도 상태줄·팝업 데이터 경로가 분리됨 ───────────────
test.describe('T-20260620 RESVMGMT-NOSHOW-BADGE-DEDUP — 로직 분리 검증', () => {
  const STATUS_LABEL: Record<string, string> = {
    confirmed: '예약', noshow: '노쇼', completed: '완료', cancelled: '취소',
  };

  function statusLabelOf(status: string) {
    return STATUS_LABEL[status] ?? status;
  }
  // 팝업 prop 미러: detail 기준 noshowCount 산출 (배지 제거와 독립)
  function popupNoshowCount(
    noshowByCustomer: Record<string, number>,
    detail: { customer_id?: string } | null,
  ) {
    return detail?.customer_id ? noshowByCustomer[detail.customer_id] ?? 0 : 0;
  }

  test('AC-2: 노쇼 예약 상태줄은 여전히 "노쇼"', () => {
    expect(statusLabelOf('noshow')).toBe('노쇼');
    expect(statusLabelOf('confirmed')).toBe('예약');
  });

  test('AC-3: 팝업 noshowCount 는 noshowByCustomer 에서 정상 산출 (회귀 없음)', () => {
    const map = { 'cust-1': 3 };
    expect(popupNoshowCount(map, { customer_id: 'cust-1' })).toBe(3);
  });

  test('AC-4: 노쇼 이력 없는 고객 → 팝업 count 0, 상태줄은 자신의 status 따름', () => {
    const map: Record<string, number> = {};
    expect(popupNoshowCount(map, { customer_id: 'cust-x' })).toBe(0);
    expect(popupNoshowCount(map, null)).toBe(0);
    expect(statusLabelOf('confirmed')).toBe('예약'); // 노쇼 아닌 카드 회귀 없음
  });
});
