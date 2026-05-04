import { supabase } from './supabase';
import type { Clinic } from './types';

const SLUG = 'jongno-foot';

let cached: Clinic | null = null;

export async function getClinic(): Promise<Clinic> {
  if (cached) return cached;
  const { data, error } = await supabase.from('clinics').select('*').eq('slug', SLUG).single();
  if (error) throw error;
  cached = data as Clinic;
  return cached;
}

/** 모듈 레벨 캐시를 초기화한다 (설정 변경 후 재조회 시 사용) */
export function clearClinicCache(): void {
  cached = null;
}

