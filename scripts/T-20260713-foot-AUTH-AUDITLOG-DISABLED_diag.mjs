/**
 * T-20260713-foot-AUTH-AUDITLOG-DISABLED — 진단 (READ-ONLY)
 *
 * 목적: foot prod GoTrue auth.audit_log_entries "24h 0건" 원인 규명.
 *   - OFF(로깅 비활성) vs 저트래픽(이벤트 자체 없음) vs 보존기간 만료(prune) 감별.
 *   - admin-API 경유 변경(비번 재설정 등)이 actor 없이 기록되는지 확인 → FACEOFANGEL actor 추적불가 근인.
 *   - PII(비번/이메일 원문) 평문 적재 여부 표본 확인.
 *
 * READ-ONLY: SELECT only via exec_sql_readonly RPC. 쓰기 0. prod 무영향.
 */
import { createClient } from '@supabase/supabase-js';
const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

const line = (s = '') => console.log(s);
async function q(sql) {
  const { data, error } = await svc.rpc('exec_sql_readonly', { q: sql }).then(r => r, e => ({ data: null, error: e }));
  return { data, error: error ? (error.message || String(error)) : null };
}

async function main() {
  line(`# AUTH-AUDITLOG-DISABLED 진단 (READ-ONLY) ${new Date().toISOString()}`);
  line(`# project: rxlomoozakkjesdqjtvd (foot prod)`);

  // 0. RPC 가용성 + 테이블 실재
  line('\n== 0. RPC/테이블 실재 ==');
  const probe = await q(`select to_regclass('auth.audit_log_entries') as tbl`);
  if (probe.error) { line(`  exec_sql_readonly RPC 불가: ${probe.error}`); line('  → 아래 쿼리 전부 스킵. 대체수단 필요.'); return; }
  line(`  audit_log_entries regclass: ${JSON.stringify(probe.data)}`);

  // 1. 볼륨 시계열: 전체 / 24h / 7d / 30d / min-max
  line('\n== 1. 볼륨 시계열 (핵심: OFF vs 저트래픽 vs prune 감별) ==');
  const vol = await q(`
    select
      (select count(*) from auth.audit_log_entries) as total_all,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '24 hours') as last_24h,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '7 days') as last_7d,
      (select count(*) from auth.audit_log_entries where created_at > now() - interval '30 days') as last_30d,
      (select min(created_at) from auth.audit_log_entries) as oldest,
      (select max(created_at) from auth.audit_log_entries) as newest
  `);
  line(`  ${JSON.stringify(vol.data, null, 2)}`);

  // 2. 최근 사용자(로그인 대상) 활동 대조 — audit 0건이 저트래픽 때문인지 교차확인
  line('\n== 2. auth.users 최근 활동 대조 (로그인 실재 여부) ==');
  const users = await q(`
    select
      count(*) as total_users,
      count(*) filter (where last_sign_in_at > now() - interval '24 hours') as signed_in_24h,
      count(*) filter (where last_sign_in_at > now() - interval '7 days') as signed_in_7d,
      count(*) filter (where updated_at > now() - interval '24 hours') as updated_24h,
      max(last_sign_in_at) as last_login_any
    from auth.users
  `);
  line(`  ${JSON.stringify(users.data, null, 2)}`);

  // 3. action 종류 분포 (최근 30d) — 어떤 이벤트가 기록되는지
  line('\n== 3. action 분포 (최근 30d) ==');
  const acts = await q(`
    select payload->>'action' as action, count(*) as n,
           min(created_at) as first_seen, max(created_at) as last_seen
    from auth.audit_log_entries
    where created_at > now() - interval '30 days'
    group by 1 order by n desc limit 30
  `);
  line(`  ${JSON.stringify(acts.data, null, 2)}`);

  // 4. actor 특정 가능성 — admin-API 변경이 actor 없이 남는지 (FACEOFANGEL 근인)
  line('\n== 4. actor 기록 여부 (payload 키 표본, PII 마스킹) ==');
  const sample = await q(`
    select created_at,
           payload->>'action' as action,
           payload->>'actor_id' as actor_id,
           payload->>'actor_username' as actor_username,
           (payload ? 'actor_via_sso') as has_actor_via_sso,
           array(select jsonb_object_keys(payload)) as payload_keys
    from auth.audit_log_entries
    order by created_at desc limit 15
  `);
  line(`  ${JSON.stringify(sample.data, null, 2)}`);

  // 5. PII 평문 적재 스캔 — payload 안에 비번/전체이메일/토큰 흔적
  line('\n== 5. PII 평문 적재 스캔 (payload 텍스트에 민감필드 존재 여부) ==');
  const pii = await q(`
    select
      count(*) filter (where payload::text ilike '%password%') as has_password_kw,
      count(*) filter (where payload::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+') as has_email_pattern,
      count(*) filter (where payload::text ilike '%token%') as has_token_kw,
      count(*) as scanned
    from auth.audit_log_entries
    where created_at > now() - interval '30 days'
  `);
  line(`  ${JSON.stringify(pii.data, null, 2)}`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
