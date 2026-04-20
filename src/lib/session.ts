import { supabase } from './supabase';
import type { PackageRemaining } from './types';

export async function autoDeductSession(checkInId: string, packageId: string): Promise<string | null> {
  const { data: dup } = await supabase
    .from('package_sessions')
    .select('id')
    .eq('package_id', packageId)
    .eq('check_in_id', checkInId)
    .limit(1);
  if (dup && dup.length > 0) return null;

  const { data: rem } = await supabase.rpc('get_package_remaining', { p_package_id: packageId });
  const r = rem as PackageRemaining | null;
  if (!r || r.total_remaining <= 0) return '남은 회차가 없습니다';

  const sessionType =
    (r.heated ?? 0) > 0
      ? 'heated_laser'
      : (r.unheated ?? 0) > 0
        ? 'unheated_laser'
        : (r.iv ?? 0) > 0
          ? 'iv'
          : (r.preconditioning ?? 0) > 0
            ? 'preconditioning'
            : 'heated_laser';

  const { count } = await supabase
    .from('package_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('package_id', packageId);
  const nextNum = (count ?? 0) + 1;

  const { error } = await supabase.from('package_sessions').insert({
    package_id: packageId,
    check_in_id: checkInId,
    session_number: nextNum,
    session_type: sessionType,
    session_date: new Date().toISOString().slice(0, 10),
    status: 'used',
  });

  return error ? error.message : null;
}
