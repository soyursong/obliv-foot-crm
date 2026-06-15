// prescriptionGate — 처방 자유텍스트 입력 role 게이트
// T-20260603-foot-RX-CHART-FOLLOWUP2 #8-1b
//
// ⚠️ SUPERSEDED(2026-06-15, T-20260606-foot-RX-DRUG-WHITELIST): 부원장 자유텍스트 차단(#8-1b)은
//    '등록약 스코프 미구현' 잠정 통제였고, 이제 처방 가능 약은 검색 출처를 처방세트 등록약(services 처방약)으로
//    제한하는 화이트리스트가 전직원 동일하게 통제한다(대표원장 문지은 확정 — 역할 분기 없음).
//    → FREETEXT_BLOCKED_ROLES = 빈 집합(checkRxRoleGate 항상 allowed). 함수/시그니처는 호출부 호환 위해 보존.
//    아래 #8-1b 정책 설명은 히스토리(역할 분기 retire 전 동작)로만 읽을 것.
//
// 정책(#8-1b, 히스토리):
//   부원장(vice_director)은 prescription_code_id 가 없는 "자유텍스트 임의입력" 처방을 추가할 수 없다.
//   director / manager / admin 은 자유텍스트 허용(종전 동작 유지).
//
//   ※ 차단 대상은 "자유 약명 임의입력"이지 "코드 선택"이 아님.
//     official(보험등재 499) 코드는 항상 prescription_code_id 를 보유하므로 부원장도 정상 선택 가능.
//     (등록약 스코프 미구현 상태이므로 official 499 = 현 시점 "허용 약" 전체 — #8-1b는 8-1 결정과 독립.)
//
//   fail-closed: code_id 유무를 "확인 가능"할 때만 통과. code_id 가 없으면(=자유텍스트) 부원장은 차단.
//   진입점 전체(빠른처방 · 차트 처방 · 처방세트/슈퍼상용구 로드)가 이 게이트를 단일 경유한다.

/** 부원장 role 식별자(상수 유지 — 외부 import 호환). */
export const VICE_DIRECTOR_ROLE = 'vice_director';

/**
 * 자유텍스트 처방이 금지된 역할 집합.
 *
 * ⚠️ T-20260606-foot-RX-DRUG-WHITELIST (2026-06-15 대표원장 문지은 확정): **전직원 동일 규칙**으로 전환.
 *   #8-1b 의 "부원장만 자유텍스트 차단"은 '등록약 스코프 미구현' 상태의 잠정 통제였고(아래 본 모듈 상단 주석),
 *   이제 처방 가능 약 통제는 **검색 출처를 처방세트 등록약(services 처방약)으로 제한**하는 화이트리스트가 담당한다.
 *   화이트리스트 약(services)은 prescription_code_id=null 이라 종전 게이트가 부원장만 차단 → AC-2(역할 분기 없음) 위배.
 *   → 역할 분기 retire(빈 집합). 게이트 함수/시그니처는 호출부 호환 위해 보존(항상 allowed 반환).
 *   ticket risk_reason 승인범위: "권한 모델 단순화(부원장만 제한 X → 전직원 동일, 대표원장 명시 confirm)".
 */
const FREETEXT_BLOCKED_ROLES = new Set<string>([]);

/** 해당 role 이 자유텍스트 처방 금지 대상인지 */
export function isFreeTextRxBlockedRole(role: string | null | undefined): boolean {
  return FREETEXT_BLOCKED_ROLES.has((role ?? '').trim());
}

/** prescription_code_id 가 없는(=자유텍스트) 항목인지 */
function isFreeTextItem(item: { prescription_code_id?: string | null }): boolean {
  const id = item.prescription_code_id;
  return id === undefined || id === null || `${id}`.trim() === '';
}

export interface RxRoleGateResult {
  /** 처방 추가 허용 여부 */
  allowed: boolean;
  /** 차단된 자유텍스트 약 이름 목록(사용자 안내용) */
  blockedNames: string[];
}

/**
 * 처방 추가 role 게이트.
 *
 * @param role  현재 사용자 role
 * @param items 추가하려는 처방 항목들
 * @returns allowed=false 이면 자유텍스트 약이 포함되어 부원장이 추가할 수 없는 상태.
 */
export function checkRxRoleGate(
  role: string | null | undefined,
  items: { name?: string; prescription_code_id?: string | null }[],
): RxRoleGateResult {
  if (!isFreeTextRxBlockedRole(role)) return { allowed: true, blockedNames: [] };
  const blocked = (items ?? []).filter(isFreeTextItem);
  return {
    allowed: blocked.length === 0,
    blockedNames: blocked.map((b) => (b.name ?? '').trim() || '(이름 없음)'),
  };
}

