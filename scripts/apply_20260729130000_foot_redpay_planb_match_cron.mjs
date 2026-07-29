/**
 * APPLY — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (만료/매칭 cron · build 코어)
 *   20260729130000_foot_redpay_planb_match_cron.sql
 *   CREATE OR REPLACE FUNCTION trigger_redpay_planb_match() + cron.schedule('foot-redpay-planb-match','* * * * *').
 *
 * supervisor DDL-diff GO(MSG-20260729-094524-wz52, verdict=GO) 위임 apply 절차:
 *   (a) PRE-probe(clean create 확증 · C19 bootstrap):
 *         · prod pg_proc trigger_redpay_planb_match ABSENT
 *         · cron.job foot-redpay-planb-match ABSENT
 *       둘 다 absent 여야 순수 CREATE(재정의 아님). 존재 시 OOB stomp 의심 → ABORT.
 *   (b) dryrun 무영속 재실행(exit0, canonical dryrun_lib post-probe assertAbsent 2종)
 *       → post-dryrun 재확인(무영속: 함수/cron 여전히 absent)
 *       → 원자 apply(단일 txn, up.sql 내장 BEGIN/COMMIT) → ledger(20260729130000).
 *   (c) POST-probe:
 *         · 함수 생성(pg_proc trigger_redpay_planb_match PRESENT) + C19 baseline md5(prosrc) 기록
 *         · cron 등록(cron.job foot-redpay-planb-match · schedule='* * * * *' · active=true)
 *         · ledger 20260729130000 PRESENT
 *   (step5 수동 1틱 EF 200 = 별도 POSTCHECK 스크립트/supervisor 사후검증에서 실행)
 *
 * ADDITIVE(신규 함수1+cron job1, 테이블/스키마/enum/RLS/트리거 무접촉) · 멱등(CREATE OR REPLACE + unschedule-guard→schedule).
 * ★선행: redpay-planb-match EF 선배포(net.http_post 404 소음 방지) — checklist step0. (본 apply 전 완료됨.)
 * 실행: node scripts/apply_20260729130000_foot_redpay_planb_match_cron.mjs [--apply]
 *   (--apply 미지정 = PRE-probe + dryrun 까지만, prod DDL/원장 write 없음)
 * author: dev-foot / 2026-07-29
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');
const APPLY = process.argv.includes('--apply');

const VERSION = '20260729130000';
const FILE = '20260729130000_foot_redpay_planb_match_cron.sql';
const DRYRUN_MJS = join(REPO_ROOT, 'supabase/migrations/20260729130000_foot_redpay_planb_match_cron.dryrun.mjs');

const FUNC_SQL = `SELECT p.proname,
  md5(pg_get_functiondef(p.oid)) AS body_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='trigger_redpay_planb_match';`;
const CRON_SQL = `SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-redpay-planb-match';`;

const rows = (r) => (Array.isArray(r) ? r : (r == null ? [] : [r]));

async function probeFunc() { return rows(await query(FUNC_SQL)); }
async function probeCron() { return rows(await query(CRON_SQL)); }

console.log(`── REDPAY-PLANB match/expire cron apply (${APPLY ? 'APPLY' : 'PRE+DRYRUN only'}) — ${VERSION} ──`);

// ── (a) PRE-probe: 순수 CREATE 확증 (함수·cron 모두 ABSENT) ──
const preFunc = await probeFunc();
const preCron = await probeCron();
console.log(`\n[PRE] pg_proc trigger_redpay_planb_match = ${preFunc.length ? 'PRESENT' : 'ABSENT'}`);
console.log(`[PRE] cron.job  foot-redpay-planb-match   = ${preCron.length ? 'PRESENT' : 'ABSENT'}`);
if (preFunc.length || preCron.length) {
  console.error(`\n✗ ABORT: PRE 지문 위반 — clean create 기대(둘 다 ABSENT), 실측 func=${preFunc.length}건 cron=${preCron.length}건.`);
  console.error(`  OOB stomp/재적용 의심 → apply 중단, supervisor 에스컬레이션 필요(C19 bootstrap N/A 아님).`);
  process.exit(2);
}
console.log(`[PRE] ✓ 순수 CREATE 확증 (함수·cron 모두 부재) — C19 bootstrap(신규 RPC, OOB stomp 대상無).`);

// ── (b1) dryrun 무영속 재실행 (exit0) ──
console.log(`\n[DRYRUN] node ${DRYRUN_MJS}`);
const dr = spawnSync('node', [DRYRUN_MJS], { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
if (dr.status !== 0) {
  console.error(`\n✗ ABORT: dryrun exit=${dr.status} (≠0) — 무영속 검증 실패. apply 중단.`);
  process.exit(3);
}
console.log(`[DRYRUN] ✓ exit0 — 무영속 PASS.`);

// dryrun 후 여전히 absent (무영속 재확인)
const afterFunc = await probeFunc();
const afterCron = await probeCron();
if (afterFunc.length || afterCron.length) {
  console.error(`\n✗ ABORT: dryrun 후 영속 오염 — func=${afterFunc.length} cron=${afterCron.length} (무영속 위반). apply 중단.`);
  process.exit(4);
}
console.log(`[DRYRUN] ✓ post-dryrun 여전히 absent (무영속 실측 확인).`);

if (!APPLY) {
  console.log(`\n[dry-run mode] --apply 미지정 → prod DDL/원장 write 없음. 종료(exit0).`);
  process.exit(0);
}

// ── (b2) 원자 apply (단일 txn) + ledger 기록 (applyMigration 단일경로) ──
console.log(`\n[APPLY] applyMigration ${FILE} (단일 txn + ledger ${VERSION})`);
const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: false,
  createdBy: 'T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD-match-cron',
});
console.log(`[APPLY] ✓ applied=${res.applied} name=${res.name}`);

// ── (c) POST-probe: 함수 생성 + cron active + ledger 등재 ──
const postFunc = await probeFunc();
const postCron = await probeCron();
const led = await ledgerVersions();
const ledgerHas = led.has(VERSION);

const funcOk = postFunc.length === 1 && postFunc[0].proname === 'trigger_redpay_planb_match';
const baselineMd5 = funcOk ? postFunc[0].body_md5 : null;
const cronRow = postCron[0] || {};
const cronOk = postCron.length === 1 && cronRow.schedule === '* * * * *' && cronRow.active === true;

console.log(`\n[POST] pg_proc trigger_redpay_planb_match = ${funcOk ? 'PRESENT' : 'MISSING/DUP'}  (C19 baseline md5=${baselineMd5 ?? 'n/a'})`);
console.log(`[POST] cron.job foot-redpay-planb-match   = schedule='${cronRow.schedule ?? '-'}' active=${cronRow.active ?? '-'}`);
console.log(`[POST] ledger ${VERSION} = ${ledgerHas ? 'PRESENT' : 'ABSENT'}`);

const ok = funcOk && cronOk && ledgerHas;
console.log(`\nPOSTCHECK(apply) RESULT: ${ok ? 'PASS' : 'FAIL'}`);
if (!ok) {
  console.error(`  기대: 함수1 PRESENT + cron schedule='* * * * *' active=true + ledger ${VERSION} PRESENT.`);
  process.exit(5);
}
console.log(`✓ DONE — 함수 생성 + cron 1분주기 active + 원장 등재. (step5 수동 1틱 EF 200 = 별도 실행)`);
console.log(`\n── EVIDENCE ──`);
console.log(JSON.stringify({
  version: VERSION,
  pre_func_absent: true,
  pre_cron_absent: true,
  dryrun_exit0: true,
  post_func_present: funcOk,
  c19_baseline_body_md5: baselineMd5,
  post_cron_schedule: cronRow.schedule,
  post_cron_active: cronRow.active,
  ledger_recorded: ledgerHas,
}, null, 2));
process.exit(0);
