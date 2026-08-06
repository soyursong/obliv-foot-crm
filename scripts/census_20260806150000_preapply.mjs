/**
 * census_20260806150000_preapply.mjs
 * T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT — §13.1.C pre-apply OOB drift census (HARD·fail-closed)
 *
 * GO-token precondition #1: apply 직전 prod md5(pg_get_functiondef(oid)) 4함수 실측 → 티켓 baseline 대조.
 *   ANY 불일치 = OOB stomp 지문 → ABORT(적용 금지) · Ledger Reconciliation 선행.
 * 티켓 주석은 md5(prosrc) 로 표기 → 방식 모호성 해소 위해 md5_def / md5_src 둘 다 실측해 baseline 매칭 방식 확정.
 * author: dev-foot / 2026-08-06
 */
import { query } from './lib/foot_migration_ledger.mjs';

const BASELINE = {
  enqueue_closing_confirmed: 'ed372fc2d3e382218617ee31a5108dc2',
  closing_source_split:      '8c4218ecef182d7986ce101fcc8fbfbe',
  closing_insurance_split:   '2e75908ecadf160099b639ab94777663',
  closing_month_projection:  '841d9519128710d2d38329e5222faece',
};

const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };

const res = await rows(`
  SELECT p.proname AS name,
         pg_get_function_identity_arguments(p.oid) AS args,
         md5(pg_get_functiondef(p.oid)) AS md5_def,
         md5(p.prosrc)                  AS md5_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('enqueue_closing_confirmed','closing_source_split','closing_insurance_split','closing_month_projection')
   ORDER BY p.proname;`);

console.log('════════════════════════════════════════════════════════════');
console.log('§13.1.C PRE-APPLY OOB DRIFT CENSUS — obliv-foot-crm prod (rxlomoozakkjesdqjtvd)');
console.log('════════════════════════════════════════════════════════════\n');

let anyMissing = false;
const report = [];
for (const name of Object.keys(BASELINE)) {
  const row = res.find((r) => r.name === name);
  if (!row) {
    anyMissing = true;
    report.push({ name, present: false, baseline: BASELINE[name] });
    console.log(`  ${name}: ❌ prod 미발견 (함수 부재 — 예상 밖)`);
    continue;
  }
  const matchDef = row.md5_def === BASELINE[name];
  const matchSrc = row.md5_src === BASELINE[name];
  report.push({
    name, args: row.args, baseline: BASELINE[name],
    md5_def: row.md5_def, md5_src: row.md5_src,
    match_def: matchDef, match_src: matchSrc,
    matches: matchDef || matchSrc,
  });
  const verdict = matchDef ? 'MATCH(functiondef)' : matchSrc ? 'MATCH(prosrc)' : 'DIVERGENCE';
  console.log(`  ${name}(${row.args})`);
  console.log(`     baseline = ${BASELINE[name]}`);
  console.log(`     md5_def  = ${row.md5_def}  ${matchDef ? '✅' : ''}`);
  console.log(`     md5_src  = ${row.md5_src}  ${matchSrc ? '✅' : ''}`);
  console.log(`     → ${verdict}\n`);
}

const allMatch = !anyMissing && report.every((r) => r.matches);
const matchedVia = report.every((r) => r.match_def) ? 'functiondef'
  : report.every((r) => r.match_src) ? 'prosrc'
  : 'mixed/divergent';

console.log('── CENSUS RESULT ──');
console.log(JSON.stringify({ all_match: allMatch, matched_via: matchedVia, report }, null, 2));
console.log('');
if (allMatch) {
  console.log(`✅ CENSUS PASS — 4함수 전건 baseline 일치 (via ${matchedVia}). OOB stomp 지문 없음 → APPLY 진행 가능.`);
  process.exit(0);
} else {
  console.log('❌ CENSUS FAIL — baseline 불일치(OOB stomp 지문) → ABORT. 적용 금지 · Ledger Reconciliation 선행.');
  process.exit(1);
}
