/**
 * T-20260713-foot-KJY-IDENTITY-HYGIENE — reparent(9) + hard-DELETE gmail 계정 · DRY-RUN (archive-first)
 *
 * ⚠️ READ-ONLY + archive 스냅샷만. DDL/DML 0. UPDATE/DELETE 일절 없음.
 *    본 스크립트는 destructive 실행의 안전 프로토콜 산출물(archive-first + freeze + rowcount=9 preview
 *    + id↔email 2회 재검증 preview + 롤백 SQL 생성). 실제 실행은 _apply.mjs (APPLY=true) — 그러나
 *    supervisor DB-GATE 통과 후에만. (게이트: ①총괄 재confirm ✅ + ②supervisor DB-GATE)
 *
 * ref:
 *   - DA-20260713-foot-KJY-ASSIGNACTION-FK-DELETE (Q3 GO-조건: archive-first + freeze + rowcount=N assert + 롤백)
 *   - Cross-CRM Auth Identity Resolution 표준 (?email= 서버필터 단독 미신뢰 → getUserById id↔email 재검증)
 *   - FK 카탈로그 evidence: scripts/out/T-20260713-KJY-IDENTITY-HYGIENE_fk-catalog.md (AC-E2 9건 단일 blocking)
 *
 * 처리 순서(총괄 ②안): reparent 9(created_by gmail→canon) → hard-DELETE gmail(CASCADE 2 동반) → FOLLOWUP.
 *
 * 실행: node scripts/T-20260713-foot-KJY-IDENTITY-HYGIENE_reparent-delete_dryrun.mjs
 * 산출물:
 *   rollback/T-20260713-foot-KJY-IDENTITY-HYGIENE_archive.json   (archive-first 스냅샷 — 커밋)
 *   rollback/T-20260713-foot-KJY-IDENTITY-HYGIENE_reparent_rollback.sql  (reparent 되돌림 — 커밋)
 *   scripts/out/T-20260713-KJY-IDENTITY-HYGIENE_dryrun.{json,md}  (gitignored)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(__dirname, 'out');
const RB_DIR = join(ROOT, 'rollback');
const REF = 'rxlomoozakkjesdqjtvd';
const GMAIL_PREFIX = 'a7e2e012';   // faceofangel9999@gmail.com  ← 삭제 후보
const CANON_PREFIX = 'b36e74a3';   // faceofangel9999@oblivseoul.kr ← 정본 (무접점)
const GMAIL_EMAIL = 'faceofangel9999@gmail.com';
const CANON_EMAIL = 'faceofangel9999@oblivseoul.kr';
const EXPECT_REPARENT = 9;         // AC-E2 확정 blocking refset

// --- env load (.env.local) ---
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        const m = l.match(new RegExp('^' + key + '=(.*)$'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
const SERVICE_ROLE = envVal('SUPABASE_SERVICE_ROLE_KEY');
const SUPA_URL = envVal('VITE_SUPABASE_URL');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN required (.env.local)');
if (!SERVICE_ROLE || !SUPA_URL) throw new Error('SERVICE_ROLE + SUPA_URL required for id↔email 재검증');

async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
async function getUserById(id) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${id}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  const j = await r.json();
  return { status: r.status, id: j.id, email: j.email };
}

(async () => {
  const out = { ticket: 'T-20260713-foot-KJY-IDENTITY-HYGIENE', mode: 'DRY-RUN (archive-first)',
    ref: REF, at: new Date().toISOString(), abort: null, checks: {} };
  const abort = (msg) => { out.abort = msg; console.error('\n❌ ABORT:', msg); };

  // 0) prefix → full UUID
  const uu = await runSQL(
    `SELECT id, email, last_sign_in_at, (raw_app_meta_data->>'active') AS meta_active
     FROM auth.users WHERE id::text LIKE '${GMAIL_PREFIX}%' OR id::text LIKE '${CANON_PREFIX}%';`);
  const gmailRow = uu.find(r => r.id.startsWith(GMAIL_PREFIX));
  const canonRow = uu.find(r => r.id.startsWith(CANON_PREFIX));
  if (!gmailRow) { abort(`gmail-id ${GMAIL_PREFIX}* not found`); return finish(out); }
  if (!canonRow) { abort(`canon-id ${CANON_PREFIX}* not found — 정본 무접점 보장 불가`); return finish(out); }
  const GMAIL_ID = gmailRow.id, CANON_ID = canonRow.id;
  out.resolved = { gmail: gmailRow, canon: canonRow };

  // 1) id↔email 재검증 #1 (reparent 직전에 해당) — ?email= 서버필터 단독 미신뢰, getUserById 기준
  const gUser = await getUserById(GMAIL_ID);
  const cUser = await getUserById(CANON_ID);
  out.checks.id_email_verify_pre_reparent = { gmail: gUser, canon: cUser };
  const idEmailOK =
    gUser.status === 200 && gUser.id === GMAIL_ID && gUser.email === GMAIL_EMAIL &&
    cUser.status === 200 && cUser.id === CANON_ID && cUser.email === CANON_EMAIL;
  if (!idEmailOK) { abort(`id↔email 재검증 실패 — gmail:${JSON.stringify(gUser)} canon:${JSON.stringify(cUser)}`); return finish(out); }
  console.log('[1] id↔email 재검증 #1 PASS — gmail=@gmail.com / canon=@oblivseoul.kr (getUserById 기준)');

  // 2) archive-first: reparent 대상 9행 스냅샷 + freeze
  const rows = await runSQL(
    `SELECT id, created_by, created_at, action_type, role, axis, check_in_id, clinic_id
     FROM public.assignment_actions WHERE created_by = '${GMAIL_ID}' ORDER BY created_at;`);
  out.checks.reparent_snapshot = rows;
  const FREEZE_IDS = rows.map(r => r.id);
  out.freeze_ids = FREEZE_IDS;
  console.log(`[2] archive-first: assignment_actions.created_by=gmail 스냅샷 = ${rows.length}행 (freeze)`);

  // 3) rowcount=9 assert (preview)
  if (rows.length !== EXPECT_REPARENT) {
    abort(`rowcount preview ${rows.length} ≠ ${EXPECT_REPARENT} — 실행 시점 재검증 불일치. 신 사실 planner 보고 필요.`);
    return finish(out);
  }
  console.log(`[3] rowcount=${EXPECT_REPARENT} assert PASS`);

  // 4) hard-DELETE 시 CASCADE 실삭제될 2행 스냅샷 (auth.identities 1 + user_profiles 1)
  const idnt = await runSQL(
    `SELECT id, user_id, provider, provider_id, created_at FROM auth.identities WHERE user_id = '${GMAIL_ID}';`);
  const uprof = await runSQL(
    `SELECT id, role, approved, active, clinic_id, created_at FROM public.user_profiles WHERE id = '${GMAIL_ID}';`);
  out.checks.cascade_snapshot = { 'auth.identities': idnt, 'public.user_profiles': uprof };
  console.log(`[4] CASCADE 동반삭제 스냅샷: auth.identities=${idnt.length} / user_profiles=${uprof.length}`);

  // 5) active 판정소스 명시 (AC-E2 caveat): raw_app_meta_data.active=null → 정본판정은 last_sign_in 근거
  out.checks.active_source = {
    caveat: 'raw_app_meta_data.active=null (두 계정 모두) → active flag 아닌 last_sign_in 로 정본판정',
    gmail: { last_sign_in_at: gmailRow.last_sign_in_at, meta_active: gmailRow.meta_active },
    canon: { last_sign_in_at: canonRow.last_sign_in_at, meta_active: canonRow.meta_active },
    verdict: '정본=b36e74a3(@oblivseoul.kr) — 로그인 정상/실사용. 잉여=a7e2e012(@gmail) 미사용.',
  };
  console.log('[5] active 판정소스 스냅샷 완료 (meta.active=null caveat 명시, last_sign_in 근거)');

  // 6) hard-DELETE 직전 재검증에 해당 — 잔여 blocking(NO ACTION/RESTRICT) refset이 0인지 (reparent 후 예상)
  //    현시점(reparent 前) preview: assignment_actions 만 9, 나머지 a/r FK = 0 재확인
  const fks = await runSQL(
    `SELECT c.conname, n.nspname AS s, t.relname AS t, a.attname AS col, c.confdeltype
     FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
     JOIN pg_namespace n ON n.oid=t.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='auth.users'::regclass AND c.confdeltype IN ('a','r');`);
  const blocking = [];
  for (const f of fks) {
    const r = await runSQL(`SELECT count(*)::int n FROM "${f.s}"."${f.t}" WHERE "${f.col}"='${GMAIL_ID}';`);
    blocking.push({ table: `${f.s}.${f.t}`, col: f.col, count: r[0].n, conname: f.conname });
  }
  out.checks.blocking_fk_preview = blocking;
  const nonAssign = blocking.filter(b => b.count > 0 && b.conname !== 'assignment_actions_created_by_fkey');
  if (nonAssign.length > 0) {
    abort(`assignment_actions 외 추가 blocking FK 발견(${JSON.stringify(nonAssign)}) — 숨은 참조. planner 보고.`);
    return finish(out);
  }
  console.log(`[6] blocking FK preview: assignment_actions(9) 단일 전량, 그 외 a/r FK=0 재확인 PASS`);

  // 7) 롤백 SQL 생성 (reparent 되돌림) — hard-DELETE는 비가역 → point-of-no-return 이전만 유효
  const rbSQL = [
    `-- T-20260713-foot-KJY-IDENTITY-HYGIENE — reparent 롤백 (created_by canon→gmail 복원)`,
    `-- ⚠ 유효 조건: gmail 계정(a7e2e012) hard-DELETE 이전에만. 삭제 후엔 FK 위반으로 복원 불가(비가역).`,
    `-- 대상 = freeze한 ${FREEZE_IDS.length}개 assignment_actions.id 만. 정본 b36e74a3 무접점.`,
    `-- generated: ${out.at}`,
    `BEGIN;`,
    `UPDATE public.assignment_actions`,
    `   SET created_by = '${GMAIL_ID}'`,
    ` WHERE id IN (`,
    FREEZE_IDS.map(id => `   '${id}'`).join(',\n'),
    ` )`,
    `   AND created_by = '${CANON_ID}';  -- reparent로 바뀐 것만 되돌림`,
    `-- 영향 행 = ${FREEZE_IDS.length} 확인 후 COMMIT;`,
    `COMMIT;`,
  ].join('\n');

  mkdirSync(RB_DIR, { recursive: true });
  const archivePath = join(RB_DIR, 'T-20260713-foot-KJY-IDENTITY-HYGIENE_archive.json');
  const rbPath = join(RB_DIR, 'T-20260713-foot-KJY-IDENTITY-HYGIENE_reparent_rollback.sql');
  writeFileSync(archivePath, JSON.stringify({
    ticket: out.ticket, captured_at: out.at, ref: REF,
    gmail_id: GMAIL_ID, gmail_email: GMAIL_EMAIL, canon_id: CANON_ID, canon_email: CANON_EMAIL,
    freeze_ids: FREEZE_IDS,
    reparent_snapshot: rows,
    cascade_to_be_deleted: out.checks.cascade_snapshot,
    active_source: out.checks.active_source,
    id_email_verify: out.checks.id_email_verify_pre_reparent,
    blocking_fk_preview: blocking,
    note: 'hard-DELETE(gmail)는 비가역. reparent는 rollback SQL로 되돌림 가능(삭제 前 한정). CASCADE 2행(identities/user_profiles)은 삭제 시 소실 — auth 재생성 대상 아님(정본 b36e74a3 사용).',
  }, null, 2));
  writeFileSync(rbPath, rbSQL);
  console.log(`[7] archive → ${archivePath}`);
  console.log(`    rollback SQL → ${rbPath}`);

  finish(out);

  function finish(o) {
    mkdirSync(OUT_DIR, { recursive: true });
    const base = join(OUT_DIR, 'T-20260713-KJY-IDENTITY-HYGIENE_dryrun');
    writeFileSync(base + '.json', JSON.stringify(o, null, 2));
    const L = [];
    L.push(`# T-20260713-foot-KJY-IDENTITY-HYGIENE — reparent+delete DRY-RUN (archive-first)`);
    L.push(`${o.at} · prod ${REF} · mode=${o.mode}`);
    L.push(`\n**ABORT:** ${o.abort || '없음 (모든 preflight PASS)'}`);
    if (o.resolved) {
      L.push(`\n## 대상`);
      L.push(`- 삭제후보 gmail: \`${o.resolved.gmail.id}\` ${o.resolved.gmail.email} (last_sign_in=${o.resolved.gmail.last_sign_in_at})`);
      L.push(`- 정본 canon: \`${o.resolved.canon.id}\` ${o.resolved.canon.email} (last_sign_in=${o.resolved.canon.last_sign_in_at}) ← 무접점`);
    }
    if (o.freeze_ids) {
      L.push(`\n## freeze set (reparent 대상 assignment_actions.id = ${o.freeze_ids.length})`);
      o.freeze_ids.forEach((id, i) => L.push(`${i + 1}. ${id}`));
    }
    if (o.checks.cascade_snapshot) {
      L.push(`\n## hard-DELETE 시 CASCADE 동반삭제 (정본 무접점 확인분)`);
      L.push(`- auth.identities = ${o.checks.cascade_snapshot['auth.identities'].length}`);
      L.push(`- public.user_profiles = ${o.checks.cascade_snapshot['public.user_profiles'].length}`);
    }
    if (o.checks.blocking_fk_preview) {
      L.push(`\n## blocking FK (NO ACTION/RESTRICT) preview`);
      for (const b of o.checks.blocking_fk_preview) L.push(`- ${b.table}.${b.col} = ${b.count} (${b.conname})`);
    }
    L.push(`\n## 게이트`);
    L.push(`- ① 총괄 재confirm: ✅ (김주연 총괄, ②안, ts 1783951184.678499)`);
    L.push(`- ② supervisor DB-GATE: **대기** — 통과 후 _apply.mjs APPLY=true 실행 (destructive).`);
    writeFileSync(base + '.md', L.join('\n'));
    console.log(`\n[evidence] ${base}.json / .md (gitignored)`);
    console.log(o.abort ? `\n=== DRY-RUN ABORT ===` : `\n=== DRY-RUN 전 preflight PASS — supervisor DB-GATE 대기 ===`);
    if (o.abort) process.exit(3);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
