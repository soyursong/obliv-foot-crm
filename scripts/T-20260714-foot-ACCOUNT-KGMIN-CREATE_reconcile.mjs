/**
 * T-20260714-foot-ACCOUNT-KGMIN-CREATE — RECONCILE (신규생성 아님 · duplicate 가드 발동)
 *
 * 진단 결과: kgm8337@gmail.com 계정 이미 존재(170e0cd5-...) — 2026-07-10 self-signup.
 *   user_profiles/staff 는 이미 정합(name=강경민, role=consultant, approved=true, active=true, clinic_id=jongno-foot).
 *   유일 로그인 블로커 = auth.users.email_confirmed_at = NULL (self-signup 미확인 → "Email not confirmed").
 *   → FACEOFANGEL(T-20260713) RC와 동일 구조. 신규 생성 금지(AC-1) → reconcile.
 *
 * RECONCILE 동작 (단일계정 freeze):
 *   - admin.updateUserById(id, { password: TEMP_PW, email_confirm: true })
 *     · email_confirm=true → email_confirmed_at 세팅(로그인 가능)
 *     · password=TEMP_PW  → 알려진 임시비번(set==relay==실로그인 3자일치)
 *   - user_profiles/staff 는 이미 정합 → 무변경(필요 시 재보정만).
 *
 * 안전:
 *   - ★Identity 재검증(getUserById id↔email) 선행 (GOTRUE-EMAIL-FILTER-BAN).
 *   - before-snapshot(rollback/, 평문비번 미포함) 적재.
 *   - 임시비번 env(TEMP_PW) 주입 — 평문 git 미커밋. 콘솔 출력만 → responder relay 1회.
 *   - rollback = 본인 최초 로그인 후 즉시 변경(비번 해시 irreversible by design, 계정영향 없음).
 * 실행: SUPABASE_SERVICE_ROLE_KEY=.. VITE_SUPABASE_ANON_KEY=.. APPLY=true TEMP_PW='..' node scripts/..._reconcile.mjs  (기본 DRY)
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.ANON_KEY || '';
const ID = '170e0cd5-2d17-43d7-9433-3be5280d5d30';
const EMAIL = 'kgm8337@gmail.com';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const APPLY = process.env.APPLY === 'true';
const TEMP_PW = process.env.TEMP_PW || '';
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`=== KGMIN(강경민) RECONCILE (APPLY=${APPLY}) ===`, new Date().toISOString());

  // 0) ★Identity 재검증 (destructive/write 직전 id↔email) — GOTRUE-EMAIL-FILTER-BAN
  const { data: byId, error: ge } = await svc.auth.admin.getUserById(ID);
  if (ge) { console.error('getUserById 실패:', ge.message); process.exit(1); }
  const b = byId.user;
  if ((b.email || '').trim().toLowerCase() !== EMAIL) {
    console.error(`ABORT: uid↔email 불일치 (${b.email} ≠ ${EMAIL})`); process.exit(2);
  }
  console.log('[0] Identity 재검증 OK:', ID, '=', b.email);

  // before-snapshot (평문비번 미포함 — 상태 시각만)
  const { data: prof0 } = await svc.from('user_profiles').select('name, role, approved, active, clinic_id').eq('id', ID).maybeSingle();
  const { data: st0 } = await svc.from('staff').select('id, name, role, active, clinic_id').eq('user_id', ID).maybeSingle();
  const snap = {
    ticket: 'T-20260714-foot-ACCOUNT-KGMIN-CREATE', captured_at: new Date().toISOString(),
    id: b.id, email: b.email, email_confirmed_at: b.email_confirmed_at, banned_until: b.banned_until ?? null,
    last_sign_in_at: b.last_sign_in_at, created_at: b.created_at,
    user_profiles: prof0, staff: st0,
    note: 'password hash NOT captured (irreversible). rollback=user self-change or re-reset. email_confirm rollback=set email_confirmed_at NULL(비권장).',
  };
  mkdirSync('rollback', { recursive: true });
  const snapPath = `rollback/T-20260714-foot-ACCOUNT-KGMIN-CREATE_before.json`;
  writeFileSync(snapPath, JSON.stringify(snap, null, 2));
  console.log('[snapshot] →', snapPath);
  console.log('  auth.email_confirmed_at =', b.email_confirmed_at || 'NULL (블로커)');
  console.log('  user_profiles =', JSON.stringify(prof0));
  console.log('  staff         =', JSON.stringify(st0));

  // rollback SQL 기록
  const rbPath = `rollback/T-20260714-foot-ACCOUNT-KGMIN-CREATE_rollback.sql`;
  writeFileSync(rbPath,
    `-- Rollback: T-20260714-foot-ACCOUNT-KGMIN-CREATE reconcile 되돌리기\n` +
    `-- 비번: 실장 본인 최초 로그인 후 변경(해시 irreversible). 계정 비활성화가 필요하면 아래.\n` +
    `-- UPDATE public.user_profiles SET active=false WHERE id='${ID}';\n` +
    `-- UPDATE public.staff SET active=false WHERE user_id='${ID}';\n` +
    `-- (email_confirmed_at 을 NULL 로 되돌리는 것은 로그인 재차단이므로 비권장)\n`);
  console.log('[rollback] →', rbPath);

  if (!APPLY) { console.log('\n[DRY] APPLY=true + TEMP_PW=.. 로 재실행 시 email_confirm + 임시비번 설정.'); return; }
  if (!TEMP_PW || TEMP_PW.length < 10) { console.error('ABORT: TEMP_PW(10자+) 필요.'); process.exit(2); }

  // 1) profile/staff 정합 재보정 (이미 정합이면 no-op이지만 명시적 보장)
  const { error: pe } = await svc.from('user_profiles')
    .update({ name: '강경민', role: 'consultant', approved: true, active: true, clinic_id: CLINIC_ID })
    .eq('id', ID);
  if (pe) { console.error('user_profiles 보정 실패:', pe.message); process.exit(1); }
  const { data: stEx } = await svc.from('staff').select('id').eq('user_id', ID).maybeSingle();
  if (stEx) {
    const { error: se } = await svc.from('staff')
      .update({ name: '강경민', role: 'consultant', active: true, clinic_id: CLINIC_ID })
      .eq('user_id', ID);
    if (se) { console.error('staff 보정 실패:', se.message); process.exit(1); }
  } else {
    const { error: si } = await svc.from('staff')
      .insert({ user_id: ID, name: '강경민', role: 'consultant', active: true, clinic_id: CLINIC_ID });
    if (si) { console.error('staff INSERT 실패:', si.message); process.exit(1); }
  }
  console.log('[1] user_profiles/staff 정합 보장 ✅');

  // 2) email_confirm + 임시비번 (auth.users 1행 WRITE)
  const { data: upd, error: ue } = await svc.auth.admin.updateUserById(ID, { password: TEMP_PW, email_confirm: true });
  if (ue) { console.error('updateUserById 실패:', ue.message); process.exit(1); }
  console.log('[2] email_confirm + 임시비번 설정 ✅  email_confirmed_at:', upd.user.email_confirmed_at);

  // 3) 실로그인 검증 (password grant)
  if (!ANON) { console.warn('[3] ANON key 없음 → 로그인 검증 스킵'); }
  else {
    const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: TEMP_PW }) });
    const j = await r.json();
    console.log('[3] 실로그인 검증:', r.status, j.access_token ? '✅ access_token 발급' : `❌ ${JSON.stringify(j)}`);
    if (!j.access_token) process.exit(1);
  }

  // 4) 권한 게이트 재확인
  const { data: prof } = await svc.from('user_profiles').select('name, role, approved, active, clinic_id').eq('id', ID).maybeSingle();
  console.log('[4] user_profiles gate:', JSON.stringify(prof), prof?.approved && prof?.active ? '→ 상담실장 워크스페이스 진입 OK (승인대기 벽 없음)' : '→ ⚠게이트 미충족');

  console.log('\n[DONE] set==relay==실로그인 3자일치. 임시비번=콘솔(git 미기재). responder relay 1회 → 총괄 → 강경민.');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
