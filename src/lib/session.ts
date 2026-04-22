import { supabase } from './supabase';

export async function autoDeductSession(checkInId: string, packageId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('deduct_session_atomic', {
    p_check_in_id: checkInId,
    p_package_id: packageId,
  });
  if (error) return error.message;
  const result = data as { ok?: boolean; error?: string; msg?: string };
  if (result.error) return result.error;
  return null;
}
