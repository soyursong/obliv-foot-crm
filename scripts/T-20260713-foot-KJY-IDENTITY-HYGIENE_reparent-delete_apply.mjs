/**
 * T-20260713-foot-KJY-IDENTITY-HYGIENE — reparent(9) + hard-DELETE gmail 계정 · APPLY (DESTRUCTIVE)
 *
 * 🚨 DESTRUCTIVE. 게이트: ① 총괄 재confirm ✅(②안) + ② supervisor DB-GATE 통과 후에만 실행.
 *    기본 DRY. 실제 실행 = APPLY=true CONFIRM_DELETE=YES.
 *    point-of-no-return = hard-DELETE 순간(비가역). 그 전(reparent 후)까지는 rollback SQL로 복원 가능.
 *
 * 안전 프로토콜 (DA-20260713-foot-KJY-ASSIGNACTION-FK-DELETE Q3 — 하나라도 실패 시 abort):
 *   - freeze: dry-run이 만든 archive.json 의 9개 assignment_actions.id 를 대상셋으로 고정 (여기서 재생성 안 함)
 *   - rowcount=9 assert: reparent 영향 행 정확히 9 (≠9 abort + planner 보고)
 *   - id↔email 재검증 2회: (a) reparent 직전 (b) hard-DELETE 직전 — getUserById 기준(?email= 미신뢰)
 *   - 정본 b36e74a3(@oblivseoul.kr) 무접점: 삭제/비활성/수정 금지. reparent는 canon으로 '넣는' 방향만.
 *   - archive-first: dry-run에서 이미 스냅샷. apply 시작 시 archive.json 존재/freeze 일치 재확인.
 *
 * 처리 순서: id↔email#1 → rowcount=9 assert → reparent 9 → 검증 → id↔email#2 → blocking=0 확인 →
 *            hard-DELETE gmail (CASCADE 2 동반) → 삭제/무접점 검증.
 *
 * 실행:
 *   (DRY 재현) node scripts/T-20260713-foot-KJY-IDENTITY-HYGIENE_reparent-delete_apply.mjs
 *   (APPLY)    APPLY=true CONFIRM_DELETE=YES node scripts/..._apply.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(__dirname, 'out');
const RB_DIR = join(ROOT, 'rollback');
const REF = 'rxlomoozakkjesdqjtvd';
const GMAIL_PREFIX = 'a7e2e012', CANON_PREFIX = 'b36e74a3';
const GMAIL_EMAIL = 'faceofangel9999@gmail.com';
const CANON_EMAIL = 'faceofangel9999@oblivseoul.kr';
const EXPECT_REPARENT = 9;
const APPLY = process.env.APPLY === 'true';
const CONFIRMED = process.env.CONFIRM_DELETE === 'YES';

function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
const SERVICE_ROLE = envVal('SUPABASE_SERVICE_ROLE_KEY');
const SUPA_URL = envVal('VITE_SUPABASE_URL');
const ANON = envVal('VITE_SUPABASE_ANON_KEY');
if (!ACCESS_TOKEN || !SERVICE_ROLE || !SUPA_URL) throw new Error('ACCESS_TOKEN + SERVICE_ROLE + SUPA_URL 필요');
const svc = createClient(SUPA_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
async function getUserById(id) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${id}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, id: j.id ?? null, email: j.email ?? null };
}
const die = (msg, code = 3) => { console.error('\n❌ ABORT:', msg); process.exit(code); };

(async () => {
  console.log(`=== KJY IDENTITY HYGIENE reparent+delete (APPLY=${APPLY}) ===`, new Date().toISOString());
  const log = { ticket: 'T-20260713-foot-KJY-IDENTITY-HYGIENE', apply: APPLY, at: new Date().toISOString(), steps: {} };

  // 0) archive/freeze 로드 (dry-run 선행 필수)
  const archivePath = join(RB_DIR, 'T-20260713-foot-KJY-IDENTITY-HYGIENE_archive.json');
  if (!existsSync(archivePath)) die(`archive 없음(${archivePath}) — dry-run 선행 필수(archive-first).`);
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  const FREEZE_IDS = archive.freeze_ids || [];
  if (FREEZE_IDS.length !== EXPECT_REPARENT) die(`freeze set ${FREEZE_IDS.length} ≠ ${EXPECT_REPARENT}`);
  log.freeze_ids = FREEZE_IDS;
  console.log(`[0] freeze set 로드 = ${FREEZE_IDS.length}개 assignment_actions.id`);

  // 1) UUID resolve + id↔email 재검증 #1 (reparent 직전)
  const uu = await runSQL(
    `SELECT id, email FROM auth.users WHERE id::text LIKE '${GMAIL_PREFIX}%' OR id::text LIKE '${CANON_PREFIX}%';`);
  const GMAIL_ID = (uu.find(r => r.id.startsWith(GMAIL_PREFIX)) || {}).id;
  const CANON_ID = (uu.find(r => r.id.startsWith(CANON_PREFIX)) || {}).id;
  if (!GMAIL_ID || !CANON_ID) die('gmail/canon UUID resolve 실패');
  if (GMAIL_ID !== archive.gmail_id || CANON_ID !== archive.canon_id) die('archive UUID 불일치 — 대상 drift');
  const g1 = await getUserById(GMAIL_ID), c1 = await getUserById(CANON_ID);
  log.steps.id_email_1 = { gmail: g1, canon: c1 };
  if (!(g1.status === 200 && g1.id === GMAIL_ID && g1.email === GMAIL_EMAIL &&
        c1.status === 200 && c1.id === CANON_ID && c1.email === CANON_EMAIL))
    die(`id↔email #1 실패 gmail:${JSON.stringify(g1)} canon:${JSON.stringify(c1)}`);
  console.log('[1] id↔email 재검증 #1 (reparent 직전) PASS');

  // 2) rowcount=9 assert (현시점 재검증)
  const cur = await runSQL(
    `SELECT count(*)::int n FROM public.assignment_actions WHERE created_by='${GMAIL_ID}';`);
  log.steps.rowcount_pre = cur[0].n;
  if (cur[0].n !== EXPECT_REPARENT) die(`rowcount ${cur[0].n} ≠ ${EXPECT_REPARENT} — 실행시점 drift. planner 보고.`);
  console.log(`[2] rowcount=${EXPECT_REPARENT} assert PASS`);

  if (!APPLY) {
    console.log('\n[DRY] 여기까지 preflight. 실제 실행 = APPLY=true CONFIRM_DELETE=YES');
    writeSteps(log); return;
  }
  if (!CONFIRMED) die('APPLY=true 이나 CONFIRM_DELETE=YES 없음 — destructive 이중확인 미충족', 2);

  // === point-of-no-return 이전: reparent (reversible) ===
  // 3) reparent — freeze한 9 id + created_by=gmail 조건 (이중), 영향 행 정확히 9
  const idList = FREEZE_IDS.map(id => `'${id}'`).join(',');
  const upd = await runSQL(
    `WITH u AS (UPDATE public.assignment_actions SET created_by='${CANON_ID}'
       WHERE created_by='${GMAIL_ID}' AND id IN (${idList}) RETURNING id)
     SELECT count(*)::int n FROM u;`);
  log.steps.reparent_affected = upd[0].n;
  if (upd[0].n !== EXPECT_REPARENT) die(`reparent 영향 행 ${upd[0].n} ≠ ${EXPECT_REPARENT} — 롤백 필요! rollback SQL 실행.`, 4);
  console.log(`[3] reparent 완료 — 영향 행 = ${upd[0].n} (created_by gmail→canon)`);

  // 4) reparent 검증: gmail 잔여 0, freeze 9건 canon 귀속
  const post = await runSQL(
    `SELECT (SELECT count(*)::int FROM public.assignment_actions WHERE created_by='${GMAIL_ID}') gmail_left,
            (SELECT count(*)::int FROM public.assignment_actions WHERE id IN (${idList}) AND created_by='${CANON_ID}') canon_now;`);
  log.steps.reparent_verify = post[0];
  if (post[0].gmail_left !== 0 || post[0].canon_now !== EXPECT_REPARENT)
    die(`reparent 검증 실패 ${JSON.stringify(post[0])} — rollback SQL 실행.`, 4);
  console.log(`[4] reparent 검증 PASS — gmail 잔여=0, canon 귀속=${post[0].canon_now}`);

  // 5) id↔email 재검증 #2 (hard-DELETE 직전)
  const g2 = await getUserById(GMAIL_ID), c2 = await getUserById(CANON_ID);
  log.steps.id_email_2 = { gmail: g2, canon: c2 };
  if (!(g2.status === 200 && g2.id === GMAIL_ID && g2.email === GMAIL_EMAIL &&
        c2.status === 200 && c2.id === CANON_ID && c2.email === CANON_EMAIL))
    die(`id↔email #2 실패 — hard-DELETE 중단. reparent는 유지(rollback 여부 판단).`, 4);
  console.log('[5] id↔email 재검증 #2 (hard-DELETE 직전) PASS');

  // 6) 잔여 blocking FK(NO ACTION/RESTRICT) 전량 0 재확인 (숨은 참조 방지)
  const fks = await runSQL(
    `SELECT n.nspname s, t.relname t, a.attname col FROM pg_constraint c
     JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='auth.users'::regclass AND c.confdeltype IN ('a','r');`);
  let blockLeft = 0;
  for (const f of fks) {
    const r = await runSQL(`SELECT count(*)::int n FROM "${f.s}"."${f.t}" WHERE "${f.col}"='${GMAIL_ID}';`);
    if (r[0].n > 0) { blockLeft += r[0].n; console.error(`  ⚠ 잔여 blocking: ${f.s}.${f.t}.${f.col}=${r[0].n}`); }
  }
  log.steps.blocking_left = blockLeft;
  if (blockLeft > 0) die(`잔여 blocking FK=${blockLeft} — hard-DELETE 23503 예상. 중단(reparent 유지).`, 4);
  console.log('[6] 잔여 blocking FK=0 재확인 PASS');

  // === point-of-no-return: hard-DELETE (비가역) ===
  console.log('[7] 🚨 hard-DELETE 실행 (비가역)...');
  const { error: delErr } = await svc.auth.admin.deleteUser(GMAIL_ID, false); // shouldSoftDelete=false → hard
  if (delErr) die(`hard-DELETE 실패: ${delErr.message} — reparent는 유지됨(정본 무손상).`, 5);
  console.log('[7] hard-DELETE 호출 완료');

  // 8) 삭제 검증: getUserById(gmail)=not found, CASCADE 2 소실
  const gAfter = await getUserById(GMAIL_ID);
  const casc = await runSQL(
    `SELECT (SELECT count(*)::int FROM auth.identities WHERE user_id='${GMAIL_ID}') idnt,
            (SELECT count(*)::int FROM public.user_profiles WHERE id='${GMAIL_ID}') uprof,
            (SELECT count(*)::int FROM auth.users WHERE id='${GMAIL_ID}') usr;`);
  log.steps.delete_verify = { getUserById: gAfter, cascade: casc[0] };
  const deleted = gAfter.status === 404 && casc[0].usr === 0 && casc[0].idnt === 0 && casc[0].uprof === 0;
  console.log(`[8] 삭제 검증: getUserById=${gAfter.status} / auth.users=${casc[0].usr} / identities=${casc[0].idnt} / user_profiles=${casc[0].uprof} ${deleted ? '✅' : '⚠'}`);

  // 9) 정본 무손상 검증 (getUserById + user_profiles + login)
  const cAfter = await getUserById(CANON_ID);
  const cProf = await runSQL(`SELECT count(*)::int n, max(role) role, bool_or(approved) approved FROM public.user_profiles WHERE id='${CANON_ID}';`);
  let login = null;
  if (ANON) {
    // 로그인 자격증명 미보유 → 계정 존재/상태만 확인(비번 grant 미시도). 존재+approved 로 대체.
    login = { note: '비번 미보유 → getUserById 200 + user_profiles approved 로 대체 검증' };
  }
  log.steps.canon_intact = { getUserById: cAfter, user_profiles: cProf[0], login };
  const canonOK = cAfter.status === 200 && cAfter.email === CANON_EMAIL && cProf[0].n === 1;
  console.log(`[9] 정본 무손상: getUserById=${cAfter.status} email=${cAfter.email} profiles=${cProf[0].n} approved=${cProf[0].approved} ${canonOK ? '✅' : '⚠'}`);
  const canonAssign = await runSQL(`SELECT count(*)::int n FROM public.assignment_actions WHERE created_by='${CANON_ID}';`);
  console.log(`    → canon 귀속 assignment_actions 총 ${canonAssign[0].n}건 (reparent 9 포함)`);

  log.result = deleted && canonOK ? 'SUCCESS' : 'PARTIAL/CHECK';
  writeSteps(log);
  console.log(`\n=== APPLY ${log.result} ===`);
  if (!deleted || !canonOK) process.exit(6);

  function _noop() {}
})().catch(e => { console.error('FATAL', e); process.exit(1); });

function writeSteps(log) {
  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `T-20260713-KJY-IDENTITY-HYGIENE_apply${log.apply ? '' : '_dry'}`);
  writeFileSync(base + '.json', JSON.stringify(log, null, 2));
  console.log(`[evidence] ${base}.json`);
}
