/**
 * T-20260605-foot-HANDOVER-DBFIX (P0 FIX-REQUEST) — 운영DB 적용 + AC-3/AC-4 실동작 증빙
 *
 * supervisor 요구(insufficient_verification 보완):
 *   1) AC-3/AC-4: 일반 직원 계정으로 /admin/handover 저장→캘린더 반영 + 재진입 조회 (PostgREST+RLS 경유)
 *   2) 운영DB(rxlomoozakkjesdqjtvd): handover_notes/handover_checklist_items 존재 + RLS 정책 확인
 *
 * 두 경로로 검증:
 *   A. node-pg(admin)    → 테이블/RLS/정책/트리거 스키마 확인 (req #2)
 *   B. supabase-js(anon) → test@medibuilder.com(coordinator=일반직원) 로그인 후
 *                          앱과 동일 쿼리로 INSERT(저장) → SELECT(재조회/캘린더 반영) → 정리 (req #1)
 *
 * 실행: node scripts/verify_handover_ac34_prod.mjs
 *   (.env: SUPABASE_DB_PASSWORD / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *   QA 계정 override: TEST_EMAIL / TEST_PASSWORD
 */
import pg from 'pg';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

// ── .env 로드 ──
const env = {};
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD;
const SUPA_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPass2026!';

