import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

// Vite(런타임)는 import.meta.env 객체를 제공 → 프로덕션/dev 동작 불변.
// Playwright(Node ESM) 등 Vite 밖 환경에선 import.meta.env가 undefined이므로
// process.env로 폴백(테스트 러너가 .env를 process.env로 주입). 미설정 시 아래 throw 가드 유지.
const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const SUPABASE_URL = (viteEnv.VITE_SUPABASE_URL ?? procEnv.VITE_SUPABASE_URL) as string;
const SUPABASE_ANON_KEY = (viteEnv.VITE_SUPABASE_ANON_KEY ?? procEnv.VITE_SUPABASE_ANON_KEY) as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 가 .env에 설정되어야 합니다.');
}

/**
 * 테스트(Playwright) 환경에서는 navigator.locks 기반 멀티탭 동기화 락이
 * BrowserContext 간 storageState 주입과 충돌(getSession() 무한 대기) 한다.
 * VITE_DISABLE_AUTH_LOCK=1 또는 MODE==='test' 일 때만 lock 을 즉시 통과시킨다.
 *
 * 운영(production/dev) 빌드에는 영향 없음 — lock 옵션 미지정이면
 * supabase-js 기본값(navigatorLock + persistSession)이 그대로 쓰인다.
 */
// Vite 밖(Node ESM) 폴백 — import.meta.env undefined 시 process.env(.env.test의 MODE 등) 사용.
const env: Record<string, string | undefined> = { ...procEnv, ...viteEnv };
const disableAuthLock =
  env.MODE === 'test' || env.VITE_DISABLE_AUTH_LOCK === '1' || env.VITE_DISABLE_AUTH_LOCK === 'true';

const lockNoop = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  return fn();
};

// 브라우저에서만 실제 localStorage + 세션유지/토큰갱신 (프로덕션/dev 동작 불변).
// Playwright(Node ESM) 등 비브라우저에선 localStorage 부재로 auth client가 깨지므로
// in-memory 스텁 + persist/refresh off. (테스트 collection 시 모듈 로드 안전화)
const isBrowser =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
const memoryStore: Record<string, string> = {};
const memoryStorage = {
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => {
    memoryStore[k] = v;
  },
  removeItem: (k: string) => {
    delete memoryStore[k];
  },
};

const authOptions: NonNullable<SupabaseClientOptions<'public'>['auth']> = {
  storage: isBrowser ? window.localStorage : memoryStorage,
  persistSession: isBrowser,
  autoRefreshToken: isBrowser,
};

if (disableAuthLock) {
  authOptions.lock = lockNoop;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: authOptions,
});
