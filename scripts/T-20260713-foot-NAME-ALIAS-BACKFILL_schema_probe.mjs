/**
 * T-20260713-foot-NAME-ALIAS-BACKFILL — schema probe (READ-ONLY, no PHI printed)
 * 목적: freeze 스크립트 작성 전 customers/reservations/check_ins 컬럼 확인.
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SRK required'); })(),
  { auth: { persistSession: false } }
);
async function cols(tbl) {
  const { data, error } = await supabase.from(tbl).select('*').limit(1);
  if (error) return console.log(`${tbl}: ERR ${error.message}`);
  console.log(`${tbl}: ${data && data[0] ? Object.keys(data[0]).sort().join(', ') : '(empty)'}`);
}
for (const t of ['customers', 'reservations', 'check_ins']) await cols(t);