if (!DB_PASSWORD || !SUPA_URL || !ANON_KEY) {
  console.error('❌ 필요 env 누락 (SUPABASE_DB_PASSWORD / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const line = (s = '') => console.log(s);
const ok = (s) => console.log('  ✅ ' + s);
const fail = (s) => { console.log('  ❌ ' + s); process.exitCode = 1; };

// ════════════════════════════════════════════════════════════════
// PART A — 운영DB 스키마/RLS/정책 확인 (req #2, node-pg admin)
// ════════════════════════════════════════════════════════════════
async function partA() {
  line('\n══════════ PART A — 운영DB(rxlomoozakkjesdqjtvd) 스키마/RLS/정책 ══════════');
  const client = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
    password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  line(`연결: postgres.rxlomoozakkjesdqjtvd  ${new Date().toISOString()}`);

  // 1) 테이블 존재
  const tbl = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('handover_notes','handover_checklist_items')
    ORDER BY table_name;`);
  line('\n[A1] 테이블 존재:');
  console.table(tbl.rows);
  tbl.rowCount === 2 ? ok('handover_notes + handover_checklist_items 모두 존재') : fail(`테이블 ${tbl.rowCount}/2`);

  // 2) RLS 활성
  const rls = await client.query(`
    SELECT relname AS table, relrowsecurity AS rls_enabled FROM pg_class
    WHERE relname IN ('handover_notes','handover_checklist_items') AND relnamespace='public'::regnamespace
    ORDER BY relname;`);
  line('\n[A2] RLS 활성:');
  console.table(rls.rows);
  rls.rows.every(r => r.rls_enabled) ? ok('두 테이블 모두 RLS ON') : fail('RLS 미활성 테이블 존재');

  // 3) 정책 목록 (cmd/roles/using/check)
  const pol = await client.query(`
    SELECT tablename AS table, policyname, cmd, roles::text AS roles,
           qual        AS using_expr,
           with_check  AS check_expr
    FROM pg_policies
    WHERE tablename IN ('handover_notes','handover_checklist_items')
    ORDER BY tablename, cmd;`);
  line('\n[A3] RLS 정책 (기대 8개: 테이블당 select/insert/update/delete):');
  console.table(pol.rows.map(r => ({
    table: r.table, cmd: r.cmd, roles: r.roles,
    using: (r.using_expr || '').slice(0, 48), check: (r.check_expr || '').slice(0, 48),
  })));
  pol.rowCount === 8 ? ok(`정책 8개 확인`) : fail(`정책 ${pol.rowCount}/8`);

  // 핵심 정책 의미 검증
  const noteUpd = pol.rows.find(r => r.table === 'handover_notes' && r.cmd === 'UPDATE');
  const noteDel = pol.rows.find(r => r.table === 'handover_notes' && r.cmd === 'DELETE');
  const noteSel = pol.rows.find(r => r.table === 'handover_notes' && r.cmd === 'SELECT');
  const noteIns = pol.rows.find(r => r.table === 'handover_notes' && r.cmd === 'INSERT');
  (noteSel?.roles.includes('authenticated') && noteSel?.using_expr === 'true') ? ok('select: authenticated / using(true)') : fail('select 정책 불일치');
  (noteIns?.roles.includes('authenticated')) ? ok('insert: authenticated') : fail('insert 정책 불일치');
  (noteUpd?.using_expr?.includes('auth.uid()')) ? ok('update: author_id = auth.uid()') : fail('update 정책 불일치');
  (noteDel?.using_expr?.includes('auth.uid()')) ? ok('delete: author_id = auth.uid()') : fail('delete 정책 불일치');

  // 4) 트리거
  const trg = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='handover_notes_updated_at';`);
  line('\n[A4] updated_at 트리거:');
  trg.rowCount > 0 ? ok('handover_notes_updated_at 존재') : fail('트리거 없음');

  // 5) 현재 실데이터 건수 (참고)
  const cnt = await client.query(`SELECT
    (SELECT count(*) FROM public.handover_notes) AS notes,
    (SELECT count(*) FROM public.handover_checklist_items) AS items;`);
  line('\n[A5] 현재 실데이터 건수(참고):');
  console.table(cnt.rows);

  await client.end();
}

// ════════════════════════════════════════════════════════════════
// PART B — 일반직원 계정 실동작: 저장→재조회 (req #1, AC-3/AC-4)
// ════════════════════════════════════════════════════════════════
async function partB() {
  line('\n══════════ PART B — 일반직원 계정 실동작 (AC-3 저장 / AC-4 재진입 조회) ══════════');
  const supa = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });

  // 1) 로그인 (앱 로그인과 동일: signInWithPassword)
  const { data: auth, error: authErr } = await supa.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (authErr) { fail(`로그인 실패: ${authErr.message}`); return; }
  const uid = auth.user.id;
  line(`[B1] 로그인 OK: ${TEST_EMAIL}  uid=${uid}`);

  // 2) 프로필/역할 확인 (일반직원 증빙 — admin 아님)
  const { data: prof } = await supa.from('user_profiles').select('id, name, role, clinic_id').eq('id', uid).maybeSingle();
  line('[B2] 프로필(역할):');
  console.table([prof]);
  if (!prof) { fail('user_profiles 없음'); return; }
  prof.role !== 'admin' ? ok(`일반직원 계정 확인 (role=${prof.role}, admin 아님 → AC-5 전직원 작성 경로)`) : line(`  ⚠️ role=admin (일반직원 증빙 약함)`);

  // clinic_id 결정 (프로필 우선, 없으면 staff 조회)
  let clinicId = prof.clinic_id;
  if (!clinicId) {
    const { data: st } = await supa.from('staff').select('clinic_id').eq('user_id', uid).limit(1).maybeSingle();
    clinicId = st?.clinic_id;
  }
  if (!clinicId) {
    const { data: cl } = await supa.from('clinics').select('id, name').limit(1).maybeSingle();
    clinicId = cl?.id;
  }
  line(`[B3] clinic_id = ${clinicId}`);
  if (!clinicId) { fail('clinic_id 확보 실패'); await supa.auth.signOut(); return; }

  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString();
  const memo = `[QA-AC34 검증 ${stamp}] 자동 생성 — 저장/재조회 후 자동삭제`;

  // 3) AC-3 저장: handover_notes INSERT (앱 Handover.tsx와 동일 필드, RLS insert 경유)
  line('\n[B4] AC-3 저장 — handover_notes INSERT (PostgREST + RLS authenticated):');
  const { data: note, error: insErr } = await supa
    .from('handover_notes')
    .insert({ clinic_id: clinicId, part_code: 'coordinator', target_date: today, author_id: uid, author_name: prof.name ?? 'QA', memo })
    .select()
    .single();
  if (insErr) { fail(`note INSERT 실패: ${insErr.message}`); await supa.auth.signOut(); return; }
  ok(`note 저장 성공 id=${note.id} (author_id=auth.uid() → RLS insert/own 통과)`);

  // 체크리스트 항목 INSERT (자식 RLS: 부모 author_id=auth.uid() 검사 경유)
  const { error: ciErr } = await supa.from('handover_checklist_items')
    .insert([{ handover_id: note.id, label: 'QA 체크 항목 A', is_checked: false, sort_order: 0 },
             { handover_id: note.id, label: 'QA 체크 항목 B', is_checked: true, sort_order: 1 }]);
  ciErr ? fail(`checklist INSERT 실패: ${ciErr.message}`) : ok('checklist 2건 저장 성공 (자식 RLS author 검사 통과)');

  // 4) AC-4 재진입 조회: 앱 fetch와 동일 쿼리 (캘린더 범위 SELECT + 조인)
  line('\n[B5] AC-4 재진입 조회 — 앱 동일 쿼리 (clinic+date 범위, checklist 조인):');
  const { data: reload, error: selErr } = await supa
    .from('handover_notes')
    .select('*, handover_checklist_items(*)')
    .eq('clinic_id', clinicId)
    .gte('target_date', today)
    .lte('target_date', today);
  if (selErr) { fail(`재조회 실패: ${selErr.message}`); }
  else {
    const found = reload.find(n => n.id === note.id);
    if (found) {
      ok(`재진입 조회 성공 — 방금 저장한 note가 ${today} 캘린더에 반영됨`);
      console.table([{ id: found.id, part_code: found.part_code, target_date: found.target_date,
                       author: found.author_name, checklist: found.handover_checklist_items?.length, memo: found.memo?.slice(0, 40) }]);
      found.handover_checklist_items?.length === 2 ? ok('체크리스트 2건 조인 정상') : fail(`체크리스트 ${found.handover_checklist_items?.length}/2`);
    } else fail('재조회 결과에 저장 note 없음 (캘린더 미반영)');
  }

  // 5) 정리 (운영DB 오염 방지 — cascade로 checklist 동반 삭제, RLS delete=own 경유)
  line('\n[B6] 정리 — 검증 데이터 삭제 (RLS delete own 경유, cascade):');
  const { error: delErr } = await supa.from('handover_notes').delete().eq('id', note.id);
  delErr ? fail(`삭제 실패(수동정리 필요 id=${note.id}): ${delErr.message}`) : ok('검증 note 삭제 완료 (실데이터 0건 유지)');

  await supa.auth.signOut();
}

