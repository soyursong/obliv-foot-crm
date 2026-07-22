// T-20260522-crm-PAY-RECON-EMPTYKEY-TEST
// G4 빈키 Guard — 순수 함수 모듈 (vitest 단위 테스트 가능)
//
// 목적:
//   REDPAY_API_KEY / REDPAY_BUSINESS_NO 중 하나라도 비어있을 경우
//   silent exit(blocked) 응답을 반환 + 알림 발사 없음.
//
//   키 회전·env 변경 시 G4 Guard 깨짐을 자동화 테스트로 감지.
//   (Supabase / Deno 의존 없음 → vitest로 단위 테스트 가능)

export interface G4GuardResult {
  blocked: boolean;
  reason?: string;
}

export interface G4EnvInput {
  apiKey:      string;
  businessNo:  string;
  tidWhitelist: string;
  dryRun:      string;
}

/**
 * G4 빈키 Guard 체크
 *
 * - apiKey 또는 businessNo 비어있음 → blocked:true
 * - tidWhitelist 비어있음 → blocked:false (전체 TID 조회, 정상 동작)
 * - dryRun 비어있음 → blocked:false (기본값 "true"로 DRY_RUN 모드 동작)
 */
export function checkG4Guard(env: G4EnvInput): G4GuardResult {
  if (!env.apiKey || !env.businessNo) {
    return {
      blocked: true,
      reason:
        "REDPAY_API_KEY 또는 REDPAY_BUSINESS_NO 환경변수 미등록. " +
        "D1·D2 도착 후 Supabase Vault 등록 필요.",
    };
  }
  return { blocked: false };
}

/**
 * DRY_RUN 환경변수 해석
 * 비어있거나 미설정이면 true(safe default)
 */
export function parseDryRun(dryRunEnv: string): boolean {
  if (dryRunEnv === "") return true;   // 기본값 = true (safe)
  return dryRunEnv === "true";
}

/**
 * match_only 쓰기 재잠금 판정 (gate#3 조건2 단일 kill-switch)
 *
 *   match_only 모드는 레드페이 API 를 호출하지 않지만, 4-Tier 매처가
 *   payments.reconciled_at / redpay_raw_transactions.matched_payment_id /
 *   payment_reconciliation_log 에 "쓰기"를 수행한다(맥스튜디오 폴러 라이브 쓰기 경로).
 *   따라서 이 경로도 REDPAY_DRY_RUN 을 존중해야 한다(과거엔 우회 = 재잠금 사각).
 *
 *   - dryRunEnv='true'(또는 빈값/미설정) → 쓰기 차단(true 반환) = 재잠금.
 *   - dryRunEnv='false'               → 쓰기 허용(false 반환).
 *   parseDryRun 과 동일 해석(safe default = 재잠금).
 */
export function shouldBlockMatchOnlyWrites(dryRunEnv: string): boolean {
  return parseDryRun(dryRunEnv);
}

/**
 * TID 화이트리스트 파싱
 * 비어있으면 빈 배열 반환 → 전체 TID 조회 (정상 동작)
 */
export function parseTidWhitelist(tidEnv: string): string[] {
  if (!tidEnv) return [];
  return tidEnv.split(",").map((t) => t.trim()).filter(Boolean);
}
