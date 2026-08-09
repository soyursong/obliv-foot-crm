/**
 * cband/seatLimitPolicy.ts — 카드 단말(코밴/섹타나인) 자리(TID)별 500만원 한도 '경고' 정책 (순수)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260807-foot-COVAN-500MAN-PREBLOCK-TO-WARN — 하드 사전차단 → 경고 후 진행.
 *
 * ── 배경(reporter 최필경 총괄 제공) ────────────────────────────────────────────
 *   PKG-PAY-EXPAND(commit 54d3478e)가 도입한 "건당 500만원 초과 하드 사전차단"을 제거하고,
 *   **P2 자리(경고 대상)에서 500만원 초과일 때만** 확인창을 띄운 뒤 실장이 '진행'을 누르면
 *   그대로 단말로 전송한다. 진짜 한도가 500만보다 높으면 성공, 낮으면 단말이 알아서 거절한다.
 *   → 500만이라는 값이 **미확정**(레드페이 회신: 섹타나인 측 설정 한도 추정, 정확 기준·상향 여부 확인 중)이므로
 *     확정 안 된 값으로 결제를 '미리' 막지 않는다.
 *
 * ── 자리(TID) 분류 규칙 (reporter 제공 — 39개 전수, 2026-02~08-07 레드페이 실데이터) ─────────
 *   · **P2**(경고 대상, 26개): 가맹점명에 "(VAN)" **미포함**. 500만원 초과 시 확인창 노출 → 진행 선택 시 전송.
 *   · **P3**(경고 없음, 13개): 가맹점명에 "(VAN)" **포함**. 금액 무관 바로 전송(870만원 정상 처리 실측).
 *   · **미등재 TID**: 경고 없이 진행(모르는 자리를 경고로 막는 것보다 단말 실거절이 정확 — reporter 명시).
 *   ★목록(아래 상수)이 SSOT다. (VAN) 문자열 규칙은 목록 도출의 근거이며, FE 결제 경로엔 가맹점명이 없으므로
 *     목록 대조만으로 판별한다(미등재=UNLISTED → 무경고, AC-2c 정합).
 *   ★AC-4(b): 향후 자리 증감 시 이 목록만 수정 — 분류/경고 로직은 무변경.
 */

import { exceedsPerTxnLimit } from './protocol';

export type SeatClass = 'P2' | 'P3' | 'UNLISTED';

/**
 * ★P2 자리 TID (26개) — "(VAN)" 미포함 = 경고 대상.
 *   500만원 초과일 때만 확인창(경고 후 진행). AC-2.
 */
export const P2_SEAT_TIDS: ReadonlySet<string> = new Set<string>([
  '1047538231', '1047538233', '1047538235', '1047538236', '1047538237',
  '1047538239', '1047538241', '1047538243', '1047538244', '1047538245',
  '1047538246', '1047479153', '1047479155', '1047479158', '1047479469',
  '1047479471', '1047479472', '1047479473', '1047479474', '1047479475',
  '1047479477', '1047479478', '1047479479', '1047479480', '1047479481',
  '1047479483',
]);

/**
 * ★P3 자리 TID (13개) — "(VAN)" 포함 = 경고 없음(금액무관 통과, 870만원 정상 실측).
 *   P2용 경고를 P3에 노출 금지(AC-2b).
 */
export const P3_SEAT_TIDS: ReadonlySet<string> = new Set<string>([
  '1047535797', '1047535835', '1047535837', '1047535842', '1047535843',
  '1047535845', '1047479254', '1047479255', '1047479261', '1047479262',
  '1047479263', '1047479264', '1047479268',
]);

/** TID 정규화(trim). null/undefined → 빈 문자열. */
function normalizeTid(tid: string | null | undefined): string {
  return String(tid ?? '').trim();
}

/**
 * ★자리(TID) 분류 — 목록 SSOT 대조. 미등재/빈값 = UNLISTED(무경고 진행, AC-2c).
 */
export function classifySeatTid(tid: string | null | undefined): SeatClass {
  const t = normalizeTid(tid);
  if (!t) return 'UNLISTED';
  if (P2_SEAT_TIDS.has(t)) return 'P2';
  if (P3_SEAT_TIDS.has(t)) return 'P3';
  return 'UNLISTED';
}

/**
 * ★경고 노출 판정(순수) — 경고는 **P2 자리 AND 500만원 초과**일 때만 true.
 *   · P3(가맹점명 (VAN)) = 항상 false(금액무관 통과, AC-2b).
 *   · 미등재 = 항상 false(무경고 진행, AC-2c).
 *   · 한도 이하(≤500만) = 항상 false(회귀 0, AC-2 시나리오 3).
 *   true 여도 하드차단이 아니라 확인창을 띄우는 신호일 뿐 — 실장이 '진행'을 누르면 그대로 전송한다(AC-1).
 */
export function shouldWarnOverLimit(tid: string | null | undefined, amount: number): boolean {
  return classifySeatTid(tid) === 'P2' && exceedsPerTxnLimit(amount);
}

/**
 * ★확인창 문구(reporter 최필경 총괄 확정 verbatim) — AC-3.
 *   dev 초안 아님. 자간/스타일만 재량, 문구 자체는 그대로 노출한다.
 */
export const OVER_LIMIT_WARN_MESSAGE =
  '이 자리는 500만원을 넘는 결제가 되지 않을 수 있습니다. (확인 중인 사항입니다) 그래도 진행하시겠습니까?';
