/**
 * cband/config.ts — 코밴 CAT 단말 로컬 설정(TID/MERNO/CAT_PORT) 조회
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 로컬 단말 설정)
 *
 * 단말·케이블·COM포트·정산은 총괄(최필경)이 로컬 PC 에서 담당(역할구분).
 *   → CRM 은 로컬 PC 별로 다른 단말 설정(TID/MERNO/CAT_PORT)을 읽기만 한다.
 *   우선순위: localStorage(PC별 세팅) > env(VITE_CBAND_*) . 미설정 시 null(결제 불가·버튼 숨김 유지).
 *
 *   ★실측#1: TID 비우면 단말이 거부 → 설정 없으면 결제 진입 자체를 막는다(buildMsg 이전 차단).
 */

const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

export interface CbandTerminalConfig {
  tid: string;
  merno: string;
  /** COM 포트(숫자 또는 "COM3"/"03"). protocol.pad2Port 가 2자리 zero-pad. */
  catPort: number | string;
}

const LS_KEY = 'cband.terminal.config';

function fromLocalStorage(): Partial<CbandTerminalConfig> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : null;
  } catch { return null; }
}

/** 로컬 단말 설정 조회. TID·MERNO 둘 다 있어야 유효(없으면 null → 결제 진입 차단). */
export function getTerminalConfig(): CbandTerminalConfig | null {
  const ls = fromLocalStorage() ?? {};
  const tid = (ls.tid ?? viteEnv.VITE_CBAND_TID ?? procEnv.VITE_CBAND_TID ?? '').toString().trim();
  const merno = (ls.merno ?? viteEnv.VITE_CBAND_MERNO ?? procEnv.VITE_CBAND_MERNO ?? '').toString().trim();
  const portRaw = (ls.catPort ?? viteEnv.VITE_CBAND_PORT ?? procEnv.VITE_CBAND_PORT ?? '').toString().trim();
  if (!tid || !merno || !portRaw) return null; // 실측#1: TID/MERNO/PORT 미설정 → 결제 불가
  return { tid, merno, catPort: portRaw };
}

/**
 * 프리필/부분표시용 원시 설정(LS > env). getTerminalConfig 와 달리 3값 완비를 요구하지 않고
 * 각 값을 그대로(빈문자 가능) 돌려준다.
 *   ★T-20260803-foot-CBAND-TIDCOM-POPUP-PLACEMENT ②: 코밴 결제 Dialog 안 TID/COM 팝업의
 *     프리필 + 저장여부 판정(TID·COM 2필드) + merno 계승(⑧/env 값 보존)에 사용.
 */
export function getTerminalConfigRaw(): { tid: string; merno: string; catPort: string } {
  const ls = fromLocalStorage() ?? {};
  const tid = (ls.tid ?? viteEnv.VITE_CBAND_TID ?? procEnv.VITE_CBAND_TID ?? '').toString().trim();
  const merno = (ls.merno ?? viteEnv.VITE_CBAND_MERNO ?? procEnv.VITE_CBAND_MERNO ?? '').toString().trim();
  const catPort = (ls.catPort ?? viteEnv.VITE_CBAND_PORT ?? procEnv.VITE_CBAND_PORT ?? '').toString().trim();
  return { tid, merno, catPort };
}

/** PC별 단말 설정 저장(설정 화면용 — 총괄이 로컬에서 세팅). */
export function saveTerminalConfig(cfg: CbandTerminalConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

/** 테스트 검증 금액(1,001~1,006원). ★1,004 는 실거래 충돌 금지목록이라 제외.
 *  금지: 100/1,000/1,004/1,234(실거래 충돌). (티켓 §검증규칙) */
export const CBAND_TEST_AMOUNTS = [1001, 1002, 1003, 1005, 1006] as const;
/** 실거래 충돌로 테스트 금지 금액(§검증규칙). */
export const CBAND_FORBIDDEN_TEST_AMOUNTS: ReadonlySet<number> = new Set([100, 1000, 1004, 1234]);

const CBAND_TEST_AMOUNT_SET: ReadonlySet<number> = new Set(CBAND_TEST_AMOUNTS);
/**
 * ★C6 — 테스트금액(1,001~1,006, 1,004 제외) 여부. true 면 시도레코드·수납행 is_simulation=true 로 각인
 * (payments 매출·감사 유니버스에서 제외, field-soak 시나리오6 케이블뽑기 격리).
 */
export function isSimulationAmount(amount: number): boolean {
  return CBAND_TEST_AMOUNT_SET.has(amount);
}
