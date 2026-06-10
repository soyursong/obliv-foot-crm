import { supabase } from '@/lib/supabase';

/**
 * 시뮬레이션(테스트 더미) 숨김 필터 — admin 예약/체크인 목록·캘린더용.
 *
 * T-20260610-foot-ADMIN-SIM-FILTER (root-cause)
 *
 * 배경: `is_simulation`은 customers 테이블에만 존재한다 (BOOLEAN DEFAULT FALSE,
 * 구 row는 NULL 가능). 예약(reservations)·체크인(check_ins)에는 컬럼이 없고
 * customer_id로 시뮬레이션 고객과 연결될 뿐이다. 따라서 "연결 고객이
 * is_simulation=true인 행"을 클라이언트에서 제거해 셀프접수(foot-checkin) 명단과
 * 정합시킨다.
 *
 * 안전 원칙 (AC-3 실데이터 무손상, 누락 0건):
 *  - customer_id가 NULL(워크인)인 행은 항상 보존.
 *  - 연결 고객이 is_simulation=false/NULL(실고객)인 행은 항상 보존.
 *  - 시뮬레이션 조회 자체가 실패하면 원본을 그대로 반환(필터보다 무손상 우선).
 *
 * customers(is_simulation) 부분 인덱스 idx_customers_simulation WHERE is_simulation=true
 * 를 그대로 활용한다(시뮬레이션 집합만 조회).
 */
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
    .select('id')
    .in('id', ids)
    .eq('is_simulation', true);

  // 조회 실패 또는 시뮬레이션 0건 → 원본 유지(실데이터 누락 방지 우선)
  if (error || !data || data.length === 0) return rows;

  const simSet = new Set((data as { id: string }[]).map((c) => c.id));
  return rows.filter((r) => !r.customer_id || !simSet.has(r.customer_id));
}
