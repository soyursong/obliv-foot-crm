import { supabase } from '@/lib/supabase';

/**
 * 시뮬레이션(테스트 더미) 숨김 필터 — admin 예약/체크인 목록·캘린더용.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * [현행 정책: 정밀 화이트리스트] — T-20260612-foot-RESV-REVISIT-NOT-LISTED (A2 / 범위 b)
 *
 *   현장 결정(김주연 총괄, 2026-06-13): 의도적 테스트 페르소나("토마토")의 예약을
 *   예약관리·대시보드 admin 화면에도 노출. 단, GO_WARN 실측(dev DB 2026-06-13)에서
 *   sim 고객 731명 중 730명이 종로점(실운영 지점)에 누적된 bulk/명명형 더미
 *   ([TEST4]·[TEST5]·더미_·음식/동물 가명 617건 등)로 확인됨. 전면 완화(no-op) 시
 *   종로 admin 캘린더 과거 주차 탐색에서 729개 더미가 재유입 → ADMIN-SIM-FILTER가
 *   막던 문제 재발. 따라서 전면완화(a)를 폐기하고 **현장이 명시 요청한 테스트
 *   페르소나만 노출 예외**(b)로 한정한다.
 *
 *   구현: 구 정책(is_simulation=true 행 숨김)을 복원하되, EXPOSED_SIM_NAMES에 든
 *   고객은 숨김 예외(노출). 정책 조정은 본 파일 EXPOSED_SIM_NAMES 1곳만 수정.
 *
 *   토마토: id=45adae8f-5f96-412b-80e4-49c10a27463f, clinic=74967aea…b8c8 (is_simulation=true).
 *   이름 일치는 is_simulation=true 집합 내부에서만 적용되므로 실고객 동명이인과 충돌 없음
 *   (실고객은 애초에 숨김 대상이 아니라 항상 노출).
 *
 * [구 정책: admin에서 sim 전부 숨김] — T-20260610-foot-ADMIN-SIM-FILTER (보강됨)
 *   "연결 고객이 is_simulation=true인 행"을 클라이언트에서 제거. 본 A2(b)는 이 숨김을
 *   유지하되 화이트리스트 예외만 추가.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 안전 원칙 (실데이터 무손상, 누락 0건):
 *  - customer_id가 NULL(워크인)인 행은 항상 보존.
 *  - 연결 고객이 is_simulation=false/NULL(실고객)인 행은 항상 보존.
 *  - EXPOSED_SIM_NAMES에 든 sim 고객(테스트 페르소나)은 노출(예외).
 *  - 시뮬레이션 조회 자체가 실패하면 원본을 그대로 반환(필터보다 무손상 우선).
 *
 * customers(is_simulation) 부분 인덱스 idx_customers_simulation WHERE is_simulation=true
 * 를 그대로 활용한다(시뮬레이션 집합만 조회).
 */

/** admin 노출을 현장이 명시 요청한 테스트 페르소나 이름(화이트리스트). */
export const EXPOSED_SIM_NAMES: ReadonlySet<string> = new Set(['토마토']);

export async function stripSimulationRows<R extends { customer_id?: string | null }>(
  rows: R[],
): Promise<R[]> {
  if (rows.length === 0) return rows;
  const ids = Array.from(
    new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x)),
  );
  if (ids.length === 0) return rows;

  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .in('id', ids)
    .eq('is_simulation', true);

  // 조회 실패 또는 시뮬레이션 0건 → 원본 유지(실데이터 누락 방지 우선)
  if (error || !data || data.length === 0) return rows;

  // 숨길 sim = is_simulation=true 이면서 화이트리스트(EXPOSED_SIM_NAMES)에 없는 고객
  const hiddenSim = new Set(
    (data as { id: string; name: string | null }[])
      .filter((c) => !EXPOSED_SIM_NAMES.has((c.name ?? '').trim()))
      .map((c) => c.id),
  );
  if (hiddenSim.size === 0) return rows;

  return rows.filter((r) => !r.customer_id || !hiddenSim.has(r.customer_id));
}
