/**
 * T-20260819-foot-INFLOW-KAKAO-INBOUND-ADD — '카톡' visit_route CHECK PROD apply
 *
 * DA CONSULT-REPLY GO (MSG-20260819-115858-45sj): 순수 ADDITIVE·§36 firewall NEUTRAL·foot-only·label=(a)'카톡' flat.
 * ★apply-gate = supervisor DB-GATE + 물리 GO-token(db_apply_guard.sh lane) 선행. GO-token 前 --apply 금지(apply_before_go).
 * `supabase db push` 는 원장 divergence 로 거부 가능 → Management API /database/query 직접 exec 우회(gonghom 선례 동형).
 * 마이그가 순수 ADDITIVE·멱등(DROP CONSTRAINT IF EXISTS + ADD, 8값=기존7+'카톡')이라 direct apply 안전.
 *
 * 사용:
 *   node scripts/T-...KAKAO..._apply.mjs            # dry-run (PRE 상태·원장 확인만, 기본)
 *   node scripts/T-...KAKAO..._apply.mjs --apply    # PROD apply + 원장기록 + post-check (supervisor GO-token 후)
 *
 * author: dev-foot / 2026-08-19
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260819210000';
const FILE = '20260819210000_foot_visit_route_kakao_add.sql';
const EXPECTED8 = ['TM', '워크인', '인바운드', '지인소개', '네이버', '인콜', '공홈', '카톡'];

async function dumpChecks(label) {
  const defs = await query(`
    SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname IN ('customers_visit_route_check','reservations_visit_route_check')
    ORDER BY conname;`);
  console.log(`\n== ${label} CHECK defs ==`);
  for (const r of defs) console.log(`${r.tbl}.${r.conname}\n  ${r.def}`);
  return defs;
}

function verify8(defs) {
  const report = {};
  for (const r of defs) {
    const has = EXPECTED8.every((v) => r.def.includes(`'${v}'`));
    // no compound contamination ('인바운드(카톡)' must be absent — flat '카톡' only)
    const noCompound = !r.def.includes('인바운드(카톡)');
    report[r.conname] = { has8: has, noCompound };
  }
  return report;
}

console.log(`── KAKAO CHECK apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);

const preDefs = await dumpChecks('PRE');
const ledBefore = await ledgerVersions();
console.log('\n원장 20260819210000 사전 존재?', ledBefore.has(VERSION), '| 원장행수:', ledBefore.size, '| max:', [...ledBefore].sort().pop());

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음. 위 PRE 상태만 확인.');
  console.log('[dry-run] 무영속 DDL 검증(No-Persistence) = supervisor DB-GATE exec: node scripts/dryrun_lib.mjs supabase/migrations/' + FILE);
  process.exit(0);
}

// PROD apply (supervisor GO-token 후): DDL (BEGIN..COMMIT + self-verify DO block 내장) + 원장 idempotent 기록
const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260819-INFLOW-KAKAO-INBOUND-ADD' });
console.log(`\n✓ 적용+원장기록: ${r.name}`);

// POST-CHECK (별 트랜잭션 = Management API 재조회)
const postDefs = await dumpChecks('POST');
const report = verify8(postDefs);
console.log('\n== POST 8값 검증 ==');
console.log(JSON.stringify(report, null, 2));

const ledAfter = await ledgerVersions();
console.log('\n원장 20260819210000 사후 존재?', ledAfter.has(VERSION), '| 원장행수:', ledAfter.size);

const allOk = Object.values(report).every((v) => v.has8 && v.noCompound)
  && ledAfter.has(VERSION)
  && postDefs.length === 2;
console.log(`\nPOSTCHECK RESULT: ${allOk ? 'PASS — customers=8값 reservations=8값, ledger 기록 OK' : 'FAIL'}`);
process.exit(allOk ? 0 : 1);
