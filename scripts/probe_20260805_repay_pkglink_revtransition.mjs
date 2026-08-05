/**
 * probe_20260805_repay_pkglink_revtransition.mjs — READ-ONLY prod introspection
 * 티켓: T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX
 * FIX-REQUEST MSG-20260805-171137-t0l4 (supervisor) — 증거기반 prod probe.
 * DDL/DML 0. SELECT only via Management API /database/query.
 */
import { query } from './lib/foot_migration_ledger.mjs';

const P = (label, ok, detail) =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);

let allPass = true;
const rec = (ok) => { if (!ok) allPass = false; };

// H5 — ledger 3 rows
const ledger = await query(
  `SELECT version FROM supabase_migrations.schema_migrations
   WHERE version IN ('20260805171000','20260805171100','20260805171200') ORDER BY version;`);
const lv = ledger.map((r) => r.version);
{ const ok = ['20260805171000','20260805171100','20260805171200'].every((v) => lv.includes(v));
  rec(ok); P('H5 ledger 3row', ok, lv.join(',')); }

// H1 — procs exist
const procs = await query(
  `SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE p.proname IN ('foot_recompute_package_status','foot_trg_recompute_package_status') ORDER BY 1;`);
{ const names = procs.map((r) => r.proname);
  const ok = ['foot_recompute_package_status','foot_trg_recompute_package_status'].every((n) => names.includes(n));
  rec(ok); P('H1 procs(2) exist', ok, procs.map((r)=>`${r.proname}(secdef=${r.prosecdef})`).join(', ')); }

// H1b — triggers exist + enabled
const trigs = await query(
  `SELECT t.tgname, c.relname AS tbl, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE t.tgname IN ('trg_payments_pkg_status_recompute','trg_pkgpay_pkg_status_recompute') ORDER BY 1;`);
{ const ok = trigs.length===2 && trigs.every((r)=>r.tgenabled==='O');
  rec(ok); P('H1b triggers(2) enabled', ok, trigs.map((r)=>`${r.tgname}@${r.tbl}(${r.tgenabled})`).join(', ')); }

// H3 — refund RPC DELEGATE marker + no unidirectional status write
const refund = await query(
  `SELECT prosrc FROM pg_proc WHERE proname='refund_package_payment' LIMIT 1;`);
{ const src = refund[0]?.prosrc || '';
  const hasMarker = src.includes('REVTRANSITION-FWDFIX-DELEGATE');
  const noUni = !/UPDATE\s+packages\s+SET\s+status/i.test(src);
  const ok = hasMarker && noUni;
  rec(ok); P('H3 refund DELEGATE marker + no unidir status', ok,
    `marker=${hasMarker}, unidir_absent=${noUni}`); }

// H4 — record_planb PKGLINK marker + package_id in payments INSERT
const planb = await query(
  `SELECT prosrc FROM pg_proc WHERE proname='record_planb_card_payment' LIMIT 1;`);
{ const src = planb[0]?.prosrc || '';
  const hasMarker = src.includes('REVTRANSITION-FWDFIX-PKGLINK');
  const hasPkgId = /package_id/i.test(src);
  const ok = hasMarker && hasPkgId;
  rec(ok); P('H4 record_planb PKGLINK marker + package_id', ok,
    `marker=${hasMarker}, package_id=${hasPkgId}`); }

// H2 — grant-seal on core recompute (backend-only)
const grants = await query(
  `SELECT has_function_privilege('anon','public.foot_recompute_package_status(uuid)','EXECUTE') AS anon,
          has_function_privilege('authenticated','public.foot_recompute_package_status(uuid)','EXECUTE') AS authenticated,
          has_function_privilege('service_role','public.foot_recompute_package_status(uuid)','EXECUTE') AS service_role;`);
{ const g = grants[0] || {};
  const ok = g.anon===false && g.authenticated===false && g.service_role===true;
  rec(ok); P('H2 grant-seal (anon/auth=false, service=true)', ok,
    `anon=${g.anon}, authenticated=${g.authenticated}, service_role=${g.service_role}`); }

console.log(`\n${allPass ? '✅ ALL PASS' : '❌ FAIL'} — prod migration 실재 ${allPass ? '확인' : '미확인'}`);
process.exit(allPass ? 0 : 1);