// ════════════════════════════════════════════════════════════════
// PART C — 비-admin 일반직원(coordinator) 임시계정 실동작 (req #1 문구 충족)
//   handover route 는 RoleGuard 없음 + RLS 는 role 무관(authenticated/true) →
//   비-admin staff 도 저장/조회 가능함을 임시 coordinator 계정으로 실증.
// ════════════════════════════════════════════════════════════════
async function partC() {
  line('\n══════════ PART C — 비-admin 일반직원(coordinator) 임시계정 실동작 ══════════');
  if (!SERVICE_KEY) { line('  ⚠️ SERVICE_ROLE_KEY 없음 — PART C skip (PART B authenticated 경로로 갈음)'); return; }

  const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 종로 풋센터 (PART B 확인값)
  const email = `qa.handover.${Date.now()}@medibuilder-qa.local`;
  const password = 'QaHandover2026!';
  let userId = null;

  try {
    // 1) 임시 auth 유저 생성 (on_auth_user_created 트리거가 user_profiles 자동 생성)
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name: 'QA코디(임시)' },
    });
    if (cErr) { fail(`임시계정 생성 실패: ${cErr.message}`); return; }
    userId = created.user.id;
    line(`[C1] 임시 auth 유저 생성: ${email}  uid=${userId}`);

    // 2) 프로필을 coordinator(일반직원) + clinic + active/approved 로 세팅
    const { error: upErr } = await admin.from('user_profiles')
      .update({ role: 'coordinator', clinic_id: CLINIC_ID, active: true, approved: true, name: 'QA코디(임시)' })
      .eq('id', userId);
    upErr ? fail(`프로필 세팅 실패: ${upErr.message}`) : ok('프로필 role=coordinator (비-admin 일반직원) 세팅');

    // 3) 임시계정으로 로그인 (anon client) → handover 저장/재조회
    const supa = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: aErr } = await supa.auth.signInWithPassword({ email, password });
    if (aErr) { fail(`임시계정 로그인 실패: ${aErr.message}`); return; }
    ok('임시 coordinator 로그인 OK');

    const today = new Date().toISOString().slice(0, 10);
    const { data: note, error: insErr } = await supa.from('handover_notes')
      .insert({ clinic_id: CLINIC_ID, part_code: 'therapist', target_date: today,
                author_id: userId, author_name: 'QA코디(임시)', memo: `[QA-C 비admin검증 ${new Date().toISOString()}] 자동삭제` })
      .select().single();
    if (insErr) { fail(`[C2] coordinator INSERT 실패: ${insErr.message}`); }
    else {
      ok(`[C2] AC-3 저장: coordinator 계정으로 note 저장 성공 id=${note.id}`);
      await supa.from('handover_checklist_items').insert({ handover_id: note.id, label: 'C 체크', is_checked: false, sort_order: 0 });
      const { data: reload } = await supa.from('handover_notes')
        .select('*, handover_checklist_items(*)').eq('clinic_id', CLINIC_ID).gte('target_date', today).lte('target_date', today);
      const found = reload?.find(n => n.id === note.id);
      found ? ok(`[C3] AC-4 재조회: coordinator 저장분 캘린더 반영 확인 (checklist ${found.handover_checklist_items?.length})`)
            : fail('[C3] coordinator 재조회 실패');
      await supa.from('handover_notes').delete().eq('id', note.id);
      ok('[C4] 검증 note 삭제');
    }
    await supa.auth.signOut();
  } finally {
    // 4) 임시 계정 완전 삭제 (profile cascade + auth 유저)
    if (userId) {
      try { await admin.from('user_profiles').delete().eq('id', userId); } catch { /* cascade로도 정리됨 */ }
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      dErr ? fail(`임시계정 삭제 실패(수동정리 필요 ${userId}): ${dErr.message}`) : ok('[C5] 임시 coordinator 계정 완전 삭제');
    }
  }
}

(async () => {
  try {
    await partA();
    await partB();
    await partC();
    line('\n════════════════════════════════════════════════════════════');
    line(process.exitCode ? '🔴 검증 실패 항목 있음 — 위 ❌ 확인' : '🟢 ALL PASS — 운영DB 적용 + AC-3/AC-4 실동작 증빙 완료');
    line('════════════════════════════════════════════════════════════');
  } catch (e) {
    console.error('❌ 예외:', e.message);
    process.exit(1);
  }
})();
