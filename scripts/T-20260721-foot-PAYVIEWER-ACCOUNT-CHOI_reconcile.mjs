/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — RECONCILE (prod READ-ONLY introspection)
 *
 * 목적: g6h1/2z0p/1oh0 3건 상호모순을 prod 실측 evidence 기반 단일 정본으로 수렴.
 *   1) role 실측(=manager?) + 85aab27a staff→manager write 반영 여부
 *   2) email_confirmed_at 현재 실제값 (g6h1 "NULL이었다" 진위)
 *   3) ★ 현재 유효 비밀번호: `Choi!ZZPwi3p_9`(g6h1 리셋) 이 현재 로그인 가능한가?
 *   4) last_sign_in_at 최신값
 *
 * 방법: 100% READ-ONLY.
 *   - GoTrue admin API: listUsers 전체 스캔 in-code 매치(?email= 미신뢰) + getUserById 역검증.
 *   - Supabase Management API(/database/query): SELECT-only SQL.
 *     · crypt() 비교로 리셋비번 유효성 확인 (해시 노출 없음, 순수 read).
 *     · auth.audit_log_entries 로 password/email write 실재 시각 evidence.
 *   - 어떤 write/confirm/create/update 도 실행하지 않음.
 *
 * ⚠ signInWithPassword 로 비번 검증하면 last_sign_in_at/세션/audit 이 write 되므로 금지.
 *   → crypt() 대조(read)만 사용.
 */
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'rxlomoozakkjesdqjtvd';
const SUPABASE_URL = process.env.SUPABASE_CRM_FOOT_URL || `https://${PROJECT_REF}.supabase.co`;
const SERVICE_ROLE_KEY = process.env.SUPABASE_CRM_FOOT_SERVICE || process.env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const TARGET_EMAIL = 'pk.choi@medibuilder.com';
// g6h1 리셋 주장 + responder 가 최필경 DM 발송한 비번. 평문 하드코딩 금지 → env 주입.
const RESET_PW = process.env.CHOI_RESET_PW || (() => { throw new Error('CHOI_RESET_PW env required (테스트할 리셋비번 평문)'); })();
const COMMIT_ROLE_WRITE = '85aab27a'; // 2z0p 가 주장한 staff→manager write

