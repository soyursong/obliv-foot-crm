// ─────────────────────────────────────────────────────────────────────────────
// cross-CRM 다지점 환자 인지 hint — placeholder/더미 제외술어 (선반영·각인용)
// T-20260709-foot-CROSSCRM-HINT-PHONEDUMMY-EXCLUDE
//   (data-architect IMPROVE-PROPOSAL DA-20260709-foot-CROSSCRM-HINT-PHONEDUMMY-EXCLUDE / 비강제·권고)
// ─────────────────────────────────────────────────────────────────────────────
//
// ── 이 파일은 무엇인가 (WHY: 각인) ───────────────────────────────────────────
//   cross-CRM "다지점 환자 인지 hint"(신규 환자 등록 시 phone 입력 시점에 타 CRM
//   등록 여부를 알려주는 hint, 설계문서 P1/G7)는 **현재 코드 0**(미구현·미티켓).
//   hint 를 나중에 빌드하면서 더미 제외절을 누락하면 `DUMMY-<uuid>` 무전화 워크인이
//   매칭 모집단에 새어들어 **false-hint**(다지점 아닌데 hint 뜸)가 발생한다.
//   → hint 를 빌드하는 그 시점부터 이 모듈의 canonical 제외술어를 쓰면 false-hint = 0.
//   지금은 소비자(hint UI/쿼리)가 없다. 이 모듈은 제약을 잃지 않기 위한 **선반영**이며,
//   hint 착수 시 FE·서버 어느 쪽 쿼리든 여기의 술어를 그대로 참조하면 된다.
//
// ── canonical 제외술어 = 플래그 OR 값 (계약 §68 line75) ──────────────────────
//   phone 이 아래 둘 중 하나라도 placeholder 신호면 매칭 모집단에서 제외:
//     (1) 플래그: `phone_dummy = true`  (= `(phone_dummy IS NULL OR phone_dummy=false)` 위반)
//     (2) 값:     `phone ∈ PLACEHOLDER_PHONE_SET`  (플래그가 안 붙은 값-영속 경로 방어)
//   플래그 단독·값 단독 모두 반려(계약: 307건 placeholder-값-영속 경로가 flag=false 로 샘).
//
// ── 4곳-동치 불변식 (계약 §69 line77) — ⚠ 새 토큰 발명 금지 ────────────────────
//   값-술어 isPlaceholderPhoneValue() 는 foot prod 에 배포된
//   `public.is_dummy_phone(text)` (마이그 20260709120000_foot_customers_phone_dummy_add_trigger.sql,
//   dopamine 정본 20260706130000 문자-동치 복제)의 JS 미러다. 두 구현은 **항상 등가**여야 한다.
//   여기에 §69 PLACEHOLDER_PHONE_SET 의 raw 비정규화 변형(정규화 우회 방어)을 값-집합에 병행한다.
//   신규 placeholder 토큰 편입은 계약 §69 line77 "4곳 동시 갱신 게이트"(planner TICKET-REQ) 대상 —
//   이 파일 단독 확장 금지(값-술어/플래그-술어 불일치 재발).
//
// ── SSOT ──────────────────────────────────────────────────────────────────────
//   agents/docs/cross_crm_data_contract.md §68(제외술어)·§69(PLACEHOLDER_PHONE_SET 정본집합)
//   Cross-CRM 다지점 환자 인지 Hint 설계 문서 (G7)
//
// ── 순수성 (import 0) ─────────────────────────────────────────────────────────
//   이 모듈은 어떤 런타임 의존(supabase 등)도 import 하지 않는다. FE·EF·spec 어디서든
//   부담 없이 재사용 가능하도록 순수 함수/상수만 노출한다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PLACEHOLDER_PHONE_SET — placeholder 정본 값-집합 (계약 §69).
 *
 * foot 저장 canon 은 E.164 (`normalizeToE164` 선행)이나, hint 는 phone **입력 시점**에
 * 발화하므로 정규화 이전 raw 변형이 도달할 수 있다. 따라서 is_dummy_phone() SQL 의
 * 6 리터럴 + §69 raw 변형(하이픈/부분 E.164)을 함께 담아 정규화 우회를 방어한다.
 *
 * ⚠ 확장은 계약 §69 line77 4곳-동치 게이트 대상 — 이 상수 단독 편집 금지.
 */
export const PLACEHOLDER_PHONE_SET: ReadonlySet<string> = new Set([
  // is_dummy_phone() SQL 정본 6 리터럴 (dopamine 정본 문자-동치)
  '+821000000000',
  '+82000000000',
  '01000000000',
  '821000000000',
  '82100000000',
  '8201000000000',
  // §69 raw 비정규화 변형 (정규화 우회 방어)
  '010-0000-0000',
  '+82100000000',
  '+8210-0000-0000',
  // §69 all-zero/미상 선례 (§66 CRM)
  'UNKNOWN',
  '0000000000',
]);

