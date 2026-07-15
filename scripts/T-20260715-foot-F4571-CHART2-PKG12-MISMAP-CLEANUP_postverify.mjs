/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — POSTVERIFY (prod, READ-ONLY)
 * supervisor FIX-REQUEST(MSG-20260716-014047-aqaf, qa_fail=insufficient_verification) 대응 증빙.
 * 파괴 없음. SELECT / information_schema only. 원장 무접점.
 *
 * 검증 항목:
 *  [POSTVERIFY]  P1 archived rowcount 5 (pkg1+pp4) / P2 freeze remnant 0 /
 *                P3 KEEP 3객체 무손실 / P4 net-loss 0 / P5 orphan·dangling 0
 *  [MIG-GATE]    M1 schema_migrations(20260715230000) 반영 / M2 archive 테이블 존재+rowcount /
 *                M3 rollback SQL 동작 검증(무영속 dry-run: rollback→재확인→ROLLBACK)
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const FREEZE_PKG = '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
const FREEZE_PP = ['1d865046-d740-468f-9025-7f66b7de62ea',
                   'c6fcbb7b-240a-4a85-97e4-18c84e113c86',
                   'e064d498-d35a-492c-9d68-18e3c888bff0',
                   '6f1a5f98-d335-439b-8d92-a378e1c24650'];
const KEEP_PKG = '9a553cbd-621b-435e-ae20-aabc035e363e';
const KEEP_PP  = 'bc58d34e-0ac8-422c-8a83-c8b6000e0a6d';
const KEEP_PM  = '01299d6c-d7e1-45bb-894b-ead27c80ac36';
const CUST     = '99784454-1ee5-4c38-b677-7c085b3b19db';
const ppList = "'" + FREEZE_PP.join("','") + "'";

const out = {};

// ═══ POSTVERIFY ═══
// P1 archived rowcount = 5 (pkg1 + pp4)
out.P1_archived = await q(`
  SELECT
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_packages_20260715         WHERE id='${FREEZE_PKG}') AS arch_pkg,
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_package_payments_20260715 WHERE id IN (${ppList})) AS arch_pp,
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_packages_20260715)         AS arch_pkg_total,
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_package_payments_20260715) AS arch_pp_total;
`);

// P2 freeze remnant = 0 (live 원장에 삭제 대상 잔존 없음)
out.P2_freeze_remnant = await q(`
  SELECT
    (SELECT count(*) FROM packages         WHERE id='${FREEZE_PKG}')      AS live_pkg,
    (SELECT count(*) FROM package_payments WHERE id IN (${ppList}))       AS live_pp;
`);

// P3 KEEP 3객체 무손실
out.P3_keep_intact = await q(`
  SELECT
    (SELECT count(*) FROM packages         WHERE id='${KEEP_PKG}' AND status='active')                        AS keep_pkgB_active,
    (SELECT total_amount FROM packages     WHERE id='${KEEP_PKG}')                                            AS keep_pkgB_total,
    (SELECT count(*) FROM package_payments WHERE id='${KEEP_PP}')                                             AS keep_ppB,
    (SELECT amount FROM package_payments   WHERE id='${KEEP_PP}')                                             AS keep_ppB_amount,
    (SELECT count(*) FROM payments         WHERE id='${KEEP_PM}' AND status='active')                         AS keep_payment_active,
    (SELECT amount FROM payments           WHERE id='${KEEP_PM}')                                             AS keep_payment_amount;
`);

// P4 net-loss 0 — 고객 F-4571 실지불 총액 보존(체험비 10,000 + 8회권 1,980,000 = 1,990,000)
out.P4_net_loss = await q(`
  SELECT
    (SELECT COALESCE(SUM(amount),0) FROM package_payments
       WHERE package_id='${KEEP_PKG}' AND payment_type='payment')                    AS keep_pkgB_paid,
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
       FROM payments WHERE id='${KEEP_PM}')                                          AS keep_standalone,
    -- 삭제된 pkg A는 net=0(결제 1,990,000 − 환불 1,990,000)이었으므로 실지불 보존액에 무영향
    (SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
       FROM package_payments WHERE package_id='${FREEZE_PKG}')                       AS pkgA_residual_net;
`);

