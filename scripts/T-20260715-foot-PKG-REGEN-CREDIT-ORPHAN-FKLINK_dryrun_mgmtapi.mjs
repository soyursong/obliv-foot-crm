/**
 * T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK — 구조 lane DRY-RUN (No-Persistence)
 *   (Management API 경로 — 원격 pooler DB_PASSWORD 부재 환경용 동등 실행체)
 *
 * 목적: prod 실제 스키마에 구조 마이그레이션(전부 ADDITIVE)을 무영속으로 적용 확증.
 *   Migration Dry-Run No-Persistence Protocol 준수:
 *     (0) baseline   : 4개 신규 객체(payments.package_id / packages.superseded_by /
 *                      package_credit_ledger / package_amendments) prod 부재 확인.
 *     (1) canary     : BEGIN; COMMENT ON TABLE payments='__CANARY__'; ROLLBACK; →
 *                      이 엔드포인트가 ROLLBACK 을 실제로 되돌리는지 무해 가역변경으로 선증명.
 *                      잔존 시 즉시 ABORT(실 DDL 미실행) — sentinel-bypass(autocommit) hazard 차단.
 *     (2) apply      : dryrun.sql(= up.sql txn-control strip + BEGIN..ROLLBACK + in-txn assertion) 실행.
 *                      assertion(DO $chk$: 4객체+헬퍼 실생성) 실패 시 RAISE→HTTP error→ABORT.
 *     (3) post-probe : 4객체가 prod 에 여전히 부재해야(무영속) 정상.
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const CANARY = '__DRYRUN_CANARY_T20260715_FKLINK__';
const DRYRUN_SQL = 'supabase/migrations/20260715190000_foot_pkg_regen_credit_ledger_fklink.dryrun.sql';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

// 4개 신규 객체 prod 실재 여부(무영속 확증용)
const probe = async () => {
  const rows = await q(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments'  AND column_name='package_id')    AS payments_pkgid,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages'  AND column_name='superseded_by') AS packages_supby,
    (to_regclass('public.package_credit_ledger') IS NOT NULL) AS ledger_tbl,
    (to_regclass('public.package_amendments') IS NOT NULL)    AS amend_tbl`);
  return rows[0];
};

const stamp = new Date().toISOString();
const L = [];
const log = (s = '') => { L.push(s); console.log(s); };

log('═══════════════════════════════════════════════════════════');
log('T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK — DRY-RUN (No-Persistence) 실행 결과');
log(`실행시각 : ${stamp}`);
log(`DB 환경  : foot prod / project_ref=${REF} (https://${REF}.supabase.co)`);
log('실행방식 : Supabase Management API /database/query (SUPABASE_ACCESS_TOKEN, pooler DB_PW 불요)');
log(`대조원천 : ${DRYRUN_SQL}`);
log('프로토콜 : Migration Dry-Run No-Persistence Protocol (txn-strip + canary + in-txn assert + post-probe)');
log('═══════════════════════════════════════════════════════════');

let ok = true;
try {
  log(`✅ Management API 연결(${REF}) — DRY-RUN, 무영속\n`);

  // (0) baseline — 4객체 prod 부재 확인(구조 lane 미적용 상태)
  const base = await probe();
  log('── (0) baseline (prod 실재):');
  log(`     payments.package_id=${base.payments_pkgid}  packages.superseded_by=${base.packages_supby}  ledger=${base.ledger_tbl}  amendments=${base.amend_tbl}`);
  log(`     기대: 전부 false(미적용). ${(!base.payments_pkgid && !base.packages_supby && !base.ledger_tbl && !base.amend_tbl) ? '✅ 일치' : '⚠ 일부 이미 존재(확인 요)'}`);

  // (1) canary — ROLLBACK 실효 선증명
  await q(`BEGIN;\nCOMMENT ON TABLE public.payments IS '${CANARY}';\nROLLBACK;`);
  const afterCanary = await q(`SELECT obj_description('public.payments'::regclass) AS c`);
  const persisted = (afterCanary[0]?.c || '') === CANARY;
  log(`── (1) canary: ROLLBACK 후 카나리 잔존? ${persisted ? '❌ 잔존(엔드포인트 autocommit — ABORT)' : '✅ 미잔존(ROLLBACK 실효 확인)'}`);
  if (persisted) throw new Error('CANARY_PERSISTED — ROLLBACK 무영속 보장 실패. 실 DDL 미실행하고 중단.');

  // (2) apply — dryrun.sql(BEGIN..ROLLBACK + in-txn assertion) 무영속 실행
  //     주석/트레일링 post-probe 코멘트 포함해도 무해. assertion 실패 시 HTTP error → catch.
  const dryrunBody = fs.readFileSync(DRYRUN_SQL, 'utf8');
  await q(dryrunBody);
  log('── (2) apply: dryrun.sql 무영속 실행 OK — DDL 4객체+헬퍼 생성 + in-txn assertion(DO $chk$) 통과(RAISE EXCEPTION 미발생) → ROLLBACK');

} catch (e) {
  ok = false;
  log(`❌ DRY-RUN 실패: ${e.message}`);
} finally {
  // (3) post-probe — 무영속 확증: 4객체가 여전히 prod 부재
  const post = await probe();
  const clean = !post.payments_pkgid && !post.packages_supby && !post.ledger_tbl && !post.amend_tbl;
  log('── (3) post-probe (무영속 확증, prod 실재):');
  log(`     payments.package_id=${post.payments_pkgid}  packages.superseded_by=${post.packages_supby}  ledger=${post.ledger_tbl}  amendments=${post.amend_tbl}`);
  log(`     기대: 전부 false(무영속). ${clean ? '✅ 무영속 확증(적용 전과 동일)' : '❌ 영속 잔존 — 즉시 조사'}`);
  log('');
  log('═══════════════════════════════════════════════════════════');
  log(`판정 : ${ok && clean ? '✅ DRY-RUN PASS (무영속·전 ADDITIVE·assertion 통과) — supervisor DDL-diff 게이트 진입 가능' : '❌ FAIL'}`);
  log('═══════════════════════════════════════════════════════════');
  const out = 'supabase/ops/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK_dryrun_' + stamp.slice(0, 10).replace(/-/g, '') + '_RESULT.log';
  fs.writeFileSync(out, L.join('\n') + '\n');
  console.log(`\n📝 RESULT 로그 기록: ${out}`);
  process.exit(ok && clean ? 0 : 1);
}
