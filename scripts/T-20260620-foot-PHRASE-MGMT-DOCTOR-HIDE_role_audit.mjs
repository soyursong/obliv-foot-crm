/**
 * T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE — role 실측 (티켓 의무: SELECT DISTINCT role + has_ops_authority)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

async function main() {
  // 1. DISTINCT role + count (active 한정 시도)
  const { data: profiles, error } = await db
    .from('user_profiles')
    .select('role, has_ops_authority, is_active, name');
  if (error) { console.error('user_profiles err:', error.message); }
  else {
    const byRole = {};
    for (const p of profiles) {
      const k = `${p.role} | ops=${p.has_ops_authority ?? 'NULL'} | active=${p.is_active ?? '?'}`;
      byRole[k] = (byRole[k] || 0) + 1;
    }
    console.log('=== user_profiles role × has_ops_authority × is_active ===');
    for (const [k, v] of Object.entries(byRole).sort()) console.log(`  ${v.toString().padStart(3)}  ${k}`);
    console.log('  TOTAL rows:', profiles.length);
    // director 상세
    const dirs = profiles.filter((p) => p.role === 'director');
    console.log('\n=== director 계정 상세 ===');
    for (const d of dirs) console.log(`  name=${d.name} ops=${d.has_ops_authority ?? 'NULL'} active=${d.is_active}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
