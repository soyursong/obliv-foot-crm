/**
 * 시뮬레이션(테스트 더미) 행 필터 — admin 예약/체크인 목록·캘린더용.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * [현행 정책: 무필터 / pass-through] — T-20260612-foot-RESV-REVISIT-NOT-LISTED (A2)
 *
 *   현장 결정(김주연 총괄, 2026-06-13 확정): sim filter **정책 완화**.
 *   테스트/가상 고객(is_simulation=true, 예: "토마토")의 예약을 예약관리·대시보드
 *   admin 화면에도 노출한다. 셀프접수 명단(fn_selfcheckin_today_reservations)이
 *   이미 sim을 노출하고 있어 생긴 비대칭(admin만 숨김)을 해소 = 양쪽 일관 노출.
 *
 *   구현: 본 함수를 호출부 변경 없이 **그대로 통과(no-op)** 시킨다. 호출 위치
 *   (Reservations·Dashboard 4곳)와 시그니처를 보존해 정책을 되돌릴 때 이 파일
 *   1곳만 수정하면 되도록 한다.
 *
 * [구 정책: admin에서 sim 숨김] — T-20260610-foot-ADMIN-SIM-FILTER (superseded)
 *
 *   `is_simulation`은 customers 테이블에만 존재(BOOLEAN DEFAULT FALSE, 구 row NULL
 *   가능). 예약·체크인에는 컬럼이 없고 customer_id로만 연결된다. 구 정책은
 *   "연결 고객이 is_simulation=true인 행"을 클라이언트에서 제거해 admin 목록에서
 *   더미를 숨겼다. A2 결정으로 이 숨김을 완화(노출)한다.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 안전 원칙은 그대로 유지된다: 워크인(customer_id null)·실고객·sim 모두 보존(노출).
 */
export async function stripSimulationRows<R extends { customer_id?: string | null }>(
  rows: R[],
): Promise<R[]> {
  // A2 정책: sim 고객 예약도 admin에 노출 → 원본 그대로 통과.
  return rows;
}
