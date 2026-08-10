/**
 * apply_20260810120001_foot_selfcheckin_status_widen.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN  (P0, db_only)
 * 게이트: supervisor DB-GATE GO-token v2 (ed25519). slot 20260810120001.
 *   ⚠ apply_before_go 절대 금지 — GO-token(.json+.sig) A∧C 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260810120001_foot_selfcheckin_status_widen.sql
 *   semantic-equiv ADDITIVE: fn_selfcheckin_reservation_banner / fn_selfcheckin_today_reservations
 *   두 함수 WHERE status = 'confirmed' → status IN ('confirmed','reserved','checked_in') (read-set widen).
 *   clinic_id + date scope / SECDEF / owner / search_path / ACL / masking 전부 불변. 데이터 mutation 0.
 *
 * apply 절차(FIX-REQUEST MSG-20260810-130302-jsyf 준수):
 *   1) apply 직전 prod prosrc md5 재대조 — banner=321fb3cc.. / today=0a632516.. 불변 확인.
 *      불일치 = OOB drift → apply abort + supervisor 재통지 (C19-2).
 *   2) GO-token A∧C 게이트(assertApplyGateForRunner). 부재/불일치/만료 → abort.
 *   3) prod COMMIT (ledger 경유 apply → schema_migrations 20260810120001 단건 기재).
 *   4) POSTCHECK: ①has_widen=true×2 ②SECDEF/search_path/owner/anon+authenticated EXECUTE 불변
 *      ③cross-clinic 누수 0 ④ledger 20260810120001 단건 ⑤신 prosrc md5 실측 기록.
 *
 * 실행:
 *   node scripts/apply_20260810120001_foot_selfcheckin_status_widen.mjs          # PRE-PROBE only(비 apply)
 *   node scripts/apply_20260810120001_foot_selfcheckin_status_widen.mjs --apply  # md5 재대조 → gate → apply → POSTCHECK
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260810120001';
const FILE = '20260810120001_foot_selfcheckin_status_widen.sql';
const TICKET_ID = 'T-20260810-foot-SELFCHECKIN-RPC-STATUS-WIDEN';
const REF = FOOT_PROD_REF;
const __dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);

// ── C19-2: apply 직전 재대조 baseline md5 (GO-token precheck 실측 pin). 불일치 = OOB drift ──
const BASELINE_MD5 = {
  fn_selfcheckin_reservation_banner: '321fb3cc1c15209ab0b153d7bd903fac',
  fn_selfcheckin_today_reservations: '0a632516a0671f820bd391fba3f029a5',
};

const FN_INTROSPECT = `
  SELECT p.proname,
         count(*) OVER (PARTITION BY p.proname) AS overloads,
         md5(p.prosrc) AS prosrc_md5,
         (p.prosrc ~ 'checked_in') AS has_widen,
         p.prosecdef, p.proconfig::text AS proconfig,
         array_to_json(p.proconfig) AS proconfig_json, r.rolname AS owner,
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
   WHERE n.nspname='public'
     AND p.proname IN ('fn_selfcheckin_reservation_banner','fn_selfcheckin_today_reservations')
   ORDER BY p.proname;`;

async function introspectFns() {
  const rows = await query(FN_INTROSPECT);
  const arr = Array.isArray(rows) ? rows : [];
  const by = Object.fromEntries(arr.map((r) => [r.proname, r]));
  return { arr, by };
}

async function crossClinicProbe(label) {
  console.log(`\n══════════ ${label} (cross-clinic 누수 = 0 기대) ══════════`);
  // 각 clinic × (데이터 있는 최신 날짜) 표본으로 today RPC 호출 → 반환 reservation.id 가
  //   전부 그 clinic 소속인지 대조. leak>0 = scope 붕괴. returned>0 = 표본이 실데이터로 유의미.
  const sql = `
    WITH clinics AS (SELECT DISTINCT clinic_id FROM public.reservations WHERE clinic_id IS NOT NULL),
    samples AS (
      SELECT c.clinic_id,
             (SELECT max(r.reservation_date) FROM public.reservations r WHERE r.clinic_id=c.clinic_id) AS d
        FROM clinics c
    )
    SELECT s.clinic_id, s.d,
      (SELECT count(*) FROM public.fn_selfcheckin_today_reservations(s.clinic_id, s.d) f
         JOIN public.reservations r ON r.id=f.id WHERE r.clinic_id <> s.clinic_id) AS leak,
      (SELECT count(*) FROM public.fn_selfcheckin_today_reservations(s.clinic_id, s.d)) AS returned
    FROM samples s
    ORDER BY returned DESC NULLS LAST;`;
  const rows = await query(sql);
  const arr = Array.isArray(rows) ? rows : [];
  console.log(JSON.stringify(arr, null, 1));
  const totalLeak = arr.reduce((a, r) => a + Number(r.leak || 0), 0);
  console.log(`  cross-clinic leak 합계 = ${totalLeak} (기대 0), 표본 clinic 수 = ${arr.length}`);
  return { arr, totalLeak };
}

function printFns(arr, phase) {
  console.log(`\n══════════ ${phase} — 함수 introspection ══════════`);
  console.log(JSON.stringify(arr, null, 1));
}

(async () => {
  // ── PRE-PROBE + C19-2 baseline md5 재대조 ──
  const pre = await introspectFns();
  printFns(pre.arr, 'PRE-PROBE (apply 전 현재 상태)');

  if (pre.arr.length !== 2) {
    console.error(`\n[ABORT] 함수 2개 기대, 실측 ${pre.arr.length}개. supervisor 재통지.`);
    process.exit(2);
  }
  let driftFail = 0;
  for (const [fn, expMd5] of Object.entries(BASELINE_MD5)) {
    const actual = pre.by[fn]?.prosrc_md5;
    const ok = actual === expMd5;
    console.log(`  [${ok ? 'PASS' : 'DRIFT'}] ${fn}: prosrc md5 ${actual} ${ok ? '==' : '≠'} baseline ${expMd5}`);
    if (!ok) driftFail++;
    // apply 미선행 baseline = has_widen false 여야 정상
    if (pre.by[fn]?.has_widen !== false) {
      console.log(`  [WARN] ${fn}: has_widen=${pre.by[fn]?.has_widen} (baseline 기대 false)`);
    }
  }
  if (driftFail > 0) {
    console.error(`\n[ABORT · C19-2] OOB drift 감지 — prod prosrc md5 ≠ GO-token precheck baseline.`);
    console.error(`  apply 중단. supervisor 재통지 필요(토큰 무효화 + 재발행).`);
    process.exit(3);
  }
  console.log('\n[C19-2] apply 직전 prod prosrc md5 재대조 = 불변 확인 (OOB drift 없음).');

  if (!APPLY) {
    console.log('\n(PRE-PROBE only) --apply 미지정 → prod 무변경.');
    return;
  }

  // ── DB-GATE: GO-token A∧C 게이트 (prod lane 필수) ──
  const migrationSql = readFileSync(SQL_FILE, 'utf8');
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID, targetRef: REF, applyRequested: true,
    migrationSql, migrationSqlFile: SQL_FILE, evidenceLog: EVIDENCE_LOG,
  });
  console.log('\n[DB-GATE] GO-token 검증 통과:', JSON.stringify(gate.gate || gate));

  // ── prod COMMIT (ledger 경유 apply → schema_migrations 단건 기재) ──
  console.log('\n[APPLY] prod COMMIT 시작…');
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:' + TICKET_ID });
  console.log('[APPLY] 완료:', JSON.stringify(r));

  // ── POSTCHECK ①②⑤: 함수 introspection ──
  const post = await introspectFns();
  printFns(post.arr, 'POSTCHECK (apply 후)');
  let fail = 0;
  const chk = (c, l, d) => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${l}${d ? ' — ' + d : ''}`); if (!c) fail++; };
  chk(post.arr.length === 2, 'single-overload ×2', `rows=${post.arr.length}`);
  for (const fn of ['fn_selfcheckin_reservation_banner', 'fn_selfcheckin_today_reservations']) {
    const f = post.by[fn];
    chk(f?.has_widen === true, `① ${fn}: has_widen=true`);
    chk(Number(f?.overloads) === 1, `${fn}: overload=1`);
    chk(f?.prosecdef === true, `② ${fn}: SECURITY DEFINER 불변`);
    chk(f?.owner === 'postgres', `② ${fn}: owner=postgres 불변`);
    chk(f?.anon_exec === true && f?.authed_exec === true, `② ${fn}: anon+authenticated EXECUTE 불변`);
  }
  // proconfig::text 는 배열 이스케이프(\") 때문에 리터럴 정규식이 취약 → array_to_json 로 원소값 대조(견고).
  const spEl = (f) => ((f?.proconfig_json || []).find((x) => x.startsWith('search_path=')) || '');
  chk(spEl(post.by.fn_selfcheckin_reservation_banner) === 'search_path=public, pg_temp',
    '② banner: search_path=public,pg_temp 불변', spEl(post.by.fn_selfcheckin_reservation_banner));
  chk(spEl(post.by.fn_selfcheckin_today_reservations) === 'search_path=""',
    '② today: search_path="" 불변', spEl(post.by.fn_selfcheckin_today_reservations));
  console.log('\n[⑤] apply 후 신 prosrc md5:');
  console.log(`  banner = ${post.by.fn_selfcheckin_reservation_banner?.prosrc_md5}`);
  console.log(`  today  = ${post.by.fn_selfcheckin_today_reservations?.prosrc_md5}`);

  // ── POSTCHECK ③: cross-clinic 누수 0 (behavioral) ──
  const cc = await crossClinicProbe('POSTCHECK ③');
  chk(cc.totalLeak === 0, '③ cross-clinic 누수 = 0');

  // ── POSTCHECK ④: ledger 20260810120001 단건 기재 ──
  const led = await query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260810120000','20260810120001') ORDER BY version;`);
  const ledArr = Array.isArray(led) ? led : [];
  console.log('\n[④] ledger:', JSON.stringify(ledArr));
  const has1 = ledArr.filter((x) => x.version === '20260810120001').length;
  chk(has1 === 1, '④ ledger 20260810120001 단건 기재', `count=${has1}`);
  chk(!ledArr.some((x) => x.version === '20260810120000'), '④ 구 slot 20260810120000 미기재(정합)');

  console.log(fail === 0 ? '\n════ POSTCHECK: ALL PASS ════' : `\n════ POSTCHECK: ${fail} FAIL ════`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('\n[FATAL]', e.message); process.exit(9); });
