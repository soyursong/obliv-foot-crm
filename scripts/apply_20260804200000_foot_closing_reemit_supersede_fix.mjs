/**
 * apply_20260804200000_foot_closing_reemit_supersede_fix.mjs
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE (FIX MSG-20260804-195718-bxx1)
 *   결함: reemit_self_supersede_reader_invisible — supersede 방향 완전 역전
 *
 * ── supervisor DB-GATE PRE-APPROVAL GO (MSG-20260804-204840-smet) ──
 *   DB 적용 = dev 책임 / supervisor = 사전승인 + 사후검증.
 *   dev-foot 가 dryrun(No-Persistence)→apply → bus.jsonl 통지(신 md5). supervisor 가 postcheck.
 *   대상 pinned commit = 0709b311 (working tree 파일 md5 = 2837511798414d2b14553346932339ec 로 일치 검증됨).
 *
 * ── 단일경로 apply = 원장 기록 ──
 *   applyMigration() 경유 = up.sql(BEGIN..COMMIT 단일배치) 적용 + schema_migrations 원장 idempotent INSERT.
 *   `supabase db push` 금지 — 본 파일 단건만 Management API /database/query 로 선택 apply.
 *   up.sql 내장 §Y grant-seal DO 는 apply 중 anon-EXEC=0 assert self-verify(실패 시 RAISE → txn rollback).
 *
 * ── DRY(default): No-Persistence dryrun.sql 실행 ──
 *   .dryrun.sql 은 단일 DO 블록. 말미 RAISE EXCEPTION sentinel 로 강제 unwind → 무영속.
 *     'DRY-RUN OK — no-persistence sentinel unwind' 예외 = 全검증 PASS 후 정상 unwind
 *     'DRY-RUN FAIL — ...'                            = 검증 실패(상세 포함)
 *   + POST-PROBE(별도 read-only): 실 함수에 FIX 마커 부재 재확인 = 무영속 실증.
 *
 * usage: node scripts/apply_20260804200000_foot_closing_reemit_supersede_fix.mjs           (DRY: dryrun + probe)
 *        node scripts/apply_20260804200000_foot_closing_reemit_supersede_fix.mjs --apply   (dryrun gate → 실적용 → self-postcheck)
 * author: dev-foot / 2026-08-04
 */
import { readFileSync } from 'node:fs';
import { query, applyMigration, ledgerVersions, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(No-Persistence dryrun + probe)';
const VERSION = '20260804200000';
const FILE = '20260804200000_foot_closing_reemit_supersede_fix.sql';
const DRYFILE = '20260804200000_foot_closing_reemit_supersede_fix.dryrun.sql';
const PINNED_COMMIT = '0709b311';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

const enqueueMd5 = () => scalar(
  `SELECT substr(md5(pg_get_functiondef(p.oid)),1,8) AS h
     FROM pg_proc p WHERE p.proname='enqueue_closing_confirmed' AND p.pronamespace='public'::regnamespace;`);
const hasFixMarker = async () => (await scalar(
  `SELECT (pg_get_functiondef(p.oid) LIKE '%revision < NEW.revision%')::int AS n
     FROM pg_proc p WHERE p.proname='enqueue_closing_confirmed' AND p.pronamespace='public'::regnamespace;`)) >= 1;
const priv = (role) => scalar(
  `SELECT has_function_privilege('${role}','public.enqueue_closing_confirmed()','EXECUTE') AS x;`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] CLOSING reemit supersede fix ${VERSION} — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log(`  pinned commit=${PINNED_COMMIT}`);
console.log('════════════════════════════════════════════════════════════\n');

// ── BEFORE 실측 ──
const ledgerBefore = await ledgerVersions();
const md5Before = await enqueueMd5();
const fixBefore = await hasFixMarker();
console.log('── BEFORE (prod 실측) ──');
console.log(`  ledger has ${VERSION}?      : ${ledgerBefore.has(VERSION)}`);
console.log(`  enqueue md5(8)             : ${md5Before}`);
console.log(`  has FIX marker (신규 supersede 정상화)? : ${fixBefore}`);
console.log('');

// ── DRY-RUN (No-Persistence sentinel) — DRY·APPLY 공통 게이트 ──
console.log('── DRY-RUN (No-Persistence sentinel) ──');
const drySql = readFileSync(join(MIG_DIR, DRYFILE), 'utf8');
let dryPass = false;
try {
  await query(drySql);
  // sentinel 이 반드시 RAISE 하므로 여기 도달 = 비정상(sentinel 미작동)
  console.log('  ❌ dryrun 이 예외 없이 종료 — sentinel 미작동(무영속 미보장). 중단.');
  process.exit(1);
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes('DRY-RUN OK') && msg.includes('no-persistence sentinel')) {
    dryPass = true;
    console.log('  ✅ DRY-RUN OK — 全검증 PASS 후 no-persistence sentinel unwind (무영속)');
  } else if (msg.includes('DRY-RUN FAIL')) {
    console.log('  ❌ DRY-RUN FAIL:');
    console.log('     ' + msg.replace(/\\n/g, '\n     '));
    process.exit(1);
  } else {
    console.log('  ❌ dryrun 예기치 못한 오류(sentinel 아님):');
    console.log('     ' + msg);
    process.exit(1);
  }
}

