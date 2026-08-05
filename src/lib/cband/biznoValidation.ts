/**
 * cband/biznoValidation.ts — 단말 등록 시점 사업자번호 능동 대조(순수·결정론·테스트가능)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260805-foot-TERMINAL-REGISTER-BIZNO-VALIDATION (UX-GUARD · spin-off of REDPAY-INVISIBLE ④)
 *
 * ── 봉합하는 구조 갭 ──────────────────────────────────────────────────────────
 *   단말 TID 1047479470 이 구 사업자번호(511-60-00988)로 등록돼 RedPay 정산 사각(전 기간
 *   조회 0건)이 발생했다. 재발 방지 = 등록 시점에 사업자번호를 능동 대조.
 *
 *   자매 T-20260805-foot-TERM-BIZNO-VERIFY-UX 는 (a) 정적 확인 가이드 배너와
 *   (b) TID↔registry allowlist 대조(tidRegistryGate)를 붙였다. 그러나 스태프가 단말
 *   [특수]→시스템→910115→가맹점정보조회 화면에서 실제로 읽은 사업자번호 자체를 입력·대조하는
 *   능동 검증은 없었다. 본 모듈이 그 축(사업자번호 값 대조)을 채운다 — TID 축과 직교.
 *
 * ── AC 대응 ──────────────────────────────────────────────────────────────────
 *   AC-1: 스태프가 910115 조회 결과 사업자번호를 입력하면 기대값(457-23-00938)과 대조.
 *   AC-2: 구번호(511-60-00988) 또는 임의 불일치 감지 → 경고 verdict 반환(호출측 soft-block/confirm).
 *   AC-3: 910115 조회 API 부재(census) → 자동 취득 불가 → 스태프 수동 입력 기반 대조로 착지.
 *
 * ── 불변식 ───────────────────────────────────────────────────────────────────
 *   · 순수 함수 only — DB·네트워크·localStorage·시각 무접촉(호출측이 상태·로깅 담당).
 *   · 대조는 숫자만(digits) 정규화 후 수행 — 하이픈·공백 유무에 무관.
 *   · 빈 입력 = 'empty'(미입력 — 경고 아님, 저장 흐름을 막지 않는다).
 */

/** 이 가맹점의 올바른 사업자번호 — 현장 [특수]→시스템→910115→가맹점정보조회 값과 대조. */
export const EXPECTED_FOOT_BIZNO = '457-23-00938';
/** 정산 사각을 만든 구(舊) 사업자번호 — 단말이 이 번호를 물고 있으면 RedPay 조회 0건. */
export const STALE_FOOT_BIZNO = '511-60-00988';

/** 사업자번호에서 숫자만 추출(하이픈·공백·기타 문자 제거). 대조·정규화의 단일 기준. */
export function normalizeBizno(raw: string | null | undefined): string {
  return (raw ?? '').toString().replace(/\D/g, '');
}

/**
 * 숫자 10자리를 표준 사업자번호 표기(XXX-XX-XXXXX)로 포맷. 자리 미달이면 있는 만큼만 하이픈.
 *   입력 UX 표시·verdict 메시지에 사용(대조 자체는 normalizeBizno 기준).
 */
export function formatBizno(raw: string | null | undefined): string {
  const d = normalizeBizno(raw).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export type BiznoStatus =
  | 'match'     // 입력값 == 기대 사업자번호 → 정상.
  | 'stale'     // 입력값 == 구(舊) 사업자번호(정산 사각 유발) → 강한 경고.
  | 'mismatch'  // 입력값이 기대·구 어느 것과도 다름 → 경고(오등록 가능).
  | 'empty';    // 미입력/자리 미달 → 미판정(경고 아님).

export interface BiznoVerdict {
  status: BiznoStatus;
  /** 정규화(숫자만)한 입력값. */
  normalized: string;
  /** 표준 표기로 포맷한 입력값(표시용). */
  formatted: string;
  /** 저장을 confirm 게이트로 막아야 하는가(stale/mismatch = true). hard-block 아님(현장 확인 게이트). */
  shouldBlock: boolean;
}

/**
 * 입력 사업자번호를 기대/구 값과 대조해 verdict 반환(AC-1·AC-2).
 *   · 10자리 미만 = 'empty'(미완 입력 — 아직 판정하지 않음).
 *   · == 기대 → 'match', == 구번호 → 'stale', 그 외 → 'mismatch'.
 *   · shouldBlock = stale||mismatch (호출측이 soft-block/confirm 게이트로 사용).
 */
export function classifyBizno(
  input: string | null | undefined,
  opts?: { expected?: string; stale?: string },
): BiznoVerdict {
  const expected = normalizeBizno(opts?.expected ?? EXPECTED_FOOT_BIZNO);
  const stale = normalizeBizno(opts?.stale ?? STALE_FOOT_BIZNO);
  const normalized = normalizeBizno(input);
  const formatted = formatBizno(input);

  // 사업자번호는 10자리 — 자리 미달이면 아직 판정하지 않는다(입력 중).
  if (normalized.length < 10) {
    return { status: 'empty', normalized, formatted, shouldBlock: false };
  }
  let status: BiznoStatus;
  if (normalized === expected) status = 'match';
  else if (normalized === stale) status = 'stale';
  else status = 'mismatch';

  return {
    status,
    normalized,
    formatted,
    shouldBlock: status === 'stale' || status === 'mismatch',
  };
}
