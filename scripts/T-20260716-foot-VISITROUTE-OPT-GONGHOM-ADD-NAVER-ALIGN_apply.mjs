/**
 * T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN — '공홈' CHECK PROD apply
 *
 * planner NEW-TASK/DB-APPLY (MSG-20260718-055959-u8v3): supervisor QA=코드 PASS + DDL-diff GO.
 * `supabase db push` 는 원장 6버전 divergence 로 거부 → Management API /database/query 직접 exec 우회.
 * 마이그가 순수 ADDITIVE·멱등(DROP CONSTRAINT IF EXISTS + ADD, 7값=기존6+'공홈')이라 direct apply 안전.
 *
 * applyMigration() 단일경로 = DDL 적용 + 원장(schema_migrations) idempotent INSERT (item1+item3).
 *
 * 사용:
 *   node scripts/T-...GONGHOM..._apply.mjs            # dry-run (pre-check만, 기본)
 *   node scripts/T-...GONGHOM..._apply.mjs --apply    # PROD apply + 원장기록 + post-check
 *
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260716160000';
const FILE = '20260716160000_foot_visit_route_gonghom_add.sql';
const EXPECTED7 = ['TM', '워크인', '인바운드', '지인소개', '네이버', '인콜', '공홈'];

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

function verify7(defs) {
  const report = {};
  for (const r of defs) {
    const has = EXPECTED7.every((v) => r.def.includes(`'${v}'`));
    // no extra spurious value ('네이버야' must be absent)
    const noNaveryaContam = !r.def.includes('네이버야');
    report[r.conname] = { has7: has, noNaverya: noNaveryaContam };
  }
  return report;
}

console.log(`── GONGHOM CHECK apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);

const preDefs = await dumpChecks('PRE');
const ledBefore = await ledgerVersions();
console.log('\n원장 20260716160000 사전 존재?', ledBefore.has(VERSION), '| 원장행수:', ledBefore.size, '| max:', [...ledBefore].sort().pop());

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음. 위 PRE 상태만 확인.');
  process.exit(0);
}

// PROD apply: DDL (BEGIN..COMMIT + self-verify DO block 내장) + 원장 idempotent 기록
const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260716-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN' });
console.log(`\n✓ 적용+원장기록: ${r.name}`);

// POST-CHECK (별 트랜잭션 = Management API 재조회)
const postDefs = await dumpChecks('POST');
const report = verify7(postDefs);
console.log('\n== POST 7값 검증 ==');
console.log(JSON.stringify(report, null, 2));

const ledAfter = await ledgerVersions();
console.log('\n원장 20260716160000 사후 존재?', ledAfter.has(VERSION), '| 원장행수:', ledAfter.size);

const allOk = Object.values(report).every((v) => v.has7 && v.noNaverya)
  && ledAfter.has(VERSION)
  && postDefs.length === 2;
console.log(`\nPOSTCHECK RESULT: ${allOk ? 'PASS — customers=7값 reservations=7값, ledger 기록 OK' : 'FAIL'}`);
process.exit(allOk ? 0 : 1);
