/**
 * T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL — FREEZE + DRY-RUN (READ-ONLY, write 0)
 *
 * 목적: Data-Correction Backfill SOP §대상셋 freeze.
 *   email_confirmed_at NULL 예비군 중 "현재 재직·활성 필요" 확답 대상 정확히 2 uid를
 *   freeze 하고, id↔email 바인딩을 write 직전 기준으로 재검증하고, before 스냅샷을 뜬다.
 *   본 스크립트는 아무것도 쓰지 않는다(RPC 미호출). supervisor dry-run 판정용 증거만 생성.
 *
 * 대상 freeze 술어(단일 count 기준 UPDATE 금지 → 다축 지문 교집합):
 *   (a) user_profiles 매핑 존재  AND
 *   (b) auth.users.email_confirmed_at IS NULL (로그인 불가)  AND
 *   (c) user_profiles.approved = true  AND  active = true  (재직·승인)
 *   → 매니저(role=manager, created 2026-07-22) + 직원(role=staff, created 2026-07-14) 2건.
 *   coordinator(approved=false, 미승인)는 (c)에서 자동 배제 → 본 티켓 대상 아님.
 *
 * 표준:
 *   - Cross-CRM Auth Identity Resolution: `?email=` 서버필터 단독 신뢰 금지 →
 *     listUsers 전량 페이지네이션 + 앱레벨 정확매칭. destructive 직전 getUserById 로 id↔email 재검증.
 *   - Data-Correction Backfill SOP: freeze(2 uid) → before 스냅샷(email_confirmed_at) 동봉.
 *
 * PHI: 이메일 localpart 앞 2자만 마스킹 노출. evidence JSON 도 마스킹값 + id 꼬리 6자만.
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... node scripts/T-20260802-...-BACKFILL_freeze_dryrun.mjs
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

function maskEmail(e) {
  if (!e) return '(none)';
  const [lp, dom] = String(e).split('@');
  const m = (s) => (s || '').slice(0, 2) + '***';
  return `${m(lp)}@${dom ? m(dom) : '???'}`;
}

async function listAllUsers() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers: ' + error.message);
    all.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return all;
}

async function main() {
  console.log('=== T-20260802 EMAILCONFIRM-BACKFILL FREEZE+DRY-RUN (READ-ONLY, write 0) ===');
  const users = await listAllUsers();
  console.log(`auth.users 전량 로드: ${users.length}`);

  const { data: profiles, error: pErr } = await svc
    .from('user_profiles').select('id, email, role, approved, active');
  if (pErr) { console.error('user_profiles 조회 실패:', pErr.message); process.exit(1); }
  const profById = new Map((profiles || []).map((p) => [p.id, p]));

  // 예비군: user_profiles 매핑 + email_confirmed_at NULL
  const unconfirmed = users
    .filter((u) => profById.has(u.id) && !u.email_confirmed_at)
    .map((u) => ({ u, p: profById.get(u.id) }));

  console.log(`\n예비군(email_confirmed_at NULL & user_profiles 매핑): ${unconfirmed.length}건`);
  for (const { u, p } of unconfirmed) {
    console.log(`  · ${maskEmail(u.email)} role=${p.role} approved=${p.approved} active=${p.active} created=${u.created_at} id..${String(u.id).slice(-6)}`);
  }

  // freeze 술어: approved=true AND active=true (coordinator 미승인 자동 배제)
  const frozen = unconfirmed.filter(({ p }) => p.approved === true && p.active === true);
  const excluded = unconfirmed.filter(({ p }) => !(p.approved === true && p.active === true));

  console.log(`\n── FREEZE SET (approved=true & active=true & unconfirmed): ${frozen.length}건 ──`);

  // AC: 정확히 2건, manager + staff. 아니면 abort (supervisor 판단 필요).
  const roles = frozen.map(({ p }) => p.role).sort();
  const okCount = frozen.length === 2;
  const okRoles = roles.includes('manager') && roles.includes('staff');

  const before = [];
  for (const { u, p } of frozen) {
    // destructive 직전 id↔email 재검증 (getUserById — 권위 id 기준)
    const { data: byId, error: bErr } = await svc.auth.admin.getUserById(u.id);
    const authEmail = byId?.user?.email || null;
    const idEmailMatch = !!authEmail && !!p.email &&
      authEmail.trim().toLowerCase() === String(p.email).trim().toLowerCase();
    const listEmailMatch = !!authEmail && !!u.email &&
      authEmail.trim().toLowerCase() === String(u.email).trim().toLowerCase();
    const rec = {
      id_tail: String(u.id).slice(-6),
      email_masked: maskEmail(u.email),
      role: p.role,
      approved: p.approved,
      active: p.active,
      created_at: u.created_at,
      before_email_confirmed_at: u.email_confirmed_at || null,   // 기대: null
      id_email_rebind_ok: idEmailMatch && listEmailMatch,        // auth.getUserById == user_profiles.email == list.email
      getUserById_error: bErr ? bErr.message : null,
    };
    before.push(rec);
    console.log(`  · ${rec.email_masked} role=${rec.role} approved=${rec.approved} active=${rec.active} before_confirmed=${rec.before_email_confirmed_at} id↔email재검증=${rec.id_email_rebind_ok ? 'OK' : '⚠MISMATCH'} id..${rec.id_tail}`);
  }

  console.log(`\n── 배제(제외) SET: ${excluded.length}건 (coordinator 미승인 등) ──`);
  for (const { u, p } of excluded) {
    console.log(`  · ${maskEmail(u.email)} role=${p.role} approved=${p.approved} active=${p.active} (배제사유: approved!=true or active!=true)`);
  }

  const allRebindOk = before.every((r) => r.id_email_rebind_ok);
  const verdict = okCount && okRoles && allRebindOk
    ? 'PASS — freeze 2 uid 확정, id↔email 재검증 OK. supervisor dry-run 후 apply 진행 가능.'
    : 'HOLD — freeze 술어 불일치. 아래 assert 실패 → supervisor/planner 확인 필요.';

  const summary = {
    ticket: 'T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL',
    phase: 'freeze+dry-run (READ-ONLY, write 0)',
    auth_users_total: users.length,
    unconfirmed_total: unconfirmed.length,
    freeze_set_count: frozen.length,
    freeze_roles: roles,
    excluded_count: excluded.length,
    asserts: {
      freeze_count_eq_2: okCount,
      freeze_roles_manager_staff: okRoles,
      all_id_email_rebind_ok: allRebindOk,
    },
    before_snapshot: before,
    excluded_snapshot: excluded.map(({ u, p }) => ({
      id_tail: String(u.id).slice(-6), email_masked: maskEmail(u.email),
      role: p.role, approved: p.approved, active: p.active,
    })),
    verdict,
    would_change: before.map((r) => ({
      id_tail: r.id_tail, email_masked: r.email_masked,
      action: 'admin_approve_and_confirm_user(uid) → email_confirmed_at NULL→now(), profile_rows=1',
      expected_email_confirmed_now: true,
    })),
  };

  if (!existsSync('scripts/_evidence')) mkdirSync('scripts/_evidence', { recursive: true });
  const out = 'scripts/_evidence/T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL_freeze_dryrun.json';
  writeFileSync(out, JSON.stringify(summary, null, 2));

  console.log(`\nVERDICT: ${verdict}`);
  console.log('  assert freeze_count==2      :', okCount ? 'PASS' : 'FAIL');
  console.log('  assert roles⊇{manager,staff}:', okRoles ? 'PASS' : 'FAIL');
  console.log('  assert id↔email 재검증 all OK:', allRebindOk ? 'PASS' : 'FAIL');
  console.log('\nevidence(마스킹) →', out);

  if (!(okCount && okRoles && allRebindOk)) process.exit(3);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
