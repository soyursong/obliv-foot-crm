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

// ─────────────────────────────────────────────────────────────────────────────
// 매출 집계 방어 필터 — T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE
// ─────────────────────────────────────────────────────────────────────────────
//
// 표시매출(payments/package_payments) 집계 소스에서 is_simulation=true 고객의
// 결제를 상시 제외한다. 테스트/시뮬 데이터가 다시 유입돼도 표시매출을 부풀리지
// 못하게 하는 방어적 하드닝(원 사고: T-20260606-foot-D1-TESTDATA-CLEANUP, 624 sims).
//
// admin 목록/캘린더용 화이트리스트(EXPOSED_SIM_NAMES)와는 별개 축이다:
//   - EXPOSED_SIM_NAMES = "테스트 페르소나(토마토)를 admin 예약/캘린더에 *노출*"
//   - 본 필터        = "테스트 페르소나 매출을 표시매출 합계에서 *제외*"
// 매출은 재무 수치이므로 노출 예외 페르소나(토마토 등)도 매출에서는 전부 제외한다.
//
// revenue split SSOT(오가닉/광고·급여/비급여)와 직교
// [DA CONSULT GO — 조건부 OK, DA-REPLY-T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE.md]:
//   산식은 손대지 않고 입력 행집합에서 sim 고객 결제만 제거한다. 세금속성·
//   source_system·service_charges 산출 로직은 그대로이므로 집계 시맨틱 불변.
//   data-architect 판정 요약 (2026-07-09, MSG-20260709-231821-ngyi 회신):
//    · Q1 직교성 OK — split은 "행 분류", 본 필터는 "입력 행집합" (완전 직교).
//    · Q2 grain 안전 OK — sim 고객이 분자·분모 양쪽에서 동시 제외 → 비율 왜곡 0.
//    · Q3 폴백(빈 집합) OK — 실매출 누락 0 우선, fail-open이 옳음.
//    · Q4 화이트리스트 분리 OK(정확) — 노출(운영) ≠ 재무 포함(진실).
//
// [C1 binding] 제거는 split CASE 분기 *상류의 공유 입력 행집합*에서 (버킷 선택적용 금지).
//   → 각 탭은 분류/집계 loop *이전*에 excludeSimulationPaymentRows 로 행을 드롭 → 충족.
// [C2 binding] payments·package_payments·service_charges 를 *각 grain의 customer 링크
//   경로로 각각* 제거. foot prod 스키마상 세 grain 모두 customer_id 직결 컬럼 보유 →
//   동일 clinic-scoped simIds 를 각 grain의 자체 customer_id 로 적용(= grain별 링크 경로).
//   한쪽만 빼고 공단부담액(service_charges)을 남기면 §2-3 청구≠수납이 깨지므로,
//   DoctorTab 은 payments·service_charges 를 동일 simIds 로 함께 제외한다.
//   ※ closing_manual_payments 는 customer FK가 없어(staff_name 귀속) grain별 sim 판별
//     불가 → C2 폴백("판별 불가 시 무필터 유지, 부분 제거 금지")에 따라 필터 미적용.
//     실운영 sim=0 이므로 수기수납 경로 sim 오염 위험 0.
// [C3 follow-up] fail-open(빈 집합)을 로그로 표면화 — 아래 getSimulationCustomerIds 참조.
// [C4 follow-up] prod sim=0 이면 전 계층 no-op(현 divergence 0). 권위 매출 계층(마감
//   payload·silver fct_revenue_daily)의 동일 sim 제외 정합은 dev-crm/dev-sales 후속 추적
//   (본 FE 필터는 그 위의 방어심층 — 단독 진실원천 삼지 않음).
//
// 안전 원칙 (실매출 무손상, 누락 0):
//  - customer_id=NULL(워크인) 행은 항상 보존.
//  - 시뮬레이션 집합 조회 실패 시 빈 집합 반환 → 아무 것도 제외 안 함(필터보다 무손상 우선).
//
// customers(is_simulation) 부분 인덱스 idx_customers_simulation WHERE is_simulation=true
// 를 그대로 활용한다(시뮬레이션 집합만 조회 — 소량).

/**
 * clinic 내 is_simulation=true 고객 id 집합 조회.
 * 조회 실패 시 빈 집합(무손상 우선 — 제외하지 않음).
 *
 * [C3 follow-up — DA CONSULT] fail-open을 관측 가능하게:
 *   조회 실패 시 sim이 조용히 표시매출에 재유입될 수 있으므로(원사고 624 sim 부풀림 방향)
 *   실패를 console.warn 으로 표면화한다. silent no-op 금지 — 지속 실패 = "sim이 소리없이
 *   되살아남"을 로그로 감지 가능해야 함. (안정 prefix로 로그 수집·텔레메트리 편입 대상)
 */
export async function getSimulationCustomerIds(
  clinicId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('is_simulation', true);

  if (error || !data) {
    // C3: fail-open(빈 집합) 되 실패를 표면화 — sim silent 재유입 감지용.
    console.warn(
      '[SIM-FILTER-FAILOPEN] getSimulationCustomerIds lookup failed — ' +
        'sim 제외 미적용(fail-open, 실매출 누락 0 우선). ' +
        'T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE C3',
      { clinicId, error: error?.message ?? 'no-data' },
    );
    return new Set();
  }
  return new Set((data as { id: string }[]).map((c) => c.id));
}

/**
 * payments/package_payments/service_charges 행에서 sim 고객 결제를 제외.
 * customer_id=NULL(워크인) 행은 항상 보존한다.
 * simIds가 비어 있으면(실운영엔 sim 0건이 정상) 원본 그대로 반환 → 무변화.
 */
export function excludeSimulationPaymentRows<
  R extends { customer_id?: string | null },
>(rows: R[], simIds: ReadonlySet<string>): R[] {
  if (simIds.size === 0) return rows;
  return rows.filter((r) => !r.customer_id || !simIds.has(r.customer_id));
}
