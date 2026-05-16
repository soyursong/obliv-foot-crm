/**
 * notices RLS 정책 현행 상태 확인 + 수정
 * T-20260516-foot-NOTICE-SAVE-FAIL P0 hotfix
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

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
