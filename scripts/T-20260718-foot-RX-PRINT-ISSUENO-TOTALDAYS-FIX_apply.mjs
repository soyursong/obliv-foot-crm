/**
 * T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX — AC1-PERSIST 마이그 PROD apply + 증거기반 probe
 * FIX-REQUEST MSG-20260718-163456-bju8 (supervisor).
 *
 * ── 배경 (RC) ──
 *   commit 870fa443/a0748bee 는 코드 merge 완료(CF Pages 라이브)이나 db_change:true 마이그
 *   (20260718170000_foot_rx_issue_no_daily_counter.sql, ADDITIVE)는 git merge 만으로 PROD DB 미적용.
 *   ticket mig_dryrun_postprobe: absent → PROD 실재 미확인 상태에서 status:deployed 마킹됨(false-mark hazard).
 *   supervisor auto-promote 는 db_change 를 자동 deployed 마킹하지 않음(AUTOPROMOTE-DBCHANGE-GATE 가드).
 *
 * ── 조치 ──
 *   (1) PRE-PROBE: 대상 3객체 실존 + 원장 version 실측 (증거기반).
 *   (2) APPLY: applyMigration 헬퍼(적용=원장기록 단일경로) 경유 — ADDITIVE, IF NOT EXISTS 로 재적용 안전.
 *   (3) POST-PROBE: 3객체 실재 + 발번·멱등 스모크(임의 clinic/date 2회 → 1,2 증가) 재확인.
 *
 * 대상 객체:
 *   · public.foot_rx_issue_counter (table, per-(clinic_id,issue_date) 카운터)
 *   · public.form_submissions.rx_issue_seq (column, INT nullable)
 *   · public.issue_foot_rx_issue_no(uuid, date, uuid) (RPC, SECURITY DEFINER)
 *
 * usage: node scripts/T-20260718-...apply.mjs          (PRE-PROBE + DRY 계획)
 *        node scripts/T-20260718-...apply.mjs --apply  (PRE-PROBE + 실적용 + POST-PROBE)
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(PRE-PROBE only)';
const VERSION = '20260718170000';
const FILE = '20260718170000_foot_rx_issue_no_daily_counter.sql';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

async function probe(label) {
  console.log(`\n── [PROBE:${label}] 대상 객체 실재 (ref rxlomoozakkjesdqjtvd) ──`);
  const tbl = await scalar("SELECT to_regclass('public.foot_rx_issue_counter')::text AS v;");
  const col = await scalar(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='form_submissions' AND column_name='rx_issue_seq';"
  );
  const fn = await scalar(
    "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='issue_foot_rx_issue_no';"
  );
  const rls = await scalar(
    "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.foot_rx_issue_counter');"
  );
  const led = await ledgerVersions();
  console.log(`  foot_rx_issue_counter (table)          = ${tbl ?? 'ABSENT'}`);
  console.log(`  form_submissions.rx_issue_seq (column) = ${col ?? 'ABSENT'}`);
  console.log(`  issue_foot_rx_issue_no (RPC)           = ${fn ?? 'ABSENT'}`);
  console.log(`  foot_rx_issue_counter RLS enabled      = ${rls ?? 'n/a'}`);
  console.log(`  ledger version ${VERSION}             = ${led.has(VERSION) ? 'PRESENT' : 'ABSENT'}`);
  return { tbl: !!tbl, col: !!col, fn: !!fn, rls, ledger: led.has(VERSION) };
}

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] RX-ISSUENO 마이그 PROD apply — ${VERSION} (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════');

const pre = await probe('PRE');

if (!APPLY) {
  console.log('\n── [DRY] 적용 계획 ──');
  console.log(`  version ${VERSION}  file ${FILE}`);
  console.log(`  현재 실재: table=${pre.tbl} column=${pre.col} rpc=${pre.fn} ledger=${pre.ledger}`);
  const need = !pre.tbl || !pre.col || !pre.fn || !pre.ledger;
  console.log(need ? '\n  ⚠ 미적용 요소 존재 → --apply 필요.' : '\n  ✅ 이미 전량 적용됨.');
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── APPLY (ADDITIVE, IF NOT EXISTS 로 재적용 안전) ──
console.log('\n── [APPLY] applyMigration 경유 (적용=원장기록 단일경로) ──');
const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260718-RX-ISSUENO-FIX-REQUEST-bju8' });
console.log(`  ✅ applied ${r.version} (${r.name})`);

// ── POST-PROBE ──
const post = await probe('POST');
const allPresent = post.tbl && post.col && post.fn && post.ledger;
if (!allPresent) {
  console.error('\n⛔ POST-PROBE FAIL — 3객체/원장 중 미실재 존재. supervisor 보고.');
  process.exit(3);
}

// ── 발번·멱등 스모크 (임의 clinic/date, counter 는 (clinic,date) 파티션이라 실 데이터 무오염) ──
console.log('\n── [SMOKE] 발번·멱등 검증 ──');
const smokeClinic = '00000000-0000-0000-0000-0000000000ff'; // 존재하지 않는 sentinel clinic (실 데이터 무접촉)
const smokeDate = '1900-01-01'; // sentinel 과거일 = 실 발번 파티션과 불충돌
try {
  const s1 = await scalar(`SELECT public.issue_foot_rx_issue_no('${smokeClinic}'::uuid, '${smokeDate}'::date);`);
  const s2 = await scalar(`SELECT public.issue_foot_rx_issue_no('${smokeClinic}'::uuid, '${smokeDate}'::date);`);
  console.log(`  발번 1회차 = ${s1}, 2회차 = ${s2} (기대: 증가 = 원자 발번 OK)`);
  // sentinel 행 정리 (무영속)
  await query(`DELETE FROM public.foot_rx_issue_counter WHERE clinic_id='${smokeClinic}'::uuid AND issue_date='${smokeDate}'::date;`);
  console.log('  sentinel counter 행 정리 완료(무영속).');
  if (!(Number(s2) > Number(s1))) {
    console.error('\n⛔ SMOKE FAIL — 순번 미증가. supervisor 보고.');
    process.exit(4);
  }
} catch (e) {
  console.error(`\n⛔ SMOKE FAIL — RPC 호출 예외: ${e.message}`);
  process.exit(4);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`✅ PROD apply + post-probe + smoke ALL PASS (${nowKst()})`);
console.log('  → 티켓 mig_dryrun_postprobe: present, deployed_at 마킹 가능.');
console.log('════════════════════════════════════════════════════════════\n');
