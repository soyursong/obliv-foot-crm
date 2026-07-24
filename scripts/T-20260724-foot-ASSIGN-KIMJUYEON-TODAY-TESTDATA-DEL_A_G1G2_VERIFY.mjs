/**
 * T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL — (A) 박민석 F-4790 branch
 * DA CONSULT-REPLY = CLEAR (dski / DA-...-CHECKINSERVICES-REVENUE-UNIVERSE.md)
 * G1 · G2 READ-ONLY fail-closed 확증. WRITE 0. hard-DELETE HOLD.
 *
 * G1: 27 cis / 4 check_ins 참조·인접 package 의 package_payments(선수금 원장) 행 = 0.
 *     (B) orphan package 01ddef31 류가 (A)에 부재 재확인.
 * G2: payments/service_charges/package_sessions/package_payments = 0 을
 *     person-level 아닌 freeze된 exact 4 check_in_id · 27 cis_id 기준 재확인.
 *     F-4790(오늘 배포 골든 visit) 겹침 여부. 27 cis→4 freeze check_in bind(손자 FK 0).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FREEZE = JSON.parse(fs.readFileSync(
  new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_FREEZE_A_EXTENDED.json', import.meta.url)));

const CHECK_INS = FREEZE.parent_check_ins;              // 4
const CIS_IDS   = FREEZE.freeze_ids.check_in_services;  // 27
const ORPHAN_PKG_B = '01ddef31'; // (B) branch orphan package prefix

const out = { ticket: FREEZE.ticket, branch: 'A_parkminseok_F-4790', mode: 'READ-ONLY (WRITE 0)', G1: {}, G2: {} };
const log = (...a) => console.log(...a);

async function count(table, col, ids) {
  const { data, error } = await supabase.from(table).select(`id, ${col}`).in(col, ids);
  if (error) return { table, error: error.message, n: null };
  return { table, n: (data ?? []).length, rows: data ?? [] };
}

log('════════════════ (A) 박민석 F-4790 — G1/G2 READ-ONLY 확증 ════════════════\n');
log(`freeze: check_ins=${CHECK_INS.length}  cis=${CIS_IDS.length}`);
log(`check_ins: ${CHECK_INS.join(', ')}\n`);

// ── 0) 27 cis 가 실제로 4 freeze check_in 에만 bind (손자 FK 0) ──
log('── [G2-c] 27 cis → 4 freeze check_in bind 재확인 ──');
{
  const { data, error } = await supabase.from('check_in_services')
    .select('id, check_in_id, price, original_price, is_package_session, package_session_id, seller_staff_id')
    .in('id', CIS_IDS);
  if (error) { log('  ⚠ error', error.message); }
  const rows = data ?? [];
  const distinctCI = [...new Set(rows.map(r => r.check_in_id))];
  const strayCI = distinctCI.filter(ci => !CHECK_INS.includes(ci));
  const pkgFlagTrue = rows.filter(r => r.is_package_session === true);
  const pkgSessionIdNonNull = rows.filter(r => r.package_session_id != null);
  const sellerNonNull = rows.filter(r => r.seller_staff_id != null);
  const priceSum = rows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const origSum  = rows.reduce((s, r) => s + (Number(r.original_price) || 0), 0);
  out.G2.cis_found = rows.length;
  out.G2.cis_bind_distinct_check_ins = distinctCI;
  out.G2.cis_stray_check_ins = strayCI;                 // must be []
  out.G2.cis_is_package_session_true = pkgFlagTrue.length;
  out.G2.cis_package_session_id_nonnull = pkgSessionIdNonNull.length; // must be 0 (inert)
  out.G2.cis_seller_staff_id_nonnull = sellerNonNull.length;
  out.G2.cis_price_sum = priceSum;
  out.G2.cis_original_price_sum = origSum;
  log(`  cis found: ${rows.length}/27`);
  log(`  bind distinct check_ins: ${distinctCI.length} → ${distinctCI.join(', ')}`);
  log(`  stray (freeze 밖) check_in: ${strayCI.length} ${strayCI.length ? '★★ '+strayCI.join(',') : '(0 = 손자 FK clean)'}`);
  log(`  is_package_session=TRUE: ${pkgFlagTrue.length}  | package_session_id NOT NULL: ${pkgSessionIdNonNull.length} (inert면 0)`);
  log(`  price 합=${priceSum}  original_price 합=${origSum}\n`);
}

// ── G2) freeze exact-id 원장 4종 = 0 (check_in_id 기준) ──
log('── [G2] freeze exact 4 check_in_id 기준 원장 4종 count ──');
const ledgerTables = ['payments', 'service_charges', 'package_sessions', 'package_payments'];
out.G2.ledger_by_check_in = {};
for (const t of ledgerTables) {
  const r = await count(t, 'check_in_id', CHECK_INS);
  out.G2.ledger_by_check_in[t] = r.error ? `ERR:${r.error}` : r.n;
  log(`  ${t.padEnd(20)} : ${r.error ? '('+r.error.slice(0,50)+')' : r.n + '건' + (r.n === 0 ? ' ✓' : ' ★★')}`);
  if (r.n > 0) out.G2.ledger_by_check_in[t + '_rows'] = r.rows;
}

// payments/service_charges may bind via check_in_service_id (cis) instead of check_in_id → also probe cis
log('\n── [G2] cis_id 기준 원장 재확인 (payment_items / service_charges via check_in_service_id) ──');
out.G2.ledger_by_cis = {};
for (const [t, col] of [['service_charges', 'check_in_service_id'], ['payment_items', 'check_in_service_id'], ['payments', 'check_in_service_id']]) {
  const r = await count(t, col, CIS_IDS);
  out.G2.ledger_by_cis[`${t}.${col}`] = r.error ? `ERR:${r.error}` : r.n;
  log(`  ${(t+'.'+col).padEnd(38)} : ${r.error ? '('+r.error.slice(0,45)+')' : r.n + '건' + (r.n === 0 ? ' ✓' : ' ★★')}`);
}

// ── F-4790 golden visit overlap ──
log('\n── [G2] F-4790 (오늘 배포 골든 visit) 겹침 ──');
{
  const { data } = await supabase.from('form_submissions')
    .select('id, check_in_id, field_data')
    .in('check_in_id', CHECK_INS);
  const f4790 = (data ?? []).filter(r => JSON.stringify(r.field_data || {}).includes('F-4790'));
  const f4790CI = [...new Set(f4790.map(r => r.check_in_id))];
  out.G2.f4790_check_ins = f4790CI;
  out.G2.f4790_overlaps_freeze = f4790CI.every(ci => CHECK_INS.includes(ci)) && f4790CI.length > 0;
  log(`  F-4790 참조 check_in: ${f4790CI.join(', ') || '(none)'} → freeze 4건 중 겹침: ${out.G2.f4790_overlaps_freeze ? 'YES' : 'no'}`);
  log(`  → 겹치는 check_in 의 정산행(위 G2 ledger)이 0 이면 표시데이터 있어도 CLEAR 성립`);
}

// ── G1) package_payments 공백 봉합 ──
log('\n── [G1] 27 cis / 4 check_ins 참조·인접 package 의 package_payments = 0 ──');
{
  // (a) cis 에서 package_session_id → package_sessions → package_id 경로
  const { data: cisRows } = await supabase.from('check_in_services')
    .select('id, package_session_id').in('id', CIS_IDS);
  const sessIds = [...new Set((cisRows ?? []).map(r => r.package_session_id).filter(Boolean))];
  log(`  cis→package_session_id NOT NULL: ${sessIds.length}건 ${sessIds.length ? sessIds.join(',') : '(전건 NULL = credit 객체 부존재)'}`);

  // (b) 4 check_in 에 직접 붙은 package_sessions → package_id
  const { data: sess, error: sessErr } = await supabase.from('package_sessions')
    .select('id, package_id, check_in_id').in('check_in_id', CHECK_INS);
  const pkgIdsFromSess = [...new Set((sess ?? []).map(r => r.package_id).filter(Boolean))];
  log(`  4 check_in 붙은 package_sessions: ${sessErr ? '('+sessErr.message.slice(0,40)+')' : (sess ?? []).length + '건'} → package_id ${pkgIdsFromSess.length}개`);

  const allPkgIds = [...new Set([...sessIds, ...pkgIdsFromSess])];
  out.G1.adjacent_package_ids = allPkgIds;

  // (c) package_payments 존재 여부 (테이블 존재 + 인접 package 참조 행)
  let ppTotal = null, ppAdjacent = null, ppErr = null;
  {
    const { count: c, error } = await supabase.from('package_payments').select('*', { count: 'exact', head: true });
    if (error) { ppErr = error.message; }
    else {
      ppTotal = c;
      if (allPkgIds.length) {
        const { data: ppRows } = await supabase.from('package_payments').select('id, package_id').in('package_id', allPkgIds);
        ppAdjacent = (ppRows ?? []).length;
      } else ppAdjacent = 0;
    }
  }
  out.G1.package_payments_table = ppErr ? `ABSENT/ERR:${ppErr}` : 'present';
  out.G1.package_payments_total_rows = ppTotal;
  out.G1.package_payments_adjacent_to_A = ppAdjacent;
  log(`  package_payments 테이블: ${ppErr ? '부재/에러 → '+ppErr.slice(0,50) : 'present, 전체 '+ppTotal+'행'}`);
  log(`  → (A) 인접 package 참조 package_payments: ${ppAdjacent === null ? 'N/A' : ppAdjacent + '건' + (ppAdjacent === 0 ? ' ✓' : ' ★★ (B) disposition 전이')}`);

  // (d) orphan package 01ddef31 (B branch) 가 (A)에 부재
  const { data: orphanHit } = await supabase.from('packages')
    .select('id').ilike('id', ORPHAN_PKG_B + '%');
  const orphanInAdjacent = allPkgIds.some(p => String(p).startsWith(ORPHAN_PKG_B));
  out.G1.orphan_pkg_01ddef31_in_A_adjacent = orphanInAdjacent;
  log(`  (B) orphan package ${ORPHAN_PKG_B}… (A) 인접 package 집합 내 존재: ${orphanInAdjacent ? 'YES ★★' : 'no ✓ (부재)'}`);
}

// ── (선택) check_ins/customers is_simulation ──
log('\n── [선택] check_ins / customers is_simulation ──');
{
  const { data: ci } = await supabase.from('check_ins').select('id, customer_id, is_simulation').in('id', CHECK_INS);
  const custIds = [...new Set((ci ?? []).map(r => r.customer_id).filter(Boolean))];
  let cust = [];
  if (custIds.length) {
    const { data } = await supabase.from('customers').select('id, is_simulation').in('id', custIds);
    cust = data ?? [];
  }
  const ciSim = (ci ?? []).filter(r => r.is_simulation === true).length;
  const custSim = cust.filter(r => r.is_simulation === true).length;
  out.G2.check_ins_is_simulation_true = ciSim;   // may be undefined column
  out.G2.customers_is_simulation_true = custSim;
  log(`  check_ins.is_simulation=TRUE: ${ciSim} / ${(ci ?? []).length}  (컬럼부재면 0)`);
  log(`  customers.is_simulation=TRUE: ${custSim} / ${cust.length}`);
}

// ── verdict ──
const g2clean = ledgerTables.every(t => out.G2.ledger_by_check_in[t] === 0);
const g1clean = out.G1.package_payments_adjacent_to_A === 0 && out.G1.orphan_pkg_01ddef31_in_A_adjacent === false;
const bindClean = (out.G2.cis_stray_check_ins || []).length === 0;
out.verdict = { G1_clean: g1clean, G2_ledger_clean: g2clean, cis_bind_clean: bindClean,
  CLEAR: g1clean && g2clean && bindClean };
log('\n════════════════ VERDICT ════════════════');
log(`  G1 (package_payments=0 + orphan 부재): ${g1clean ? 'CLEAR ✓' : 'FAIL ★'}`);
log(`  G2 (exact-id 원장 4종=0): ${g2clean ? 'CLEAR ✓' : 'FAIL ★'}`);
log(`  cis bind (손자 FK 0): ${bindClean ? 'CLEAR ✓' : 'FAIL ★'}`);
log(`  → apply-readiness(READ-ONLY): ${out.verdict.CLEAR ? 'CLEAR — hard-DELETE 여전히 HOLD (총괄+DB-GATE+apply_gate 후)' : 'HOLD/RE-JUDGE'}`);

fs.writeFileSync(new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_A_G1G2_EVIDENCE.json', import.meta.url),
  JSON.stringify(out, null, 2));
log('\nevidence → scripts/T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_A_G1G2_EVIDENCE.json');