if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_CRM_FOOT_SERVICE env required');
if (!MGMT_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN env required');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (e) => (e || '').trim().toLowerCase();

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Mgmt SQL ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function findByFullScan(target) {
  const matches = [];
  const chooiLike = [];
  let page = 1; const perPage = 1000; let scanned = 0;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers page ${page}: ${error.message}`);
    const users = data?.users || [];
    scanned += users.length;
    for (const u of users) {
      if (norm(u.email) === norm(target)) matches.push(u);
      else if (norm(u.email).includes('choi') || norm(u.email).includes('pk.')) chooiLike.push(u.email);
    }
    if (users.length < perPage) break;
    page++;
  }
  return { matches, scanned, chooiLike };
}

async function main() {
  console.log('='.repeat(70));
  console.log('T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — RECONCILE (prod READ-ONLY)');
  console.log(`target: ${TARGET_EMAIL}`);
  console.log('='.repeat(70));

  // [1] 식별 (Cross-CRM Auth Identity Resolution 표준)
  const { matches, scanned, chooiLike } = await findByFullScan(TARGET_EMAIL);
  console.log(`\n[1] GoTrue listUsers full scan: ${scanned} users, exact match=${matches.length}`);
  if (chooiLike.length) console.log(`    (참고) choi/pk. 유사 email: ${JSON.stringify(chooiLike)}`);
  if (matches.length !== 1) {
    console.log(`❌ 정확 매치 ${matches.length}건 — 단일 식별 불가. 중단.`);
    console.log('RESULT_JSON=' + JSON.stringify({ ok: false, matches: matches.length }));
    return;
  }
  const u = matches[0];
  const { data: g, error: ge } = await supabase.auth.admin.getUserById(u.id);
  if (ge) throw new Error(`getUserById: ${ge.message}`);
  const xok = norm(g?.user?.email) === norm(u.email);
  console.log(`    id=${u.id}`);
  console.log(`    id↔email 역검증: getUserById.email=${g?.user?.email} → ${xok ? '✅ 일치' : '❌ 불일치'}`);
  if (!xok) { console.log('❌ id↔email 불일치 — 중단.'); return; }

  const idLit = u.id.replace(/'/g, "''");
  const pwLit = RESET_PW.replace(/'/g, "''");

  // [2] auth.users 실측 + 비번 crypt 대조 (READ-ONLY SELECT)
  const authSql = `
    select
      id, email, email_confirmed_at, confirmed_at, created_at, updated_at,
      last_sign_in_at, recovery_sent_at, banned_until,
      (encrypted_password = crypt('${pwLit}', encrypted_password)) as reset_pw_matches,
      left(encrypted_password, 4) as pw_algo_prefix,
      length(encrypted_password) as pw_hash_len
    from auth.users where id = '${idLit}';`;
  const authRows = await runSql(authSql);
  const a = authRows[0] || {};
  console.log('\n[2] auth.users 실측:');
  console.log(`    email_confirmed_at = ${a.email_confirmed_at}`);
  console.log(`    confirmed_at       = ${a.confirmed_at}`);
  console.log(`    created_at         = ${a.created_at}`);
  console.log(`    updated_at         = ${a.updated_at}   (auth-level 마지막 변경 시각)`);
  console.log(`    last_sign_in_at    = ${a.last_sign_in_at}`);
  console.log(`    recovery_sent_at   = ${a.recovery_sent_at}`);
  console.log(`    banned_until       = ${a.banned_until}`);
  console.log(`    pw hash            = algo=${a.pw_algo_prefix} len=${a.pw_hash_len}`);
  console.log(`    ★ '${RESET_PW}' crypt 대조 = ${a.reset_pw_matches ? '✅ 현재 유효(로그인 가능)' : '❌ 불일치(현재 유효하지 않음)'}`);

  // [3] user_profiles role 실측
  const profSql = `
    select id, email, name, role, approved, active, clinic_id, updated_at, created_at
    from public.user_profiles where id = '${idLit}';`;
  const profRows = await runSql(profSql);
  const p = profRows[0] || {};
  console.log('\n[3] public.user_profiles 실측:');
  console.log(`    role       = ${p.role}`);
  console.log(`    approved   = ${p.approved}   active = ${p.active}`);
  console.log(`    clinic_id  = ${p.clinic_id}`);
  console.log(`    updated_at = ${p.updated_at}   (role write 반영 시각 추정)`);
  console.log(`    created_at = ${p.created_at}`);

  // [4] audit log — password/email/login write 실재 evidence (오늘)
  const auditSql = `
    select created_at,
           payload->>'action' as action,
           payload->>'actor_username' as actor,
           payload->>'log_type' as log_type
    from auth.audit_log_entries
    where (payload->>'actor_id' = '${idLit}'
        or payload->'traits'->>'user_id' = '${idLit}'
        or payload->'traits'->>'user_email' = '${TARGET_EMAIL}')
    order by created_at desc
    limit 40;`;
  let audit = [];
  try { audit = await runSql(auditSql); } catch (e) { console.log(`\n[4] audit_log 조회 실패(무시): ${e.message}`); }
  console.log(`\n[4] auth.audit_log_entries (최근 ${audit.length}건):`);
  for (const r of audit) console.log(`    ${r.created_at}  ${r.action}  (${r.log_type})  by=${r.actor}`);

  // 판정
  const emailConfirmedTs = a.email_confirmed_at;
  console.log('\n' + '='.repeat(70));
  console.log('판정 (단일 정본):');
  console.log(`  role        = ${p.role}  (85aab27a staff→manager write 반영: ${p.role === 'manager' ? 'YES(현재 manager)' : 'role=' + p.role})`);
  console.log(`  email_confirmed_at = ${emailConfirmedTs}`);
  console.log(`  현재 유효 비번 = ${a.reset_pw_matches ? `'${RESET_PW}' (g6h1 리셋 = 실재/유효)` : `'${RESET_PW}' 아님 (리셋 미실재 또는 무효 → 자가가입 비번이 유효)`}`);
  console.log(`  last_sign_in_at = ${a.last_sign_in_at}`);
  console.log('='.repeat(70));

  console.log('\nRESULT_JSON=' + JSON.stringify({
    ok: true,
    id: u.id,
    email: u.email,
    role: p.role,
    role_matches_manager: p.role === 'manager',
    profile_updated_at: p.updated_at,
    email_confirmed_at: a.email_confirmed_at,
    auth_updated_at: a.updated_at,
    last_sign_in_at: a.last_sign_in_at,
    recovery_sent_at: a.recovery_sent_at,
    reset_pw_matches: a.reset_pw_matches,
    reset_pw_tested: RESET_PW,
    audit_count: audit.length,
  }));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