/**
 * 값-패턴 술어 (리터럴 집합으로 못 잡는 형태) — is_dummy_phone() SQL 과 등가.
 *  - DUMMY_TOKEN: `DUMMY-<uuid>` 결정적 더미토큰(무전화 외국인 셀프접수 / §66 Name-only / SNS-only).
 *  - ALL_SAME_SUBSCRIBER: `+82` + 캐리어 + 가입자 전부 동일숫자 (is_dummy_phone regex 문자-동치).
 *  - ALL_ZERO: §69 all-zero 정규식.
 */
const DUMMY_TOKEN_RE = /^DUMMY-/;
const ALL_SAME_SUBSCRIBER_RE = /^\+82(1[016789])(\d)\2{6,7}$/;
const ALL_ZERO_RE = [/^\+?8?2?0*$/, /^0{5,}$/];

/**
 * isPlaceholderPhoneValue — 값 기반 placeholder 판정 (계약 §68/§69 값-술어).
 *
 * foot prod `public.is_dummy_phone(text)` 의 JS 미러 + §69 raw 변형 방어.
 * true = 전화 아님(placeholder/더미/식별자) → hint 매칭 모집단에서 제외.
 *
 * @example
 *   isPlaceholderPhoneValue('DUMMY-3f2a…')     // true  (무전화 워크인)
 *   isPlaceholderPhoneValue('+821000000000')   // true  (동행 기본값 canonical)
 *   isPlaceholderPhoneValue('010-0000-0000')   // true  (raw 변형)
 *   isPlaceholderPhoneValue('+821012345678')   // false (진성 번호)
 */
export function isPlaceholderPhoneValue(phone: string | null | undefined): boolean {
  if (phone == null) return true;
  const t = phone.trim();
  if (t === '') return true;
  if (PLACEHOLDER_PHONE_SET.has(t)) return true;
  if (DUMMY_TOKEN_RE.test(t)) return true;
  if (ALL_SAME_SUBSCRIBER_RE.test(t)) return true;
  if (ALL_ZERO_RE.some((re) => re.test(t))) return true;
  return false;
}

/** hint 매칭 후보 행의 최소 형태 (phone + phone_dummy 파생 플래그). */
export interface HintCandidateRow {
  phone?: string | null;
  /** customers.phone_dummy 파생 플래그(트리거 자동). 조회에 없으면 값-술어만으로 판정. */
  phone_dummy?: boolean | null;
}

/**
 * isHintExcluded — canonical 제외술어(플래그 OR 값, 계약 §68 line75).
 *
 * true = 매칭 모집단에서 제외(= hint 후보 아님). 플래그·값 어느 쪽 신호든 제외.
 *   제외 ⇔  phone_dummy=true  OR  isPlaceholderPhoneValue(phone)
 *   포함 ⇔  (phone_dummy IS NULL OR false)  AND  phone ∉ PLACEHOLDER_PHONE_SET
 */
export function isHintExcluded(row: HintCandidateRow): boolean {
  if (row.phone_dummy === true) return true; // 플래그-술어
  return isPlaceholderPhoneValue(row.phone); // 값-술어
}

/**
 * filterHintCandidates — hint 매칭 후보 행에서 placeholder/더미를 제거(false-hint 0).
 *
 * simulationFilter 의 excludeSimulationPaymentRows 와 동형인 FE-측 방어심층 술어.
 * 서버 쿼리(RPC/EF/뷰)가 HINT_ELIGIBLE_SQL_PREDICATE 로 이미 걸렀더라도,
 * 소비 직전 한 번 더 적용해 belt-and-suspenders 로 false-hint 를 0 으로 만든다.
 */
export function filterHintCandidates<R extends HintCandidateRow>(rows: R[]): R[] {
  return rows.filter((r) => !isHintExcluded(r));
}

/**
 * HINT_ELIGIBLE_SQL_PREDICATE — 서버측 hint 쿼리(RPC/EF/뷰) WHERE 절에 그대로 붙이는
 * canonical 매칭-적격 술어. 계약 §68 line75 "플래그 OR 값" 의 부정형(= 적격).
 *
 * ⚠ 리터럴 enumeration 은 IMMUTABLE-safe(§69) — 인덱스 술어로도 사용 가능.
 *   정규화 backfill(§34 E.164)이 완료된 컬럼이면 값-집합은 `+821000000000` 단일값으로
 *   수렴하나, 방어를 위해 전 리터럴을 유지한다.
 *
 * 사용 예 (hint 빌드 시):
 *   SELECT id, name, clinic_id FROM customers
 *    WHERE <조인/매칭 조건> AND ${HINT_ELIGIBLE_SQL_PREDICATE}
 */
export const HINT_ELIGIBLE_SQL_PREDICATE: string = [
  '(phone_dummy IS NULL OR phone_dummy = false)',
  "AND coalesce(btrim(phone), '') <> ''",
  "AND phone NOT LIKE 'DUMMY-%'",
  "AND btrim(phone) NOT IN (" +
    Array.from(PLACEHOLDER_PHONE_SET)
      .map((v) => `'${v}'`)
      .join(', ') +
    ')',
  String.raw`AND btrim(phone) !~ '^\+82(1[016789])(\d)\2{6,7}$'`,
].join('\n  ');
