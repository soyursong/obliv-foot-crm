// prescriptionGate — 처방 자유텍스트 입력 role 게이트
// T-20260603-foot-RX-CHART-FOLLOWUP2 #8-1b
//
// 정책(#8-1b):
//   부원장(vice_director)은 prescription_code_id 가 없는 "자유텍스트 임의입력" 처방을 추가할 수 없다.
//   director / manager / admin 은 자유텍스트 허용(종전 동작 유지).
//
//   ※ 차단 대상은 "자유 약명 임의입력"이지 "코드 선택"이 아님.
//     official(보험등재 499) 코드는 항상 prescription_code_id 를 보유하므로 부원장도 정상 선택 가능.
//     (등록약 스코프 미구현 상태이므로 official 499 = 현 시점 "허용 약" 전체 — #8-1b는 8-1 결정과 독립.)
//
//   fail-closed: code_id 유무를 "확인 가능"할 때만 통과. code_id 가 없으면(=자유텍스트) 부원장은 차단.
//   진입점 전체(빠른처방 · 차트 처방 · 처방세트/슈퍼상용구 로드)가 이 게이트를 단일 경유한다.

/** 부원장 — 자유텍스트 처방 금지(코드 선택만 허용) */
export const VICE_DIRECTOR_ROLE = 'vice_director';

/**
 * 자유텍스트 처방이 금지된 역할 집합.
 * 명시 차단 목록(블랙리스트)으로 두되, 미지정/불명 role 에 대해서는 게이트를 적용하지 않는다(종전 동작 보존).
 * 차단 판단의 fail-closed 는 "blocked role 이면서 code_id 없는 항목" 조합에서 작동한다.
 */
const FREETEXT_BLOCKED_ROLES = new Set<string>([VICE_DIRECTOR_ROLE]);

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
