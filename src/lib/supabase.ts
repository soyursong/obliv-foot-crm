import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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
const env = import.meta.env;
const disableAuthLock =
  env.MODE === 'test' || env.VITE_DISABLE_AUTH_LOCK === '1' || env.VITE_DISABLE_AUTH_LOCK === 'true';

const lockNoop = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  return fn();
};

const authOptions: NonNullable<SupabaseClientOptions<'public'>['auth']> = {
  storage: localStorage,
  persistSession: true,
  autoRefreshToken: true,
};

if (disableAuthLock) {
  authOptions.lock = lockNoop;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: authOptions,
});
