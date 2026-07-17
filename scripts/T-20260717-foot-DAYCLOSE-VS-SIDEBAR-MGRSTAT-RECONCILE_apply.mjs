/**
 * T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE — foot prod forward-apply
 *
 * supervisor DDL-diff = GO(ADDITIVE 확정). 20260717160000_foot_stats_consultant_pkg_attr_reconstruct.sql
 * 을 foot prod(rxlomoozakkjesdqjtvd)에 forward-apply.
 *   절차: (1) PRE prosrc+md5 캡처(기대 393f1785…) → (2) applyMigration(DDL+원장 idempotent)
 *         → (3) POST prosrc+md5 캡처(변경 확인) → (4) foot_stats_consultant 스모크(임의 clinic·기간 1회 무오류).
 *   applyMigration 단일경로 = DDL 적용 + schema_migrations 원장 기록(Track3 표준).
 *
 * 사용:  node scripts/..._apply.mjs           # dry-run (PRE 캡처만, write 0)
 *        node scripts/..._apply.mjs --apply   # PROD forward-apply (supervisor GO 후)
 *
 * author: dev-foot / 2026-07-17
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';
import crypto from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260717160000';
const FILE = '20260717160000_foot_stats_consultant_pkg_attr_reconstruct.sql';

const PROSRC_SQL = `
  SELECT p.oid::regprocedure::text AS sig,
         pg_get_function_result(p.oid) AS result,
         md5(p.prosrc) AS src_md5,
         length(p.prosrc) AS src_len
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_consultant';`;

function nowKst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
}

async function prosrc(label) {
  const rows = await query(PROSRC_SQL);
  const arr = Array.isArray(rows) ? rows : [];
  console.log(`\n[${label}] pg_proc foot_stats_consultant (${arr.length}건):`);
  for (const r of arr) {
    console.log(`  sig=${r.sig}`);
    console.log(`  result=${r.result}`);
    console.log(`  prosrc md5=${r.src_md5}  len=${r.src_len}`);
  }
  return arr;
}

try {
  console.log(`── T-20260717 RECONCILE forward-apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) @ ${nowKst()} ──`);

  const before = await prosrc('PRE');
  const ledgerBefore = await ledgerVersions();
  console.log(`\n[PRE] 원장 ${ledgerBefore.size}행 · ${VERSION} 등재=${ledgerBefore.has(VERSION)}`);

  if (!APPLY) {
    console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음. PRE 캡처만 완료.');
    process.exit(0);
  }

  console.log('\n── applyMigration (DDL 적용 + 원장 idempotent 기록) ──');
  const r = await applyMigration({
    version: VERSION, file: FILE, dryRun: false,
    createdBy: 'T-20260717-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE',
  });
  const appliedAt = nowKst();
  console.log(`  ✓ 적용+원장기록: ${r.name} @ ${appliedAt}`);

  const after = await prosrc('POST');
  const ledgerAfter = await ledgerVersions();
  console.log(`\n[POST] 원장 ${ledgerAfter.size}행 · ${VERSION} 등재=${ledgerAfter.has(VERSION)}`);

  const preMd5 = before[0]?.src_md5, postMd5 = after[0]?.src_md5;
  console.log(`\n[md5] PRE=${preMd5} → POST=${postMd5}  변경=${preMd5 !== postMd5 ? 'YES ✓' : 'NO ✗'}`);

  // ── 스모크: 임의 clinic · 기간 1회 호출 무오류 ──
  console.log('\n── SMOKE: foot_stats_consultant(임의 clinic, 당월) ──');
  const clinics = await query(`SELECT id, name FROM clinics ORDER BY created_at LIMIT 1;`);
  const clinic = (Array.isArray(clinics) ? clinics : [])[0];
  if (!clinic) throw new Error('clinics 없음 — 스모크 불가');
  const smokeSql = `
    SELECT consultant_id, name, ticketing_count, package_count, avg_amount, total_amount
    FROM foot_stats_consultant('${clinic.id}'::uuid,
                               date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date,
                               (now() AT TIME ZONE 'Asia/Seoul')::date)
    ORDER BY total_amount DESC NULLS LAST;`;
  const smoke = await query(smokeSql);
  const srows = Array.isArray(smoke) ? smoke : [];
  console.log(`  clinic=${clinic.name} (${clinic.id})  행수=${srows.length}  → 무오류 ✓`);
  for (const s of srows.slice(0, 8)) {
    console.log(`    ${s.name}: tk=${s.ticketing_count} pkg=${s.package_count} avg=${s.avg_amount} total=${s.total_amount}`);
  }

  console.log(`\n✅ 완료. applied_at=${appliedAt}  md5 ${preMd5}→${postMd5}  smoke rows=${srows.length}`);
  process.exit(0);
} catch (e) {
  console.error(`\n✗ 실패: ${e.message}`);
  process.exit(1);
}
