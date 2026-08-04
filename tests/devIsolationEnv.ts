/**
 * E2E/dev DB 격리 컷오버 — 순수 매핑/검문 로직 (L3 근본격리)
 *   T-20260804-foot-FOOTCTR-E2E-DEVDB-ISOLATION-CUTOVER (SMS-DUMMY-SEAL e9f8fb7c 의 L3 leg)
 *
 * playwright.config.ts 의 부팅 블록에서 사용한다. 파일 탐색(fs)은 config 에 두고,
 * DEV_SUPABASE_* → 하네스 표준 키 매핑 + fail-closed 검문(prod 오배선 차단)만 여기서
 * 순수 함수로 분리해 회귀 spec(tests/e2e/T-...devdb-isolation.spec.ts)이 직접 검증한다.
 *
 * fail-closed 원칙: 애매하면 조용히 prod 로 흐르지 않고 throw 한다.
 */

/** crm-obliv-foot (실환자 prod) — 절대 E2E write 대상이 되면 안 되는 ref. */
export const KNOWN_PROD_REF = 'rxlomoozakkjesdqjtvd';
/** obliv-foot-dev (E2E/CI 격리 DB, PHI-0) — docs/ENV-MATRIX.md §테스트/E2E 격리 DB. */
export const DEV_ISOLATION_REF = 'kcdqtyivtqcjmcrdjkqi';

/** FOOT_E2E_DEV_ISOLATION 플래그 truthy 판정. 미설정/0/false/off/no = OFF(현행 유지). */
export function isTruthyFlag(v: string | undefined | null): boolean {
  if (!v) return false;
  return !['0', 'false', 'off', 'no', ''].includes(v.trim().toLowerCase());
}

/** DEV_SUPABASE_* 파싱값 → 하네스가 읽는 표준 env 키 매핑 결과. */
export interface DevIsolationMapping {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** = DEV_SUPABASE_PROJECT_REF → PRODREF-HARDGUARD(assertExpectedDbTarget) 활성화. */
  EXPECT_DEV_DB_REF: string;
}

/**
 * .env.dev-isolation.local 파싱값(DEV_SUPABASE_*)을 하네스 표준 키로 매핑하고 fail-closed 검문.
 * @throws url/ref 부재, 또는 resolved target 이 dev ref 를 안 가리키거나 prod ref 를 가리킬 때.
 */
export function mapDevIsolationEnv(
  devEnv: Record<string, string | undefined>,
  source = '<dev-env>',
): DevIsolationMapping {
  const devUrl = (devEnv.DEV_SUPABASE_URL ?? '').trim();
  const devRef = (devEnv.DEV_SUPABASE_PROJECT_REF ?? '').trim();
  if (!devUrl || !devRef) {
    throw new Error(
      `[E2E-DEVDB-ISOLATION] ${source} 에 DEV_SUPABASE_URL/DEV_SUPABASE_PROJECT_REF 가 없습니다 → fail-closed abort.`,
    );
  }
  // 진입점 fail-closed: URL 이 dev ref 를 포함하고 prod ref 를 포함하지 않아야 한다.
  if (!devUrl.includes(devRef) || devUrl.includes(KNOWN_PROD_REF)) {
    throw new Error(
      `[E2E-DEVDB-ISOLATION] 격리 target 이 dev ref('${devRef}')를 가리키지 않습니다 ` +
        `(url=${devUrl}). prod 오배선 의심 → fail-closed abort.`,
    );
  }
  const out: DevIsolationMapping = { VITE_SUPABASE_URL: devUrl, EXPECT_DEV_DB_REF: devRef };
  if (devEnv.DEV_SUPABASE_ANON_KEY) out.VITE_SUPABASE_ANON_KEY = devEnv.DEV_SUPABASE_ANON_KEY;
  if (devEnv.DEV_SUPABASE_SERVICE_ROLE_KEY)
    out.SUPABASE_SERVICE_ROLE_KEY = devEnv.DEV_SUPABASE_SERVICE_ROLE_KEY;
  return out;
}
