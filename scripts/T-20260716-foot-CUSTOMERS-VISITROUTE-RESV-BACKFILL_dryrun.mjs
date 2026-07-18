/**
 * T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL — DRY-RUN (read-only, write 0)
 * ────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 게이트#2: dry-run evidence.
 * DA CONSULT-REPLY: DA-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL (CONDITIONAL-GO).
 *
 * 대상: customers.visit_route 단독 fill-on-NULL/'' (reservations 절대 미변경).
 * 소스: reservations.visit_route (한글 enum, ≠source_system).
 * 매핑: identity + 인콜→인바운드 정규화. NULL/''/미지정 → skip.
 * fill 규칙: first-touch (created_at ASC).
 *
 * ⚠ 이 스크립트는 SELECT-only. 어떤 UPDATE/INSERT/DELETE 도 실행하지 않는다.
 *   APPLY 는 supervisor 백필 승인(게이트#3) 후 별도 apply.mjs 로.
 *
 * PHI 라우팅: name/phone/RRN 등 PHI 컬럼 미조회 — id/visit_route/created_at/source_system 만.
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync } from 'node:fs';

const MAP = (v) => (v === '인콜' ? '인바운드' : v); // A안: 인콜→인바운드, 그 외 identity
const NONEMPTY = `visit_route IS NOT NULL AND visit_route <> ''`;
const out = { ticket: 'T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL', db: 'rxlomoozakkjesdqjtvd (obliv-foot PROD)', mode: 'dry-run (SELECT-only, write 0)', generated_kst_note: 'stamp on wrapper', sections: {} };
const log = (k, v) => { out.sections[k] = v; console.log(`\n== ${k} ==`); console.log(JSON.stringify(v)); };

// ── BEFORE 카운트 ────────────────────────────────────────────────────────────
log('before.customers_visit_route_dist', await q(`SELECT COALESCE(visit_route,'<NULL>') v, count(*)::int n FROM customers GROUP BY 1 ORDER BY 2 DESC`));
log('before.target_universe (customers NULL/\'\' ∩ EXISTS reservations routed)', await q(`
  SELECT count(*)::int n FROM customers c
  WHERE (c.visit_route IS NULL OR c.visit_route = '')
    AND EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.${NONEMPTY})`));
log('before.customers_null_or_empty_total', await q(`SELECT count(*)::int n FROM customers WHERE visit_route IS NULL OR visit_route = ''`));
log('before.customers_null_no_routed_resv (out-of-scope: no source)', await q(`
  SELECT count(*)::int n FROM customers c
  WHERE (c.visit_route IS NULL OR c.visit_route = '')
    AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.${NONEMPTY})`));

// ── Set A = DA-strict first-touch (최초예약이 route NULL이면 out-of-scope, forward-fill 금지) ──
const setA = await q(`
  WITH tgt AS (SELECT id FROM customers WHERE visit_route IS NULL OR visit_route = ''),
  first_resv AS (
    SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route, r.created_at
    FROM reservations r JOIN tgt ON tgt.id = r.customer_id
    ORDER BY r.customer_id, r.created_at ASC, r.id ASC)
  SELECT customer_id, visit_route AS src FROM first_resv WHERE ${NONEMPTY.replace(/visit_route/g,'visit_route')}`);
const setA_mapped = setA.map(r => ({ customer_id: r.customer_id, src: r.src, new_value: MAP(r.src) }));
log('setA.DA_strict_first_touch.count', [{ n: setA_mapped.length }]);
{ const b = {}; for (const r of setA_mapped) b[`${r.src}→${r.new_value}`] = (b[`${r.src}→${r.new_value}`]||0)+1; log('setA.DA_strict_first_touch.mapping_breakdown', b); }

// ── Set B = AC2 earliest-NON-NULL (최초 non-null route 예약) ──
const setB = await q(`
  WITH tgt AS (SELECT id FROM customers WHERE visit_route IS NULL OR visit_route = ''),
  first_routed AS (
    SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route AS src, r.created_at
    FROM reservations r JOIN tgt ON tgt.id = r.customer_id
    WHERE r.${NONEMPTY}
    ORDER BY r.customer_id, r.created_at ASC, r.id ASC)
  SELECT customer_id, src FROM first_routed`);
const setB_mapped = setB.map(r => ({ customer_id: r.customer_id, src: r.src, new_value: MAP(r.src) }));
log('setB.AC2_earliest_nonnull.count', [{ n: setB_mapped.length }]);
{ const b = {}; for (const r of setB_mapped) b[`${r.src}→${r.new_value}`] = (b[`${r.src}→${r.new_value}`]||0)+1; log('setB.AC2_earliest_nonnull.mapping_breakdown', b); }

// ── A vs B divergence (최초예약 route NULL이나 후행 non-null 존재하는 고객) ──
const aIds = new Set(setA_mapped.map(r => r.customer_id));
const bOnly = setB_mapped.filter(r => !aIds.has(r.customer_id));
const valueDiff = setB_mapped.filter(r => { const a = setA_mapped.find(x => x.customer_id === r.customer_id); return a && a.new_value !== r.new_value; });
log('divergence.B_minus_A (forward-fill candidates DA excludes)', [{ count: bOnly.length, sample: bOnly.slice(0,10) }]);
log('divergence.value_mismatch_where_both_present', [{ count: valueDiff.length, sample: valueDiff.slice(0,10) }]);

// ── Set C = most-recent(폐기된 규칙) — 참고용 divergence ──
const setC = await q(`
  WITH tgt AS (SELECT id FROM customers WHERE visit_route IS NULL OR visit_route = ''),
  last_routed AS (
    SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route AS src
    FROM reservations r JOIN tgt ON tgt.id = r.customer_id
    WHERE r.${NONEMPTY}
    ORDER BY r.customer_id, r.created_at DESC, r.id DESC)
  SELECT customer_id, src FROM last_routed`);
const setC_mapped = setC.map(r => ({ customer_id: r.customer_id, new_value: MAP(r.src) }));
const cVsB = setC_mapped.filter(r => { const b = setB_mapped.find(x => x.customer_id === r.customer_id); return b && b.new_value !== r.new_value; });
log('reference.setC_most_recent.count', [{ n: setC_mapped.length }]);
log('reference.first_vs_recent_divergence (per AC2 line132)', [{ count: cVsB.length, sample: cVsB.slice(0,10) }]);

// ── no-clobber 실증: 기존 non-null visit_route 고객은 대상셋에서 0건이어야 ──
log('noclobber.existing_nonnull_in_any_set (must be 0)', [{
  inA: setA_mapped.length ? (await q(`SELECT count(*)::int n FROM customers WHERE id IN (${setA_mapped.map(r=>`'${r.customer_id}'`).join(',')}) AND visit_route IS NOT NULL AND visit_route <> ''`))[0].n : 0
}]);

// ── DOPAMINE 잔차 (DA Q2): firsttouch dopamine ∩ cust NULL ∩ 그 고객 전 예약 route 전무 → 0 기대 ──
log('dopamine.residual_sliver (DA Q2, expect 0)', await q(`
  WITH tgt AS (SELECT id FROM customers WHERE visit_route IS NULL OR visit_route = ''),
  first_all AS (
    SELECT DISTINCT ON (r.customer_id) r.customer_id, r.source_system, r.visit_route
    FROM reservations r JOIN tgt ON tgt.id = r.customer_id
    ORDER BY r.customer_id, r.created_at ASC, r.id ASC)
  SELECT count(*)::int n FROM first_all fa
  WHERE fa.source_system = 'dopamine'
    AND NOT EXISTS (SELECT 1 FROM reservations r2 WHERE r2.customer_id = fa.customer_id AND r2.visit_route IS NOT NULL AND r2.visit_route <> '')`));

// ── mapping 값이 customers CHECK 도메인 내인지 (전부 통과 기대) ──
const CHECK_DOMAIN = ['TM','워크인','인바운드','지인소개','네이버','인콜'];
const outOfDomain = [...new Set([...setA_mapped, ...setB_mapped].map(r => r.new_value))].filter(v => !CHECK_DOMAIN.includes(v));
log('mapping.values_out_of_check_domain (must be empty)', outOfDomain);

// ── freeze set (PRIMARY = DA-strict Set A) — apply-time 재검증 앵커 ──
const freeze = setA_mapped.map(r => ({ customer_id: r.customer_id, src_route: r.src, new_visit_route: r.new_value })).sort((a,b)=>a.customer_id<b.customer_id?-1:1);
out.freeze_primary_DA_strict = { rule: 'first-touch strict (earliest reservation; NULL→out-of-scope, no forward-fill)', count: freeze.length, rows: freeze };
out.spec_tension_flag = {
  note: 'DA Q4 (strict first-touch, forward-fill 금지) vs AC2 line107 (earliest NON-NULL). B-A divergence 위 참조. PRIMARY freeze=DA-strict(보수적). supervisor/planner 판정 요망.',
  setA_DA_strict_count: setA_mapped.length,
  setB_AC2_earliest_nonnull_count: setB_mapped.length,
};
writeFileSync('scripts/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL_dryrun.out.json', JSON.stringify(out, null, 2));
console.log('\n== freeze rows (DA-strict primary): ' + freeze.length + ' → written to _dryrun.out.json ==');
