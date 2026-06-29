/**
 * notices RLS 정책 현행 상태 확인 + 수정
 * T-20260516-foot-NOTICE-SAVE-FAIL P0 hotfix
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// 현재 notices RLS 정책 확인 via information_schema
const { data, error } = await supabase
  .from('pg_policies')
  .select('*')
  .eq('tablename', 'notices');

console.log('RLS policies data:', JSON.stringify(data, null, 2));
console.log('error:', error?.message ?? 'none');
