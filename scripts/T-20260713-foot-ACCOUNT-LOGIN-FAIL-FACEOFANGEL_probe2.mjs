/**
 * T-20260713 FACEOFANGEL — probe2: identities 재확인 + gmail 형제계정 + audit log (READ-ONLY)
 */
import { createClient } from '@supabase/supabase-js';
const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('need SERVICE_ROLE'); })());
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

const OBLIV_ID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const GMAIL_ID = 'a7e2e012-735c-4ecc-8f54-c7c5c545bddd';

const idsum = (u) => (u.identities || []).map(i => ({ provider: i.provider, identity_id: i.identity_id, id: i.id, email: i.identity_data?.email, created_at: i.created_at, updated_at: i.updated_at, last_sign_in_at: i.last_sign_in_at }));

async function main() {
  console.log('=== probe2 ===', new Date().toISOString());

  for (const [label, id] of [['OBLIV(.kr)', OBLIV_ID], ['GMAIL(.com)', GMAIL_ID]]) {
    const { data, error } = await svc.auth.admin.getUserById(id);
    if (error) { console.log(`\n[${label}] getUserById err:`, error.message); continue; }
    const u = data.user;
    console.log(`\n[${label}] ${u.email}`);
    console.log('  created_at     :', u.created_at);
    console.log('  updated_at     :', u.updated_at);
    console.log('  last_sign_in_at:', u.last_sign_in_at);
    console.log('  email_confirmed:', u.email_confirmed_at);
    console.log('  banned/deleted :', u.banned_until, '/', u.deleted_at);
    console.log('  identities cnt :', (u.identities || []).length);
    console.log('  identities     :', JSON.stringify(idsum(u), null, 2));
  }

  // audit log via exec_sql_readonly RPC (있으면). auth 스키마는 PostgREST 미노출이라 RPC 경유.
  console.log('\n[AUDIT] auth.audit_log_entries / auth.identities via exec_sql_readonly RPC:');
  const q = `
    select 'IDENTITY' as kind, id::text, null as ts, provider as info, user_id::text
      from auth.identities where user_id in ('${OBLIV_ID}','${GMAIL_ID}')
    union all
    select 'AUDIT' as kind, id::text, created_at::text as ts,
           (payload->>'action') as info, coalesce(payload->'traits'->>'user_id', payload->>'actor_id') as user_id
      from auth.audit_log_entries
      where created_at > now() - interval '2 days'
        and (payload::text ilike '%faceofangel%' or payload->>'actor_id' in ('${OBLIV_ID}','${GMAIL_ID}'))
      order by ts desc nulls last limit 50`;
  const { data: rows, error: qe } = await svc.rpc('exec_sql_readonly', { q }).then(r => r, e => ({ data: null, error: e }));
  if (qe) {
    console.log('  RPC exec_sql_readonly 불가:', qe.message || qe);
    console.log('  → auth.identities/audit 직접조회 불가. identities count(admin API)로 대체 판정.');
  } else {
    console.log('  ', JSON.stringify(rows, null, 2));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
