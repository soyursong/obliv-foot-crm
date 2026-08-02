/**
 * T-20260731-foot-STAFF-REGISTER-EMAILCONFIRM-GAP-SCAN — READ-ONLY 현황 조회 (write 절대 금지)
 *
 * 목적(AC1): foot auth.users 중 staff성 계정에서 로그인 불가 예비군을 조회·집계.
 *   판정: email_confirmed_at IS NULL  OR  identities=[] (자가가입 미확인 / identity 공백)
 *   → GoTrue 가 "Email not confirmed" 로 로그인 거부하는 상태(ESKI/김지윤/기은서 반복 패턴).
 *
 * 표준 (Cross-CRM Auth Identity Resolution):
 *   - `?email=` 서버필터 단독 신뢰 금지 → listUsers 전량 페이지네이션 후 client-side 판정.
 *   - 본 스크립트는 진단 전용(mutating op 0). 소급 보정은 별건 Data-Correction Backfill SOP(1건씩) 로.
 *
 * PHI: 실명·이메일 원문 미기재. 이메일은 localpart 앞 2자만 마스킹 노출(a1***@do***).
 *   집계(count) 위주. evidence JSON 도 마스킹된 값만 적재.
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... node scripts/T-20260731-foot-STAFF-REGISTER-EMAILCONFIRM-GAP-SCAN_scan.mjs
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
if (!KEY) { console.error('ABORT: SUPABASE_SERVICE_ROLE_KEY 필요 (READ-ONLY 조회용)'); process.exit(2); }

const svc = createClient(URL, KEY, { auth: { persistSession: false } });

// 이메일 마스킹: localpart 앞 2자 + *** @ domain 앞 2자 + ***
function maskEmail(e) {
  if (!e) return '(none)';
  const [lp, dom] = String(e).split('@');
  const m = (s) => (s || '').slice(0, 2) + '***';
  return `${m(lp)}@${dom ? m(dom) : '???'}`;
}

async function main() {
  // 1) user_profiles 로 staff성 계정 id 집합 확보(role 무관 — 전 직원 계정이 대상).
  //    foot = 종로점 단일 지점(field_context 2026-08-01) → clinic 다중 스코프 불필요.
  const { data: profiles, error: pErr } = await svc
    .from('user_profiles')
    .select('id, email, role, approved, active');
  if (pErr) { console.error('user_profiles 조회 실패:', pErr.message); process.exit(1); }
  const profById = new Map((profiles || []).map((p) => [p.id, p]));

  // 2) auth.users 전량 페이지네이션 → email_confirmed_at / identities 판정.
  const preExisting = []; // 로그인 불가 예비군
  let total = 0, page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('listUsers 실패:', error.message); process.exit(1); }
    const users = data.users || [];
    for (const u of users) {
      total++;
      const prof = profById.get(u.id);
      // staff성 계정 판정: user_profiles 에 매핑된 계정만(현장 직원 계정). 매핑 없는 계정은 제외.
      if (!prof) continue;
      const noConfirm = !u.email_confirmed_at;
      const noIdentity = !u.identities || u.identities.length === 0;
      if (noConfirm || noIdentity) {
        preExisting.push({
          id_tail: String(u.id).slice(-6),          // 원문 id 미기재, 꼬리 6자만
          email_masked: maskEmail(u.email),
          role: prof.role,
          approved: prof.approved,
          active: prof.active,
          email_confirmed: !!u.email_confirmed_at,
          has_identity: !noIdentity,
          created_at: u.created_at,
        });
      }
    }
    if (users.length < 1000) break;
    page++;
  }

  const summary = {
    ticket: 'T-20260731-foot-STAFF-REGISTER-EMAILCONFIRM-GAP-SCAN',
    scanned_at_note: 'timestamp는 실행 로그 기준(스크립트 내 Date 미사용)',
    auth_users_total: total,
    staff_profiles_total: profById.size,
    preexisting_login_blocked_count: preExisting.length,
    breakdown: {
      email_unconfirmed: preExisting.filter((r) => !r.email_confirmed).length,
      no_identity: preExisting.filter((r) => !r.has_identity).length,
      approved_but_blocked: preExisting.filter((r) => r.approved && (!r.email_confirmed || !r.has_identity)).length,
    },
    evidence: preExisting,
  };

  console.log('\n===== foot staff 로그인 불가 예비군 스캔 (READ-ONLY) =====');
  console.log('auth.users 전체:', total, '| user_profiles(staff성):', profById.size);
  console.log('로그인 불가 예비군(email 미확인 or identity 공백):', preExisting.length);
  console.log('  - email_confirmed_at NULL:', summary.breakdown.email_unconfirmed);
  console.log('  - identities=[]        :', summary.breakdown.no_identity);
  console.log('  - approved=true인데 차단:', summary.breakdown.approved_but_blocked);
  for (const r of preExisting) {
    console.log(`   · ${r.email_masked} role=${r.role} approved=${r.approved} confirmed=${r.email_confirmed} identity=${r.has_identity} id..${r.id_tail}`);
  }

  if (!existsSync('scripts/_evidence')) mkdirSync('scripts/_evidence', { recursive: true });
  const out = 'scripts/_evidence/T-20260731-foot-STAFF-REGISTER-EMAILCONFIRM-GAP-SCAN_evidence.json';
  writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log('\nevidence(마스킹) →', out);
  console.log('\n소급 보정 필요 시: 각 계정 승인 화면 "승인" 버튼(admin_approve_and_confirm_user) 으로 1건씩,');
  console.log('또는 Data-Correction Backfill SOP 봉투(id↔email 재검증 + rows-affected) 로 처리. blanket UPDATE 금지.');
}

main().catch((e) => { console.error(e); process.exit(1); });
