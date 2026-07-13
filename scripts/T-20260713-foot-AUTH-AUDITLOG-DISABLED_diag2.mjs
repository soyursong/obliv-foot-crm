/**
 * T-20260713-foot-AUTH-AUDITLOG-DISABLED — 진단 diag2 (READ-ONLY via Management API)
 * exec_sql_readonly RPC 부재 → Supabase Management API database/query 엔드포인트로 auth 스키마 조회.
 * READ-ONLY: SELECT only. 쓰기 0.
 */
const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN required'); })());
const ENDPOINT = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function q(label, sql) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const txt = await res.text();
  console.log(`\n== ${label} == (HTTP ${res.status})`);
  try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); }
  catch { console.log(txt); }
}

async function main() {
  console.log(`# AUTH-AUDITLOG-DISABLED diag2 (Management API READ-ONLY) ${new Date().toISOString()}`);
  console.log(`# project: ${REF} (foot prod)`);

  await q('0. 테이블 실재', `select to_regclass('auth.audit_log_entries') as tbl`);

  await q('1. 볼륨 시계열 (OFF vs 저트래픽 vs prune 감별)', `
    select
      (select count(*) from auth.audit_log_entries) as total_all,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '24 hours') as last_24h,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '7 days') as last_7d,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '30 days') as last_30d,
      (select min(created_at) from auth.audit_log_entries) as oldest,
      (select max(created_at) from auth.audit_log_entries) as newest`);

  await q('2. auth.users 최근 활동 대조 (로그인 실재 여부)', `
    select
      count(*) as total_users,
      count(*) filter (where last_sign_in_at > now() - interval '24 hours') as signed_in_24h,
      count(*) filter (where last_sign_in_at > now() - interval '7 days') as signed_in_7d,
      count(*) filter (where updated_at > now() - interval '24 hours') as updated_24h,
      max(last_sign_in_at) as last_login_any
    from auth.users`);

  await q('3. action 분포 (최근 30d)', `
    select payload->>'action' as action, count(*) as n,
           min(created_at) as first_seen, max(created_at) as last_seen
    from auth.audit_log_entries
    where created_at > now() - interval '30 days'
    group by 1 order by n desc limit 30`);

  await q('4. actor 기록 여부 (payload 키 표본)', `
    select created_at,
           payload->>'action' as action,
           payload->>'actor_id' as actor_id,
           payload->>'actor_username' as actor_username,
           array(select jsonb_object_keys(payload)) as payload_keys
    from auth.audit_log_entries
    order by created_at desc limit 15`);

  await q('5. PII 평문 적재 스캔 (payload 텍스트 민감필드)', `
    select
      count(*) filter (where payload::text ilike '%password%') as has_password_kw,
      count(*) filter (where payload::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+') as has_email_pattern,
      count(*) filter (where payload::text ilike '%token%') as has_token_kw,
      count(*) as scanned
    from auth.audit_log_entries
    where created_at > now() - interval '30 days'`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
