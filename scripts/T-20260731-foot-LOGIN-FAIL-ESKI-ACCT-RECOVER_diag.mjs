/**
 * T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER — READ-ONLY 진단 (write 절대 금지)
 *
 * 대상: 기은서 (es.ki@medibuilder.com) — foot CRM 로그인 불가("비밀번호 틀림" 반복, 비번 초기화 후에도).
 * 목적: 원인 확정 전 READ-ONLY 진단. 조사 6항목:
 *   1) auth.users 존재 + email_confirmed_at
 *   2) recovery 이메일 발송 이벤트 (admin user object의 recovery_sent_at; auth.audit_log_entries는 prod pg 필요 → 경계 기록)
 *   3) banned/disabled(banned_until)
 *   4) auth.identities provider (OAuth 전용인데 비번 로그인 시도?)
 *   5) staff/user_profiles ↔ auth.users email 매핑 정합성(desync)
 *   6) 동일 email 다중 row / 대소문자·공백 variant
 *
 * 표준 (Cross-CRM Auth Identity Resolution):
 *   - `?email=` 서버필터 단독 신뢰 금지 → listUsers 전량 페이지네이션 후 client-side exact(lowercase+trim) 매칭.
 *   - 유일성 assert. 0건→not-found / ≥2건→모호(파괴 write 금지).
 *   - 본 스크립트는 진단 전용(mutating op 없음). destructive 복구는 별도 APPLY 스크립트에서 id↔email 재검증 후.
 *
 * PHI: 실명·비밀번호 원문 미기재. profiles의 이름/개인식별 필드는 존재여부(boolean)만 로그.
 *
 * 실행: node scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_diag.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

function loadEnvLocal() {
  const out = {};
  if (!existsSync('.env.local')) return out;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const envl = loadEnvLocal();
const URL = process.env.VITE_SUPABASE_URL || envl.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envl.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('ABORT: SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(2); }

const TARGET_EMAIL = 'es.ki@medibuilder.com';
const norm = (e) => (e || '').trim().toLowerCase();
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

// PHI-safe: 이름/개인식별 후보 필드는 값 대신 존재여부만
const PII_FIELDS = new Set(['name', 'full_name', 'display_name', 'phone', 'phone_number', 'resident_id', 'rrn']);
function redactRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = PII_FIELDS.has(k) ? (v == null || v === '' ? '(empty)' : '(present)') : v;
  }
  return out;
}

async function scanAllUsers() {
  // 전량 페이지네이션. exact 매칭 + variant(대소문자/공백/부분) 후보 동시 수집.
  const exact = [];
  const variants = [];
  const t = norm(TARGET_EMAIL);
  const localpart = t.split('@')[0];
  let page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers err: ' + error.message);
    const users = data.users || [];
    for (const u of users) {
      const ne = norm(u.email);
      if (ne === t) exact.push(u);
      else if (ne.includes(localpart) || (u.email && u.email !== ne && u.email.trim().toLowerCase() === t)) {
        variants.push({ id: u.id, email_raw: u.email });
      }
    }
    if (users.length < 1000) break;
    page += 1;
    if (page > 50) break;
  }
  return { exact, variants };
}

async function mappingCheck(userId) {
  const res = { user_profiles_by_email: null, user_profiles_by_uid: null, staff_by_email: null, staff_by_uid: null, errors: [] };
  // user_profiles by email
  try {
    const { data, error } = await svc.from('user_profiles').select('*').ilike('email', TARGET_EMAIL);
    if (error) res.errors.push('user_profiles.email: ' + error.message);
    else res.user_profiles_by_email = (data || []).map(redactRow);
  } catch (e) { res.errors.push('user_profiles.email ex: ' + e.message); }
  // user_profiles by user_id
  if (userId) {
    for (const col of ['user_id', 'id', 'auth_user_id']) {
      try {
        const { data, error } = await svc.from('user_profiles').select('*').eq(col, userId);
        if (!error && data && data.length) { res.user_profiles_by_uid = { col, rows: data.map(redactRow) }; break; }
      } catch (_) {}
    }
  }
  // staff by email
  try {
    const { data, error } = await svc.from('staff').select('*').ilike('email', TARGET_EMAIL);
    if (error) res.errors.push('staff.email: ' + error.message);
    else res.staff_by_email = (data || []).map(redactRow);
  } catch (e) { res.errors.push('staff.email ex: ' + e.message); }
  // staff by user_id
  if (userId) {
    for (const col of ['user_id', 'auth_user_id', 'id']) {
      try {
        const { data, error } = await svc.from('staff').select('*').eq(col, userId);
        if (!error && data && data.length) { res.staff_by_uid = { col, rows: data.map(redactRow) }; break; }
      } catch (_) {}
    }
  }
  return res;
}

async function main() {
  const captured_at = new Date().toISOString();
  console.log(`=== ESKI 로그인 불가 READ-ONLY 진단 === ${captured_at}`);
  console.log(`target=${TARGET_EMAIL}  project=${URL}`);

  const { exact, variants } = await scanAllUsers();
  console.log(`\n[6] exact-email 매칭 수=${exact.length}  variant 후보 수=${variants.length}`);
  if (variants.length) console.log('    variants:', JSON.stringify(variants));

  const evidence = { ticket: 'T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER', captured_at,
    target_email: TARGET_EMAIL, project: URL, mode: 'READ-ONLY',
    exact_count: exact.length, variant_count: variants.length, variants,
    account: null, identities: null, mapping: null, cause_hint: null,
    boundary: 'auth.audit_log_entries(recovery 발송 원장)는 prod pg 접근 필요 — 본 진단은 admin user.recovery_sent_at 로 대체' };

  if (exact.length === 0) {
    console.log('\n[결론] 해당 email 계정 auth.users 부재 → planner FOLLOWUP(계정 미존재/오타/타 CRM 등록 가능성).');
    evidence.cause_hint = 'NOT_FOUND_in_auth_users';
  } else if (exact.length > 1) {
    console.log('\n[결론] 동일 email 다중 계정 → 모호(파괴 write 금지). planner FOLLOWUP.');
    evidence.cause_hint = 'MULTIPLE_auth_users_same_email';
    evidence.account = exact.map(u => ({ id: u.id, created_at: u.created_at }));
  } else {
    const u = exact[0];
    const acct = {
      id: u.id, email: u.email, created_at: u.created_at, updated_at: u.updated_at,
      email_confirmed_at: u.email_confirmed_at ?? null,      // [1]
      confirmed_at: u.confirmed_at ?? null,
      recovery_sent_at: u.recovery_sent_at ?? null,          // [2]
      confirmation_sent_at: u.confirmation_sent_at ?? null,
      banned_until: u.banned_until ?? null,                  // [3]
      deleted_at: u.deleted_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      phone: u.phone ? '(present)' : null,
      is_sso_user: u.is_sso_user ?? null,
      identities_count: (u.identities || []).length,
      identity_providers: (u.identities || []).map(i => i.provider),  // [4]
      app_metadata_providers: u.app_metadata?.providers ?? u.app_metadata?.provider ?? null,
    };
    evidence.account = acct;
    evidence.identities = (u.identities || []).map(i => ({ provider: i.provider, id: i.id ? '(present)' : null, last_sign_in_at: i.last_sign_in_at ?? null }));

    console.log('\n[1] 존재 O  email_confirmed_at =', acct.email_confirmed_at, ' confirmed_at =', acct.confirmed_at);
    console.log('[2] recovery_sent_at =', acct.recovery_sent_at, ' confirmation_sent_at =', acct.confirmation_sent_at);
    console.log('[3] banned_until =', acct.banned_until, ' deleted_at =', acct.deleted_at);
    console.log('[4] identity providers =', JSON.stringify(acct.identity_providers), ' is_sso_user =', acct.is_sso_user, ' app_meta_providers =', JSON.stringify(acct.app_metadata_providers));
    console.log('    last_sign_in_at =', acct.last_sign_in_at, ' created_at =', acct.created_at, ' updated_at =', acct.updated_at);

    console.log('\n[5] staff/user_profiles 매핑 정합성 조회...');
    const mapping = await mappingCheck(u.id);
    evidence.mapping = mapping;
    console.log('    user_profiles(by email) rows =', (mapping.user_profiles_by_email || []).length);
    console.log('    user_profiles(by uid)       =', mapping.user_profiles_by_uid ? `col=${mapping.user_profiles_by_uid.col} rows=${mapping.user_profiles_by_uid.rows.length}` : 'none');
    console.log('    staff(by email) rows        =', (mapping.staff_by_email || []).length);
    console.log('    staff(by uid)               =', mapping.staff_by_uid ? `col=${mapping.staff_by_uid.col} rows=${mapping.staff_by_uid.rows.length}` : 'none');
    if (mapping.errors.length) console.log('    mapping errors:', mapping.errors.join(' | '));

    // 원인 힌트 규칙(추정, 확정은 사람 판단)
    const hints = [];
    if (!acct.email_confirmed_at) hints.push('EMAIL_NOT_CONFIRMED(로그인 거부 유력)');
    if (acct.banned_until && new Date(acct.banned_until) > new Date()) hints.push('BANNED_active');
    if (acct.deleted_at) hints.push('SOFT_DELETED');
    const onlyOAuth = acct.identity_providers.length > 0 && !acct.identity_providers.includes('email');
    if (onlyOAuth) hints.push('OAUTH_ONLY_no_email_provider(비번로그인 불가)');
    if (acct.identity_providers.length === 0) hints.push('NO_identities');
    const upEmail = (mapping.user_profiles_by_email || []).length;
    const upUid = mapping.user_profiles_by_uid ? mapping.user_profiles_by_uid.rows.length : 0;
    if (upEmail === 0 && upUid === 0) hints.push('NO_user_profiles_row(권한 로드 실패 가능)');
    else if (upEmail === 0 && upUid > 0) hints.push('user_profiles.email_MISSING_or_mismatch(desync)');
    if (hints.length === 0) hints.push('서버측 계정 정상 신호 — 자격증명(비번) 레벨 불일치 유력 → 비번 직접설정/recovery 재발급 경로');
    evidence.cause_hint = hints.join('; ');
    console.log('\n[cause_hint]', evidence.cause_hint);
  }

  mkdirSync('rollback', { recursive: true });
  const outPath = 'scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_diag-evidence.json';
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log('\n[evidence] →', outPath, '(PHI: 실명/비번 미기재)');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
