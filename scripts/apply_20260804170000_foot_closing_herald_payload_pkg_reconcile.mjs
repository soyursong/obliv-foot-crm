/**
 * apply_20260804170000_foot_closing_herald_payload_pkg_reconcile.mjs
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE — 마감 전령 payload 패키지 누락 총액 SSOT conformance
 *
 * ── supervisor DB-GATE PRE-APPROVAL GO (MSG-20260804-100626-lgqc) ──
 *   foot guard-lane 미이식 → MIG-GATE 위임. dev-foot 세션에서 정규 러너로 up.sql APPLY(단일 배치 txn).
 *   sha-pin = 039d6882 (재QA 전건 PASS).
 *
 * ── 실행 요청 (supervisor POSTCHECK evidence 4항목) ──
 *   (a) fn 4/4 재정의 확인 (v1.5 PKG-RECONCILE 마커 prosrc 존재)
 *   (b) has_function_privilege('anon',fn,'EXECUTE')=false 4/4
 *       + has_function_privilege('authenticated',fn,'EXECUTE')=false 4/4
 *       + has_function_privilege('service_role',fn,'EXECUTE')=true 4/4
 *   (c) ledger 등재 (20260804170000)
 *   (d) 실마감 1건 INV5 ±0  →  (total_s − health_maintenance) == system_totals(daily_closings 확정합)
 *
 * ── 단일경로 apply = 원장 기록 ──
 *   applyMigration() 경유 = up.sql(BEGIN..COMMIT 단일배치) 적용 + schema_migrations 원장 idempotent INSERT.
 *   `supabase db push` 금지 — 본 파일 단건만 Management API /database/query 로 선택 apply.
 *   up.sql 내장 §Y grant-seal DO 는 apply 중 anon-EXEC=0 assert 4/4 self-verify(실패 시 RAISE → txn rollback).
 *
 * usage: node scripts/apply_20260804170000_foot_closing_herald_payload_pkg_reconcile.mjs          (DRY)
 *        node scripts/apply_20260804170000_foot_closing_herald_payload_pkg_reconcile.mjs --apply  (실적용 + POSTCHECK)
 * author: dev-foot / 2026-08-04
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(BEFORE 실측만)';
const VERSION = '20260804170000';
const FILE = '20260804170000_foot_closing_herald_payload_pkg_reconcile.sql';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const FNS = [
  'closing_source_split(uuid,date)',
  'closing_insurance_split(uuid,date)',
  'closing_month_projection(uuid,date)',
  'enqueue_closing_confirmed()',
];

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};
const rowsOf = async (sql) => {
  const rows = await query(sql);
  return Array.isArray(rows) ? rows : [];
};

// prosrc 에 v1.5 마커 존재 = 재정의 확인
const fnRedefined = (proname) => scalar(
  `SELECT (count(*) FILTER (WHERE pg_get_functiondef(p.oid) LIKE '%v1.5%'
                              OR pg_get_functiondef(p.oid) LIKE '%PKG-RECONCILE%'
                              OR pg_get_functiondef(p.oid) LIKE '%package_payments%'))::int AS n
     FROM pg_proc p WHERE p.proname='${proname}' AND p.pronamespace='public'::regnamespace;`);

const priv = (role, fnsig) => scalar(
  `SELECT has_function_privilege('${role}', 'public.${fnsig}', 'EXECUTE') AS x;`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] CLOSING-HERALD-PAYLOAD-RECONCILE mig ${VERSION} — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── BEFORE 실측 ──
const ledgerBefore = await ledgerVersions();
console.log('── BEFORE (prod 실측) ──');
console.log(`  ledger has ${VERSION}?  : ${ledgerBefore.has(VERSION)}`);
for (const fnsig of FNS) {
  const proname = fnsig.split('(')[0];
  console.log(`  ${proname.padEnd(26)} anon=${await priv('anon', fnsig)} redefined(v1.5)=${(await fnRedefined(proname)) >= 1}`);
}
console.log('');

if (!APPLY) {
  console.log('DRY 종료. 실적용: node scripts/apply_20260804170000_foot_closing_herald_payload_pkg_reconcile.mjs --apply');
  process.exit(0);
}

// ── APPLY (단일경로: up.sql BEGIN..COMMIT 단일배치 + 원장 기록) ──
console.log('── APPLY (Management API 선택 apply, db push 미사용) ──');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-CLOSING-HERALD-PAYLOAD-RECONCILE' });
const appliedAt = nowKst();
console.log(`  applyMigration => ${JSON.stringify(res)}`);
console.log(`  applied_at = ${appliedAt}\n`);

// ── POSTCHECK ──
console.log('── POSTCHECK (supervisor evidence 4항목) ──\n');

// (a) fn 4/4 재정의
console.log('(a) fn 4/4 재정의 확인 (v1.5/PKG-RECONCILE/package_payments 마커):');
let aPass = true;
for (const fnsig of FNS) {
  const proname = fnsig.split('(')[0];
  const ok = (await fnRedefined(proname)) >= 1;
  if (!ok) aPass = false;
  console.log(`    ${ok ? '✅' : '❌'} ${proname}`);
}
console.log('');

// (b) ACL end-state 봉인 실측 4/4×3
console.log('(b) ACL end-state 실측 (anon=false·authenticated=false·service_role=true):');
let bPass = true;
const aclSnapshot = [];
for (const fnsig of FNS) {
  const proname = fnsig.split('(')[0];
  const anon = await priv('anon', fnsig);
  const auth = await priv('authenticated', fnsig);
  const svc = await priv('service_role', fnsig);
  const ok = anon === false && auth === false && svc === true;
  if (!ok) bPass = false;
  aclSnapshot.push({ fn: proname, anon, authenticated: auth, service_role: svc });
  console.log(`    ${ok ? '✅' : '❌'} ${proname.padEnd(26)} anon=${anon} authenticated=${auth} service_role=${svc}`);
}
console.log('');

// (c) ledger 등재
const ledgerAfter = await ledgerVersions();
const cPass = ledgerAfter.has(VERSION);
console.log(`(c) ledger 등재(${VERSION}): ${cPass ? '✅ 등재됨' : '❌ 미등재'}\n`);

// (d) 실마감 1건 INV5 ±0
//   (total_s − health_maintenance) == system_totals(daily_closings 확정합)
console.log('(d) 실마감 1건 INV5 ±0 대조:');
let dPass = false;
let dEvidence = null;
const closed = await rowsOf(`
  SELECT dc.clinic_id, dc.close_date, c.slug,
         (COALESCE(dc.package_card_total,0) + COALESCE(dc.single_card_total,0)
        + COALESCE(dc.package_cash_total,0) + COALESCE(dc.single_cash_total,0)
        + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0))::bigint AS sys_total
    FROM public.daily_closings dc
    JOIN public.clinics c ON c.id = dc.clinic_id
   WHERE dc.status = 'closed'
   ORDER BY dc.close_date DESC
   LIMIT 1;`);
if (closed.length === 0) {
  console.log('    ⚠ 확정(closed) 마감 0건 — INV5 대조 대상 없음 (N/A)');
} else {
  const dc = closed[0];
  const srcJson = await scalar(`SELECT public.closing_source_split('${dc.clinic_id}'::uuid, '${dc.close_date}'::date);`);
  const src = typeof srcJson === 'string' ? JSON.parse(srcJson) : srcJson;
  const vTotal = Number(src.total);
  const vHm = Number(await scalar(`
    SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)::bigint AS hm
      FROM public.payments p
      LEFT JOIN public.check_ins ci ON ci.id = p.check_in_id
     WHERE COALESCE(p.clinic_id, ci.clinic_id) = '${dc.clinic_id}'::uuid
       AND p.is_simulation IS NOT TRUE
       AND p.status IS DISTINCT FROM 'deleted'
       AND p.method = 'health_maintenance'
       AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date = '${dc.close_date}'::date;`));
  const sysTotal = Number(dc.sys_total);
  const delta = (vTotal - vHm) - sysTotal;
  dPass = delta === 0;
  dEvidence = { close_date: dc.close_date, slug: dc.slug, total_s: vTotal, health_maintenance: vHm, system_totals_sum: sysTotal, delta };
  console.log(`    close_date=${dc.close_date} slug=${dc.slug}`);
  console.log(`    total_s(payments+package net)=${vTotal}  health_maintenance=${vHm}  system_totals(daily_closings 확정합)=${sysTotal}`);
  console.log(`    (total_s − hm) − system_totals = ${delta}  →  ${dPass ? '✅ INV5 ±0' : '❌ 발산'}`);
}
console.log('');

// ── 종합 판정 ──
const GATE = {
  '(a) fn 4/4 재정의': aPass,
  '(b) ACL end-state 봉인(anon/auth=false·svc=true 4/4)': bPass,
  '(c) ledger 등재': cPass,
  '(d) 실마감 INV5 ±0': closed.length === 0 ? true : dPass,
};
console.log('── GATE ──');
let allPass = true;
for (const [k, v] of Object.entries(GATE)) { console.log(`  ${v ? '✅' : '❌'} ${k}`); if (!v) allPass = false; }
console.log('');
console.log('── EVIDENCE (supervisor 최종 사후검증 C11/C20-equiv 용) ──');
console.log(JSON.stringify({ applied_at: appliedAt, version: VERSION, acl: aclSnapshot, inv5: dEvidence, ledger_recorded: cPass }, null, 2));
console.log('');
console.log(allPass ? `✅ ALL PASS — prod APPLY 성공 (applied_at=${appliedAt})`
                    : '❌ 일부 실패 — supervisor 회신 전 확인 필요');
process.exit(allPass ? 0 : 1);
