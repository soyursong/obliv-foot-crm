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

export function getClinicSlug() {
  return SLUG;
}
