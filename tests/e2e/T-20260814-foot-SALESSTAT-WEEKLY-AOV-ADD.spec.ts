/**
 * E2E — T-20260814-foot-SALESSTAT-WEEKLY-AOV-ADD
 * 주단위 매출통계에 객단가 추가 (CEO 결정 b: 신규 '주별 매출 breakdown 표' 신설).
 *
 * 배경(census MSG-20260814-155537-wez8 확정):
 *   현 매출통계 삽입 객단가 = 내방객(내원환자) 객단가 = 누적매출(순) ÷ 내원환자 수
 *   (내원환자 = 체크인[취소·삭제·테스트고객 제외] distinct customer_id). 월간 = 이 단일 정의.
 *   주단위 신설 = 기존 read-path(fetchRevenue 일별 net + check_ins distinct)를 ISO주(월요일 시작)로
 *   재그룹만(db_change=false). 별도 분모 authoring 0 → 월간 객단가 정의 100% 미러(AC-2).
 *
 * 순수함수 검증(브라우저 불요) — aggregateWeeklyRevenue(주 그룹핑·객단가·0-div·테스트고객 제외).
 *
 * AC-1: 주 객단가 = 주 매출 ÷ 주 내원환자수, 내원 0 주 → arpu=null(0-div 가드, NaN/에러 금지).
 * AC-2: 분자·분모 정의 = 월간 매출통계 객단가와 동일(매출 net = pkg+single−refund / 내원 = distinct customer).
 * AC-3: is_test(테스트고객) → 내원환자 분모에서 제외(simIds).
 * AC-4: distinct — 동일 고객 주내 다회 내원 = 1명.
 * AC-5: ISO주 경계 = 월요일 시작(resolveRange 'week' 동일). 매출·내원 0인 주도 표에 포함(완전성).
 *
 * @see T-20260814-foot-SALESSTAT-WEEKLY-AOV-ADD
 */

import { test, expect } from '@playwright/test';
import {
  aggregateWeeklyRevenue,
  type WeeklyCheckInRow,
} from '../../src/lib/mtmSales';
import type { RevenueRow } from '../../src/lib/stats';

const rev = (dt: string, pkg: number, single: number, refund = 0): RevenueRow => ({
  dt,
  package_amount: pkg,
  single_amount: single,
  refund_amount: refund,
});

// KST 정오(03:00Z = 12:00 KST) 체크인 — UTC→KST 날짜 환산이 같은 날로 떨어지도록.
const ci = (customer_id: string | null, dateKST: string): WeeklyCheckInRow => ({
  customer_id,
  checked_in_at: `${dateKST}T03:00:00Z`,
});

// 2026-08-03(월)~08-16(일) = 2 ISO주. wk1: 08-03~08-09 / wk2: 08-10~08-16.
const WK1 = '2026-08-03';
const WK2 = '2026-08-10';

test('AC-2/AC-1: 주별 매출·객단가 = net÷distinct 내원 (월간 정의 미러)', () => {
  const revRows = [
    rev('2026-08-04', 100_000, 50_000),           // wk1 net 150,000
    rev('2026-08-08', 0, 30_000),                  // wk1 net  30,000 → 주합 180,000
    rev('2026-08-11', 200_000, 0, 20_000),         // wk2 net 180,000
  ];
  const checkIns = [
    ci('A', '2026-08-04'), ci('B', '2026-08-05'), ci('C', '2026-08-08'), // wk1 distinct 3
    ci('A', '2026-08-11'), ci('D', '2026-08-12'),                        // wk2 distinct 2
  ];
  const out = aggregateWeeklyRevenue('2026-08-03', '2026-08-16', revRows, checkIns, new Set());

  expect(out).toHaveLength(2);
  const w1 = out.find((w) => w.weekStart === WK1)!;
  const w2 = out.find((w) => w.weekStart === WK2)!;

  expect(w1.revenue).toBe(180_000);
  expect(w1.visitPatients).toBe(3);
  expect(w1.arpu).toBe(60_000);   // 180,000 ÷ 3

  expect(w2.revenue).toBe(180_000);
  expect(w2.visitPatients).toBe(2);
  expect(w2.arpu).toBe(90_000);   // 180,000 ÷ 2
});

test('AC-1: 내원환자 0 주 → 객단가 null (0-div 가드, NaN 금지)', () => {
  const revRows = [rev('2026-08-11', 500_000, 0)]; // wk2 매출 有, 내원 0
  const out = aggregateWeeklyRevenue('2026-08-10', '2026-08-16', revRows, [], new Set());
  const w2 = out.find((w) => w.weekStart === WK2)!;
  expect(w2.revenue).toBe(500_000);
  expect(w2.visitPatients).toBe(0);
  expect(w2.arpu).toBeNull();
  expect(Number.isNaN(w2.arpu as number)).toBe(false);
});

test('AC-3: 테스트고객(is_test/sim)은 내원환자 분모에서 제외', () => {
  const revRows = [rev('2026-08-11', 100_000, 0)];
  const checkIns = [ci('REAL', '2026-08-11'), ci('TESTC', '2026-08-11')];
  const out = aggregateWeeklyRevenue('2026-08-10', '2026-08-16', revRows, checkIns, new Set(['TESTC']));
  const w2 = out.find((w) => w.weekStart === WK2)!;
  expect(w2.visitPatients).toBe(1);       // TESTC 제외
  expect(w2.arpu).toBe(100_000);          // 100,000 ÷ 1
});

test('AC-4: 동일 고객 주내 다회 내원 = 1명(distinct)', () => {
  const revRows = [rev('2026-08-11', 90_000, 0)];
  const checkIns = [ci('A', '2026-08-11'), ci('A', '2026-08-13'), ci('A', '2026-08-15')];
  const out = aggregateWeeklyRevenue('2026-08-10', '2026-08-16', revRows, checkIns, new Set());
  const w2 = out.find((w) => w.weekStart === WK2)!;
  expect(w2.visitPatients).toBe(1);
  expect(w2.arpu).toBe(90_000);
});

test('AC-5: 매출·내원 0인 주도 표에 포함(월요일 경계·기간 완전성)', () => {
  // 3주 범위, 가운데 주(08-10~08-16)만 데이터.
  const revRows = [rev('2026-08-12', 70_000, 0)];
  const checkIns = [ci('A', '2026-08-12')];
  const out = aggregateWeeklyRevenue('2026-08-03', '2026-08-23', revRows, checkIns, new Set());
  expect(out.map((w) => w.weekStart)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
  expect(out[0].revenue).toBe(0);
  expect(out[0].visitPatients).toBe(0);
  expect(out[0].arpu).toBeNull();      // 빈 주 → '-'
  expect(out[1].arpu).toBe(70_000);
});

test('AC-5: 기간 clip 라벨 — 주 경계가 기간 밖이면 from/to 로 자름', () => {
  // 조회 08-05(화)~08-13(목): wk1은 08-05부터(월 08-03 아님), wk2는 08-13까지.
  const out = aggregateWeeklyRevenue('2026-08-05', '2026-08-13', [], [], new Set());
  const w1 = out.find((w) => w.weekStart === WK1)!;
  const w2 = out.find((w) => w.weekStart === WK2)!;
  expect(w1.rangeStart).toBe('2026-08-05');   // from 으로 clip
  expect(w1.rangeEnd).toBe('2026-08-09');      // 주 일요일
  expect(w1.label).toBe('8/5~8/9');
  expect(w2.rangeStart).toBe('2026-08-10');
  expect(w2.rangeEnd).toBe('2026-08-13');      // to 로 clip
  expect(w2.label).toBe('8/10~8/13');
});
