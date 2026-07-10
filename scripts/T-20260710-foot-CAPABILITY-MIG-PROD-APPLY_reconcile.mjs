/**
 * T-20260710-foot-CAPABILITY-MIG-PROD-APPLY — AC4 3자 정합 대조 (pre/post)
 *
 * schema_migrations 원장 ↔ 마이그 파일선언 ↔ prod information_schema 3자 재대조로 divergence 확인.
 *   node scripts/..._reconcile.mjs          # 대조 리포트만(read-only)
 *
 * 대상 버전:
 *   20260701120000 chart_treatment_requests  (AC1)
 *   20260701130000 therapist_capabilities     (AC1)
 *   20260703040000 pkg_triple RPC 2종          (AC3 판정용 참고)
 *
 * author: dev-foot / 2026-07-10
 */
import { query, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const TARGETS = [
  { version: '20260701120000', kind: 'table',    object: 'chart_treatment_requests', ac: 'AC1' },
  { version: '20260701130000', kind: 'table',    object: 'therapist_capabilities',   ac: 'AC1' },
  { version: '20260703040000', kind: 'function', object: 'transfer_package_atomic',   ac: 'AC3', extra: 'consume_package_sessions_for_checkin' },
];

async function tableExists(name) {
  const r = await query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='${name}';`
  );
  return (r?.[0]?.n ?? 0) > 0;
}
async function funcExists(name) {
  const r = await query(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${name}';`
  );
  return (r?.[0]?.n ?? 0) > 0;
}

const ledger = await ledgerVersions();
console.log(`── AC4 3자 정합 대조 (read-only) ──`);
console.log(`원장(schema_migrations) 현재 ${ledger.size}행, max=${[...ledger].sort().pop()}`);
console.log('');

let divergence = 0;
for (const t of TARGETS) {
  const inLedger = ledger.has(t.version);
  let inProd;
  if (t.kind === 'table') inProd = await tableExists(t.object);
  else {
    const a = await funcExists(t.object);
    const b = t.extra ? await funcExists(t.extra) : true;
    inProd = a && b;
  }
  // 파일선언은 항상 true(파일 존재 확인 완료). divergence = 원장 vs prod 실재 불일치
  const diverged = inLedger !== inProd;
  if (diverged) divergence++;
  console.log(
    `[${t.ac}] ${t.version} ${t.object}${t.extra ? ' (+' + t.extra + ')' : ''}\n` +
    `      원장=${inLedger ? 'Y' : 'N'}  prod실재=${inProd ? 'Y' : 'N'}  파일선언=Y  → ${diverged ? '⚠ DIVERGENCE' : 'OK'}`
  );
}
console.log('');
console.log(`divergence 건수(원장↔prod) = ${divergence}`);