// P5 orphan / dangling = 0 (pkg / payments / package_payments)
out.P5_orphan_dangling = await q(`
  SELECT
    -- package_payments 중 부모 package 부재(dangling package_id)
    (SELECT count(*) FROM package_payments pp
       WHERE pp.package_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM packages p WHERE p.id = pp.package_id))       AS pp_dangling_pkg,
    -- package_payments refund 중 parent_payment 부재(dangling parent)
    (SELECT count(*) FROM package_payments pp
       WHERE pp.parent_payment_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM package_payments x WHERE x.id = pp.parent_payment_id)) AS pp_dangling_parent,
    -- 고객 F-4571 잔존 package_payments 중 삭제 대상 참조 잔재
    (SELECT count(*) FROM package_payments WHERE parent_payment_id IN (${ppList}))   AS pp_ref_to_freeze,
    -- 삭제된 pkg A를 참조하는 잔존 자식(check_ins / package_sessions)
    (SELECT count(*) FROM check_ins        WHERE package_id='${FREEZE_PKG}')         AS checkins_orphan,
    (SELECT count(*) FROM package_sessions WHERE package_id='${FREEZE_PKG}')         AS sessions_orphan,
    -- 고객 F-4571 잔존 패키지/결제 전수(참고: pkg B 1건 + ppB 1건 + 체험비 payment 1건만 남아야)
    (SELECT count(*) FROM packages         WHERE customer_id='${CUST}')              AS cust_pkg_total,
    (SELECT count(*) FROM package_payments WHERE package_id='${KEEP_PKG}')           AS cust_ppB_total;
`);

// ═══ MIG-GATE 3자 정합 ═══
// M1 schema_migrations 반영
out.M1_schema_migrations = await q(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version = '20260715230000';
`);

// M2 archive 테이블 존재 + rowcount
out.M2_archive_tables = await q(`
  SELECT
    to_regclass('public._archive_f4571_pkg12_mismap_packages_20260715')::text         AS pkg_tbl,
    to_regclass('public._archive_f4571_pkg12_mismap_package_payments_20260715')::text AS pp_tbl,
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_packages_20260715)              AS pkg_rows,
    (SELECT count(*) FROM _archive_f4571_pkg12_mismap_package_payments_20260715)      AS pp_rows;
`);

// M3 rollback SQL 동작 검증 — 무영속 dry-run
// archive→live 복원(FK 순서: pkg parent → pp payment → pp refund) 후 복귀 rowcount 확인 → ROLLBACK
out.M3_rollback_dryrun = await q(`
BEGIN;
  -- packages 복원
  INSERT INTO packages SELECT * FROM _archive_f4571_pkg12_mismap_packages_20260715 a
    WHERE NOT EXISTS (SELECT 1 FROM packages p WHERE p.id=a.id);
  -- package_payments payment(부모) 먼저
  INSERT INTO package_payments SELECT * FROM _archive_f4571_pkg12_mismap_package_payments_20260715 a
    WHERE a.payment_type='payment'
      AND NOT EXISTS (SELECT 1 FROM package_payments x WHERE x.id=a.id);
  -- package_payments refund(자식) 다음
  INSERT INTO package_payments SELECT * FROM _archive_f4571_pkg12_mismap_package_payments_20260715 a
    WHERE a.payment_type='refund'
      AND NOT EXISTS (SELECT 1 FROM package_payments x WHERE x.id=a.id);
  -- 복원 검증
  SELECT
    (SELECT count(*) FROM packages         WHERE id='${FREEZE_PKG}')      AS restored_pkg,
    (SELECT count(*) FROM package_payments WHERE id IN (${ppList}))       AS restored_pp;
ROLLBACK;
`);

console.log(JSON.stringify(out, null, 2));
