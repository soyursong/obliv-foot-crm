// T-20260608-foot-SLOT-MOVE-FIFO-ORDER
// 슬롯→슬롯 이동 시 목적 슬롯 내부 정렬을 "이동 순서(FIFO)"로 보장하는 순수 로직.
//
// 규칙:
//  - 슬롯(= check_ins.status 그룹) 내부 정렬키는 sort_order(int4) 그대로 사용한다.
//  - 다른 슬롯에서 카드가 넘어오면 목적 슬롯의 현재 sort_order 최대값 + 1 을 부여해 "맨 뒤"에 배치한다.
//    → 먼저 넘어온 사람이 항상 위, 늦게 넘어온 사람이 먼저 치료 들어가는 순번 역전이 없다.
//  - 동일 sort_order(동시/기본값 0)일 때는 checked_in_at(원래 도착 순) → id 보조키로 결정적 순서를 보장한다.
//
// FE-only. DB 변경 없음(sort_order 컬럼 기존 사용).

export interface SlotOrderable {
  id: string;
  status: string;
  sort_order?: number | null;
  checked_in_at?: string | null;
}

/**
 * 목적 슬롯(destStatus) 안에서 "맨 뒤"로 보낼 새 sort_order 를 계산한다.
 * = 목적 슬롯 현재 최대 sort_order + 1 (없으면 1).
 * excludeId: 이동 중인 카드 자신은 제외(현재 다른 슬롯에 있으면 영향 없지만 안전하게 제외).
 */
export function nextSlotSortOrder(
  rows: readonly SlotOrderable[],
  destStatus: string,
  excludeId?: string,
): number {
  let max = 0;
  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (r.status !== destStatus) continue;
    const so = typeof r.sort_order === 'number' ? r.sort_order : 0;
    if (so > max) max = so;
  }
  return max + 1;
}

/**
 * 슬롯 내부 FIFO 비교자.
 * 1차: sort_order 오름차순(이동 시 max+1 부여 → 먼저 넘어온 사람이 위)
 * 2차: checked_in_at 오름차순(원래 도착 순)
 * 3차: id (완전 결정적 — 순번 역전 방지)
 */
export function compareSlotFifo(a: SlotOrderable, b: SlotOrderable): number {
  const orderCmp = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (orderCmp !== 0) return orderCmp;
  const ci = (a.checked_in_at ?? '').localeCompare(b.checked_in_at ?? '');
  if (ci !== 0) return ci;
  return a.id.localeCompare(b.id);
}
