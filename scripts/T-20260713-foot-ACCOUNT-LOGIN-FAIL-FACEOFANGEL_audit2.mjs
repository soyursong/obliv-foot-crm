const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('need SUPABASE_ACCESS_TOKEN'); })());
const OBLIV = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const GMAIL = 'a7e2e012-735c-4ecc-8f54-c7c5c545bddd';

async function q(label, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const txt = await r.text();
  console.log(`\n### ${label} (HTTP ${r.status})`);
  try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch { console.log(txt); }
}

async function main() {
  console.log('=== audit2 ===', new Date().toISOString());

  await q('auth.identities (correct cols)', `
    select id, provider, user_id, created_at, updated_at, last_sign_in_at,
           identity_data->>'email' as id_email, identity_data->>'sub' as sub
    from auth.identities where user_id in ('${OBLIV}','${GMAIL}') order by user_id, created_at`);

  await q('audit_log 최근 24h 전체 (actor_username/action) - 두계정 언급 여부', `
    select created_at, payload->>'action' as action,
           payload->>'actor_username' as actor_username,
           payload->>'actor_id' as actor_id,
           payload->'traits'->>'user_email' as trait_email,
           payload->'traits'->>'user_id' as trait_uid,
           left(payload::text, 300) as payload_head
    from auth.audit_log_entries
    where created_at > now() - interval '24 hours'
      and (payload::text ilike '%faceofangel%'
           or payload::text ilike '%${OBLIV}%'
           or payload::text ilike '%${GMAIL}%')
    order by created_at desc limit 100`);

  await q('audit_log 존재/총건수 + 최신 5건(스키마 확인)', `
    select count(*) as total_24h from auth.audit_log_entries where created_at > now() - interval '24 hours'`);

  await q('audit_log 최신 5건 raw', `
    select created_at, left(payload::text, 400) as payload
    from auth.audit_log_entries order by created_at desc limit 5`);

  // 10:00:24 근방 무슨 컬럼이 바뀌었나 추정: user_metadata / confirmation_token 등
  await q('auth.users 확장컬럼(.kr) — 10:00 mutate 성격 추정', `
    select id,
           raw_user_meta_data,
           raw_app_meta_data,
           confirmation_token <> '' as has_confirmation_token,
           recovery_token <> '' as has_recovery_token,
           email_change_token_new <> '' as has_email_change_token,
           phone_change <> '' as has_phone_change,
           last_sign_in_at, updated_at
    from auth.users where id = '${OBLIV}'`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