/** 부원장 자유텍스트 차단 시 공통 안내 문구 */
export function rxRoleGateMessage(blockedNames: string[]): string {
  const tail = blockedNames.length ? ` (차단: ${blockedNames.join(', ')})` : '';
  return `부원장은 자유 처방을 입력할 수 없습니다. 약품 검색으로 등재 코드를 선택하세요.${tail}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 급여여부(보험상태) 게이트 — T-20260609-foot-DRUG-INSURANCE-GATE Phase1 (DECISION 2-B)
//
// 정책:
//   prescription_codes.insurance_status 가 차단상태(non_covered/deleted/criteria_changed)인 약을
//   처방 추가하려 하면 경고+차단. 관리자 권한(admin/manager/director)은 "확인 후 override" 가능.
//     · covered(급여)            → 통과
//     · NULL(미설정)             → 통과(fail-open degrade — Phase1 점진 적용, planner LOCK)
//     · non_covered/deleted/criteria_changed → 차단(관리자 해제 가능)
//   금기증 게이트(AC-2)와 동일하게 prescription_code_id 기준만 매칭(약명 텍스트 매칭 금지 — 오탐 차단).
//
//   ⚠️ Phase1 = FE 게이트(fail-open). 사용자=임상 스태프(적대 위협모델 아님)이므로 FE게이트+role override로 충족.
//      서버측 강제(medical_charts UPDATE trigger/RPC)는 Phase1.5 하드닝 후보 — 현 시점 미구현.
//      (planner §8 판정: Phase1 차단사유 아님 / 신규 현장 DECISION 미발행 / 재논의 노이즈 차단.)
// ═══════════════════════════════════════════════════════════════════════════

/** 급여상태 enum (prescription_codes.insurance_status CHECK 와 동일) */
export type InsuranceStatus = 'covered' | 'non_covered' | 'deleted' | 'criteria_changed';

/** 처방을 막는 차단상태 집합 (covered/NULL 은 통과) */
export const INSURANCE_BLOCKED_STATUSES = new Set<InsuranceStatus>([
  'non_covered',
  'deleted',
  'criteria_changed',
]);

/** 차단상태를 관리자 권한으로 해제(override)할 수 있는 role (= "관리자 해제" 주체) */
export const RX_INSURANCE_OVERRIDE_ROLES = new Set<string>(['admin', 'manager', 'director']);

/** 한국어 라벨 (UI/안내문 공통) */
const INSURANCE_STATUS_LABEL: Record<InsuranceStatus, string> = {
  covered: '급여',
  non_covered: '비급여',
  deleted: '급여 삭제',
  criteria_changed: '급여기준 변경',
};

export function insuranceStatusLabel(status: string | null | undefined): string {
  const s = (status ?? '').trim() as InsuranceStatus;
  return INSURANCE_STATUS_LABEL[s] ?? '미설정';
}

/** 해당 상태가 처방 차단상태인지 */
export function isInsuranceBlockedStatus(status: string | null | undefined): boolean {
  return INSURANCE_BLOCKED_STATUSES.has((status ?? '').trim() as InsuranceStatus);
}

/** 해당 role 이 급여 차단상태를 해제(override)할 수 있는지 */
export function canOverrideRxInsuranceGate(role: string | null | undefined): boolean {
  return RX_INSURANCE_OVERRIDE_ROLES.has((role ?? '').trim());
}

export interface RxInsuranceBlockedItem {
  name: string;
  status: InsuranceStatus;
}

export interface RxInsuranceGateResult {
  /** 차단상태 약이 없어 곧장 진행 가능한지 (role 무관 — 순수 차단 판정) */
  allowed: boolean;
  /** 차단상태가 있을 때, 현재 role 이 관리자 해제(override) 가능한지 */
  overridable: boolean;
  /** 차단상태 약 목록(경고/차단 안내용 — override role 에서도 채워짐) */
  blocked: RxInsuranceBlockedItem[];
}

/**
 * 급여여부 게이트 (순수 함수).
 * items 는 insurance_status 가 부착된 상태여야 한다(조회는 호출부 async helper 담당).
 *
 * @param role  현재 사용자 role
 * @param items insurance_status 부착 처방 항목들
 * @returns allowed=false 이면 차단상태 약 포함. overridable 로 관리자 해제 여부 분기.
 */
export function checkRxInsuranceGate(
  role: string | null | undefined,
  items: { name?: string; prescription_code_id?: string | null; insurance_status?: string | null }[],
): RxInsuranceGateResult {
  const overridable = canOverrideRxInsuranceGate(role);
  const blocked: RxInsuranceBlockedItem[] = (items ?? [])
    .filter((it) => isInsuranceBlockedStatus(it.insurance_status))
    .map((it) => ({
      name: (it.name ?? '').trim() || '(이름 없음)',
      status: (it.insurance_status ?? '').trim() as InsuranceStatus,
    }));
  return {
    allowed: blocked.length === 0,
    overridable,
    blocked,
  };
}

/** 차단 약 목록 → "약명(상태)" 문자열 */
function formatBlockedList(blocked: RxInsuranceBlockedItem[]): string {
  return blocked.map((b) => `${b.name}(${insuranceStatusLabel(b.status)})`).join(', ');
}

/** 비-관리자 차단 안내(토스트 error) — 처방 불가 + 관리자 해제 안내 */
export function rxInsuranceGateMessage(blocked: RxInsuranceBlockedItem[]): string {
  if (blocked.length === 0) return '';
  return `급여 중지/삭제/기준변경 약품은 처방할 수 없어요: ${formatBlockedList(blocked)}. 관리자 해제가 필요합니다.`;
}

/** 관리자 해제(override) 확인창 문구 — "확인 후 override" */
export function rxInsuranceOverrideConfirm(blocked: RxInsuranceBlockedItem[]): string {
  return `다음 약품은 급여 주의 상태입니다: ${formatBlockedList(blocked)}.\n관리자 권한으로 계속 진행하시겠어요?`;
}