// ── POST-PROBE (무영속 재확인, 별도 read-only) ──
const fixAfterDry = await hasFixMarker();
const md5AfterDry = await enqueueMd5();
console.log(`  POST-PROBE: 실 함수 FIX 마커=${fixAfterDry} md5=${md5AfterDry} (BEFORE=${fixBefore}/${md5Before})`);
if (fixAfterDry !== fixBefore || md5AfterDry !== md5Before) {
  console.log('  ❌ 무영속 위반 — dryrun 이 실 함수를 변경했다. 중단.');
  process.exit(1);
}
console.log('  ✅ 무영속 실증 — dryrun 이 prod 함수를 영속 변경하지 않음\n');

if (!APPLY) {
  console.log('DRY 종료(dryrun PASS + 무영속 실증). 실적용: node scripts/apply_20260804200000_foot_closing_reemit_supersede_fix.mjs --apply');
  process.exit(0);
}

// ── APPLY (단일경로: up.sql BEGIN..COMMIT + 원장 기록) ──
console.log('── APPLY (Management API 선택 apply, db push 미사용) ──');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-CLOSING-HERALD-REEMIT-SUPERSEDE' });
const appliedAt = nowKst();
console.log(`  applyMigration => ${JSON.stringify(res)}`);
console.log(`  applied_at = ${appliedAt}\n`);

// ── SELF-POSTCHECK (dev 측 최소 사전확인 — 정식 사후검증은 supervisor) ──
console.log('── SELF-POSTCHECK (dev 측 sanity — 정식 사후검증=supervisor) ──');
const md5After = await enqueueMd5();
const fixAfter = await hasFixMarker();
const anon = await priv('anon');
const auth = await priv('authenticated');
const svc = await priv('service_role');
const ledgerAfter = await ledgerVersions();

const g_md5   = md5After !== md5Before;                 // 정의 교체됨
const g_fix   = fixAfter === true;                      // FIX 마커 실재
const g_acl   = anon === false && auth === false && svc === true;
const g_ledg  = ledgerAfter.has(VERSION);

console.log(`  (1) 정의 교체(md5 변경)     : ${g_md5 ? '✅' : '❌'}  ${md5Before} → ${md5After}`);
console.log(`  (2) FIX 마커 실재           : ${g_fix ? '✅' : '❌'}`);
console.log(`  (3) ACL 봉인(anon/auth=F·svc=T): ${g_acl ? '✅' : '❌'}  anon=${anon} auth=${auth} svc=${svc}`);
console.log(`  (4) ledger 등재(${VERSION}) : ${g_ledg ? '✅' : '❌'}`);
console.log('');

const allPass = g_md5 && g_fix && g_acl && g_ledg;
console.log('── EVIDENCE (supervisor 사후검증용) ──');
console.log(JSON.stringify({
  ticket: 'T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE',
  version: VERSION,
  pinned_commit: PINNED_COMMIT,
  applied_at: appliedAt,
  enqueue_md5_before: md5Before,
  enqueue_md5_after: md5After,
  fix_marker_after: fixAfter,
  acl: { anon, authenticated: auth, service_role: svc },
  ledger_recorded: g_ledg,
  self_postcheck: allPass ? 'PASS' : 'FAIL',
}, null, 2));
console.log('');
console.log(allPass ? `✅ ALL PASS — prod APPLY 성공 (applied_at=${appliedAt}, 신 md5=${md5After})`
                    : '❌ 일부 실패 — supervisor 회신 전 확인 필요');
process.exit(allPass ? 0 : 1);
