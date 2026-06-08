/**
 * T-20260608-foot-SLOT-MOVE-FIFO-ORDER
 * 슬롯→슬롯 이동 시 목적 슬롯 내부 정렬 = 이동 순서(FIFO) 보장.
 * "먼저 넘어온 사람이 항상 위 / 늦게 넘어온 고객이 먼저 치료 들어가는 순번 역전 금지"
 *
 * 검증 대상 = 순수 정렬 로직 (src/lib/slotOrder.ts):
 *   - nextSlotSortOrder(rows, destStatus): 목적 슬롯 맨 뒤(max+1) 정렬키 부여
 *   - compareSlotFifo(a, b): sort_order → checked_in_at → id 결정적 비교
 * Dashboard.handleDragEnd 의 모든 슬롯 이동 분기가 nextSlotSortOrder 로 sort_order 를 부여하고,
 * byStatus 정렬이 compareSlotFifo 를 사용한다.
 *
 * 데이터/브라우저 비의존(결정적) — 본 프로젝트는 vitest 미사용이라 Playwright 러너에서 순수 로직 검증.
 */
import { test, expect } from '@playwright/test';
import {
  nextSlotSortOrder,
  compareSlotFifo,
  type SlotOrderable,
} from '../../src/lib/slotOrder';

test.describe('T-20260608-foot-SLOT-MOVE-FIFO-ORDER (slotOrder 순수 로직)', () => {
  // AC-1: 시나리오 1 — 이동 순서대로 상위 정렬 (FIFO)
  test('AC-1: 먼저 이동한 카드가 늦게 이동한 카드보다 위(작은 sort_order)', () => {
    // 목적 슬롯(laser_waiting)에 기존 카드(체크인 시 sort_order=0) 2명
    let rows: SlotOrderable[] = [
      { id: 'x1', status: 'laser_waiting', sort_order: 0, checked_in_at: '2026-06-08T09:00:00+09:00' },
      { id: 'x2', status: 'laser_waiting', sort_order: 0, checked_in_at: '2026-06-08T09:05:00+09:00' },
      { id: 'A', status: 'treatment', sort_order: 0, checked_in_at: '2026-06-08T08:00:00+09:00' },
      { id: 'B', status: 'treatment', sort_order: 0, checked_in_at: '2026-06-08T08:10:00+09:00' },
    ];

    // A 를 treatment → laser_waiting 으로 먼저 이동
    const aOrder = nextSlotSortOrder(rows, 'laser_waiting', 'A');
    rows = rows.map((r) => (r.id === 'A' ? { ...r, status: 'laser_waiting', sort_order: aOrder } : r));

    // B 를 treatment → laser_waiting 으로 나중에 이동
    const bOrder = nextSlotSortOrder(rows, 'laser_waiting', 'B');
    rows = rows.map((r) => (r.id === 'B' ? { ...r, status: 'laser_waiting', sort_order: bOrder } : r));

    // 늦게 이동한 B 가 먼저 이동한 A 보다 큰 sort_order = 아래
    expect(bOrder).toBeGreaterThan(aOrder);

    const slot = rows.filter((r) => r.status === 'laser_waiting').sort(compareSlotFifo);
    const ids = slot.map((r) => r.id);
    // 기존 카드(x1,x2) 위, 그 다음 먼저 넘어온 A, 마지막에 B
    expect(ids).toEqual(['x1', 'x2', 'A', 'B']);
    // 순번 역전 금지: A 의 인덱스 < B 의 인덱스
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
  });

  // AC-1: 시나리오 1 step5 — 세 번째로 들어온 C 는 항상 맨 아래
  test('AC-1: 세 번째로 이동한 카드는 A·B 아래(가장 마지막)', () => {
    let rows: SlotOrderable[] = [
      { id: 'A', status: 'laser_waiting', sort_order: 1, checked_in_at: '2026-06-08T09:00:00+09:00' },
      { id: 'B', status: 'laser_waiting', sort_order: 2, checked_in_at: '2026-06-08T09:05:00+09:00' },
      { id: 'C', status: 'consultation', sort_order: 0, checked_in_at: '2026-06-08T08:00:00+09:00' },
    ];
    const cOrder = nextSlotSortOrder(rows, 'laser_waiting', 'C');
    rows = rows.map((r) => (r.id === 'C' ? { ...r, status: 'laser_waiting', sort_order: cOrder } : r));

    expect(cOrder).toBe(3); // max(1,2)+1
    const ids = rows.filter((r) => r.status === 'laser_waiting').sort(compareSlotFifo).map((r) => r.id);
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  // AC-1: 시나리오 2 — 순번 역전 없음 (정렬 영속·재진입 동일)
  test('AC-1: 재정렬 호출이 반복돼도 순서 안정(멱등) — 순번 역전 없음', () => {
    const rows: SlotOrderable[] = [
      { id: 'B', status: 'laser_waiting', sort_order: 2, checked_in_at: '2026-06-08T09:05:00+09:00' },
      { id: 'A', status: 'laser_waiting', sort_order: 1, checked_in_at: '2026-06-08T09:00:00+09:00' },
    ];
    const first = [...rows].sort(compareSlotFifo).map((r) => r.id);
    const second = [...rows].sort(compareSlotFifo).map((r) => r.id);
    expect(first).toEqual(['A', 'B']);
    expect(second).toEqual(['A', 'B']); // 새로고침/재진입해도 A 가 여전히 위
  });

  // tie-break: 동일 sort_order(기본값 0)면 checked_in_at(원래 도착 순) → id 로 결정적 정렬
  test('동일 sort_order tie-break = checked_in_at → id (결정적)', () => {
    const rows: SlotOrderable[] = [
      { id: 'p2', status: 'registered', sort_order: 0, checked_in_at: '2026-06-08T09:10:00+09:00' },
      { id: 'p1', status: 'registered', sort_order: 0, checked_in_at: '2026-06-08T09:00:00+09:00' },
      { id: 'p3', status: 'registered', sort_order: 0, checked_in_at: '2026-06-08T09:10:00+09:00' }, // p2와 동시각 → id 보조키
    ];
    const ids = [...rows].sort(compareSlotFifo).map((r) => r.id);
    expect(ids).toEqual(['p1', 'p2', 'p3']);
  });

  // 빈 슬롯으로 처음 이동 → sort_order = 1
  test('빈 목적 슬롯으로 처음 이동하면 sort_order=1', () => {
    const rows: SlotOrderable[] = [
      { id: 'A', status: 'consultation', sort_order: 5, checked_in_at: '2026-06-08T08:00:00+09:00' },
    ];
    expect(nextSlotSortOrder(rows, 'healer_waiting', 'A')).toBe(1);
  });

  // null/undefined sort_order 안전 처리
  test('sort_order null/undefined 안전 — 0으로 간주', () => {
    const rows: SlotOrderable[] = [
      { id: 'A', status: 'laser_waiting', sort_order: null, checked_in_at: '2026-06-08T08:00:00+09:00' },
      { id: 'B', status: 'laser_waiting', checked_in_at: '2026-06-08T08:05:00+09:00' },
    ];
    expect(nextSlotSortOrder(rows, 'laser_waiting')).toBe(1);
    const ids = [...rows].sort(compareSlotFifo).map((r) => r.id);
    expect(ids).toEqual(['A', 'B']); // 동률 → checked_in_at 순
  });
});
