/**
 * T-20260713 FACEOFANGEL — audit: Management API database/query (SELECT-only, READ)
 * auth.audit_log_entries / auth.identities / auth.users 핵심컬럼으로 "갑자기" 시점 특정.
 * SUPABASE_ACCESS_TOKEN(sbp_) 필요. 민감 credential(encrypted_password 등) 미SELECT.
 */
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
  console.log('=== FACEOFANGEL audit (READ-ONLY via Mgmt API) ===', new Date().toISOString());

  // 1) auth.users 핵심 상태(비밀번호 컬럼값은 노출 않고, 존재/시각만)
  await q('auth.users 상태', `
    select id, email,
           email_confirmed_at, last_sign_in_at, updated_at, created_at,
           banned_until, deleted_at, is_sso_user, is_anonymous,
           (encrypted_password is not null and length(encrypted_password)>0) as has_password,
           recovery_sent_at, email_change, email_change_sent_at, reauthentication_sent_at
    from auth.users where id in ('${OBLIV}','${GMAIL}') order by created_at`);

  // 2) auth.identities
  await q('auth.identities', `
    select provider, identity_id, user_id, created_at, updated_at, last_sign_in_at,
           identity_data->>'email' as id_email
    from auth.identities where user_id in ('${OBLIV}','${GMAIL}') order by user_id, created_at`);

  // 3) audit log — 최근 2일, 두 계정 관련 전체 이벤트 (시간순)
  await q('auth.audit_log_entries (최근2일, faceofangel 관련)', `
    select created_at, payload->>'action' as action, payload->>'actor_id' as actor_id,
           payload->'traits'->>'user_email' as target_email,
           payload->'traits'->>'user_id' as target_user_id,
           payload->>'actor_username' as actor_username
    from auth.audit_log_entries
    where created_at > now() - interval '2 days'
      and (payload::text ilike '%faceofangel%'
           or payload->'traits'->>'user_id' in ('${OBLIV}','${GMAIL}')
           or payload->>'actor_id' in ('${OBLIV}','${GMAIL}'))
    order by created_at desc limit 80`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
