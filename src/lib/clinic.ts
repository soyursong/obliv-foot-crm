import { supabase } from './supabase';
import type { Clinic } from './types';

const SLUG = 'jongno-foot';

// T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT RC 수정:
//   기존엔 모듈 싱글톤(cached)이 프로세스 수명 내내 절대 만료되지 않아,
//   한 스테이션(예: 설정 화면)에서 clinics.laser_time_units 를 바꿔도 다른 스테이션
//   (2번차트 태블릿)이 먼저 로드해 둔 stale 값을 계속 반환했다. clearClinicCache 는
//   "저장한 그 탭"에서만 호출되어 다른 디바이스/탭엔 전파되지 않고, 키오스크 webview의
//   '새로고침'은 모듈 재초기화를 보장하지 못해 F5 후에도 미반영으로 보였다.
//   → 캐시에 TTL 을 부여(설정성 데이터라 짧은 staleness 무해)하고, useClinic 이
//     window focus/visibility 시 force 재조회하도록 해 하드리로드 없이도 반영되게 한다.
const CACHE_TTL_MS = 30_000;

let cached: Clinic | null = null;
let cachedAt = 0;
let inflight: Promise<Clinic> | null = null;

async function fetchClinic(): Promise<Clinic> {
  const { data, error } = await supabase.from('clinics').select('*').eq('slug', SLUG).single();
  if (error) throw error;
  cached = data as Clinic;
  cachedAt = Date.now();
  return cached;
}

/**
 * 클리닉 row 를 반환한다.
 * @param opts.force true 면 TTL/캐시 무시하고 즉시 재조회(설정 변경 직후 반영용).
 */
export async function getClinic(opts?: { force?: boolean }): Promise<Clinic> {
  const fresh = cached && Date.now() - cachedAt < CACHE_TTL_MS;
  if (!opts?.force && fresh) return cached as Clinic;
  // 동시 호출 합류(중복 네트워크 방지)
  if (!opts?.force && inflight) return inflight;
  inflight = fetchClinic().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** 모듈 레벨 캐시를 초기화한다 (설정 변경 후 재조회 시 사용) */
export function clearClinicCache(): void {
  cached = null;
  cachedAt = 0;
}
