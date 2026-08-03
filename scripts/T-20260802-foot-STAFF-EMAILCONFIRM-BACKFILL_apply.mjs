/**
 * T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL — APPLY (per-uid RPC, blanket UPDATE 금지)
 *
 * ⚠ supervisor dry-run(freeze_dryrun.mjs VERDICT=PASS) 선행 확인 후에만 실행.
 *
 * 실행 봉투(Data-Correction Backfill SOP):
 *   1. freeze 술어 재평가 → 정확히 2 uid(manager 07-22 + staff 07-14) 재확정.
 *      count!=2 또는 coordinator(approved=false) 혼입 시 즉시 abort(무write).
 *   2. destructive 직전 getUserById 로 id↔email 재검증(rebind). 불일치 시 그 uid skip+abort.
 *   3. idempotent RPC admin_approve_and_confirm_user(uid) 를 각 uid 1건씩 호출.
 *      - RPC 내장: id↔email 재검증 + user_profiles.approved=true(rows-affected=1) +
 *        auth.users.email_confirmed_at NULL→now()(미확인만). blanket UPDATE 아님.
 *   4. cross_crm_write_rowcheck_standard: RPC 반환 profile_rows==1 검증(0-row+error=null 성공 오인 금지).
 *      email_confirmed_now==true(또는 already_confirmed==true=멱등 재실행) 확인.
 *   5. after 스냅샷(email_confirmed_at) + before/after 대조 동봉.
 *   6. 예비군 재스캔 → email_confirmed=false 잔존 = coordinator 미승인 1건뿐(3→1) 확인.
 *
 * 인증 컨텍스트(중요):
 *   RPC 는 is_admin_or_manager()(=auth.uid() 의존) 가드가 있어 service_role 헤드리스로는
 *   42501 로 거부된다. 따라서 admin/manager 계정 세션으로 인증 후 호출한다.
 *   ADMIN_EMAIL / ADMIN_PASSWORD 를 env(off-git)로 주입(하드코딩 금지). 미주입 시 abort.
 *
 * PHI: 이메일 마스킹. 임시비번/관리자 비번은 콘솔·evidence 에 미기재.
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
 *       ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *       node scripts/T-20260802-...-BACKFILL_apply.mjs
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
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envl.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || envl.VITE_SUPABASE_ANON_KEY || envl.VITE_SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SVC_KEY) { console.error('ABORT: SUPABASE_SERVICE_ROLE_KEY 필요(freeze 재평가/스냅샷용)'); process.exit(2); }
if (!ANON_KEY) { console.error('ABORT: VITE_SUPABASE_ANON_KEY 필요(RPC 인증 세션용)'); process.exit(2); }
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ABORT: ADMIN_EMAIL/ADMIN_PASSWORD 필요. RPC 는 admin/manager 세션(auth.uid())으로만 호출 가능.');
  console.error('  → supervisor 가 admin 계정 크리덴셜을 off-git 으로 주입 후 실행.');
  process.exit(2);
}

const svc = createClient(URL, SVC_KEY, { auth: { persistSession: false } });
const maskEmail = (e) => { if (!e) return '(none)'; const [l, d] = String(e).split('@'); const m = (s) => (s || '').slice(0, 2) + '***'; return `${m(l)}@${d ? m(d) : '???'}`; };

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

async function freezeSet() {
  const users = await listAllUsers();
  const { data: profiles, error } = await svc.from('user_profiles').select('id, email, role, approved, active');
  if (error) throw new Error('user_profiles: ' + error.message);
  const profById = new Map((profiles || []).map((p) => [p.id, p]));
  const unconfirmed = users.filter((u) => profById.has(u.id) && !u.email_confirmed_at).map((u) => ({ u, p: profById.get(u.id) }));
  const frozen = unconfirmed.filter(({ p }) => p.approved === true && p.active === true);
  return { users, profById, unconfirmed, frozen };
}

async function main() {
  console.log('=== T-20260802 EMAILCONFIRM-BACKFILL APPLY (per-uid RPC) ===');

  // ── STEP 1: freeze 재평가 ──
  const { unconfirmed, frozen } = await freezeSet();
  console.log(`예비군(unconfirmed): ${unconfirmed.length} | freeze(approved&active): ${frozen.length}`);
  const roles = frozen.map(({ p }) => p.role).sort();
  if (frozen.length !== 2 || !(roles.includes('manager') && roles.includes('staff'))) {
    console.error(`ABORT: freeze 술어 불일치(count=${frozen.length}, roles=${JSON.stringify(roles)}). blanket 방지 — 무write 종료.`);
    process.exit(3);
  }
  // coordinator(approved=false) 혼입 방어
  if (frozen.some(({ p }) => p.approved !== true || p.active !== true)) {
    console.error('ABORT: freeze 셋에 미승인/비활성 혼입. 무write 종료.'); process.exit(3);
  }

  // before 스냅샷 + id↔email 재검증
  const before = [];
  for (const { u, p } of frozen) {
    const { data: byId } = await svc.auth.admin.getUserById(u.id);
    const authEmail = byId?.user?.email || null;
    const rebindOk = !!authEmail && authEmail.trim().toLowerCase() === String(p.email).trim().toLowerCase()
      && authEmail.trim().toLowerCase() === String(u.email).trim().toLowerCase();
    if (!rebindOk) { console.error(`ABORT: id↔email 재검증 실패 id..${String(u.id).slice(-6)} — 무write 종료.`); process.exit(3); }
    before.push({ id: u.id, id_tail: String(u.id).slice(-6), email_masked: maskEmail(u.email), role: p.role, before_email_confirmed_at: u.email_confirmed_at || null });
  }
  console.log('before 스냅샷 + id↔email 재검증 OK:', before.map((b) => `${b.email_masked}(${b.role})`).join(', '));

  // ── STEP 2: admin/manager 세션 인증 ──
  const userClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signin, error: sErr } = await userClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (sErr || !signin?.session) { console.error('ABORT: admin 로그인 실패 —', sErr?.message); process.exit(4); }
  console.log(`admin 세션 확보: ${maskEmail(ADMIN_EMAIL)}`);

  // ── STEP 3: per-uid RPC 호출 (1건씩) ──
  const results = [];
  for (const b of before) {
    const { data: rpcRes, error: rErr } = await userClient.rpc('admin_approve_and_confirm_user', { target_user_id: b.id });
    if (rErr) { console.error(`ABORT: RPC 실패 id..${b.id_tail} — ${rErr.message}`); process.exit(5); }
    // cross_crm_write_rowcheck_standard: rows-affected 검증
    const profRows = rpcRes?.profile_rows;
    const confirmedNow = rpcRes?.email_confirmed_now;
    const alreadyConfirmed = rpcRes?.already_confirmed;
    if (profRows !== 1) { console.error(`ABORT: profile_rows=${profRows}!=1 id..${b.id_tail} (0-row silent write 방지)`); process.exit(5); }
    if (!confirmedNow && !alreadyConfirmed) { console.error(`ABORT: email_confirmed 미달성 id..${b.id_tail}`, rpcRes); process.exit(5); }
    console.log(`  ✅ RPC OK ${b.email_masked}(${b.role}): profile_rows=${profRows} email_confirmed_now=${confirmedNow} already=${alreadyConfirmed}`);
    results.push({ ...b, rpc: rpcRes });
  }

  // ── STEP 4: after 스냅샷 ──
  const after = [];
  for (const b of before) {
    const { data: byId } = await svc.auth.admin.getUserById(b.id);
    after.push({ id_tail: b.id_tail, email_masked: b.email_masked, role: b.role, after_email_confirmed_at: byId?.user?.email_confirmed_at || null });
  }

  // ── STEP 5: 예비군 재스캔(3→1) ──
  const post = await freezeSet();
  const rescanUnconfirmed = post.unconfirmed.map(({ u, p }) => ({ id_tail: String(u.id).slice(-6), email_masked: maskEmail(u.email), role: p.role, approved: p.approved }));
  const rescanFreeze = post.frozen.length;
  console.log(`\n재스캔: 예비군(unconfirmed)=${post.unconfirmed.length} (기대 1=coordinator), freeze(approved&active)=${rescanFreeze} (기대 0)`);
  for (const r of rescanUnconfirmed) console.log(`   · ${r.email_masked} role=${r.role} approved=${r.approved}`);

  const rescanOk = post.unconfirmed.length === 1 && post.unconfirmed[0].p.approved === false && rescanFreeze === 0;

  const summary = {
    ticket: 'T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL',
    phase: 'apply',
    before_snapshot: before.map(({ id, ...r }) => r),
    rpc_results: results.map(({ id, ...r }) => r),
    after_snapshot: after,
    rescan: { unconfirmed_total: post.unconfirmed.length, freeze_remaining: rescanFreeze, remaining: rescanUnconfirmed },
    asserts: {
      each_profile_rows_1: results.every((r) => r.rpc?.profile_rows === 1),
      each_confirmed: results.every((r) => r.rpc?.email_confirmed_now || r.rpc?.already_confirmed),
      after_all_confirmed: after.every((a) => !!a.after_email_confirmed_at),
      rescan_3_to_1_coordinator_only: rescanOk,
    },
  };
  if (!existsSync('scripts/_evidence')) mkdirSync('scripts/_evidence', { recursive: true });
  const out = 'scripts/_evidence/T-20260802-foot-STAFF-EMAILCONFIRM-BACKFILL_apply.json';
  writeFileSync(out, JSON.stringify(summary, null, 2));

  console.log('\n=== ASSERTS ===');
  for (const [k, v] of Object.entries(summary.asserts)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  console.log('\nevidence(마스킹) →', out);
  if (!Object.values(summary.asserts).every(Boolean)) process.exit(6);
  console.log('\n✅ APPLY 완료 — 2계정 email_confirm 보정, 잔존 예비군=coordinator 미승인 1건.');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
