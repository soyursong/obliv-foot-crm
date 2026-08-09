/**
 * T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI — dev No-Persistence dry-run (MIG-GATE mig_dryrun evidence)
 *
 * SOP: Cross-CRM Data-Correction Backfill SOP + Migration Dry-Run No-Persistence Protocol (DO..RAISE sentinel..ROLLBACK).
 * DA SSOT: agents/docs/da_replies/da_decision_foot_heo4717_2e8f7aa5_cis_create_kimgyuri_20260809.md (Q1 GO 조건부·verify-gated).
 *
 * *** 이 스크립트는 apply 하지 않는다 (persist 0). ***
 *   - VG2 freeze 재-assert (drift ABORT) + VG4 baseline 재확인 (READ-ONLY).
 *   - staged INSERT 를 DO 블록 내에서 실행 후 4 delta 측정, RAISE EXCEPTION 으로 전체 강제 ROLLBACK
 *     (deltas 는 exception message 에 실어 API 응답으로 판독 — RAISE NOTICE 는 Management API 미노출).
 *   - post-probe: 고정 PK 070652f3 cis count = 0 → 무영속 재확인.
 *   - ledger: schema_migrations 에 20260809100000 미존재 → un-applied 확인.
 *   - 실 apply 는 supervisor DB-GATE GO-token 후 별도 (apply_before_go 금지).
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) { console.error('missing SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function runSQL(query, { expectError = false } = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (expectError) return { error: text, status: res.status };
    throw new Error(`SQL API ${res.status}: ${text}`);
  }
  return { data: JSON.parse(text) };
}
const J = (x) => JSON.stringify(x, null, 2);

const CHECKIN = 'c33dfc76-cda5-48e6-9b34-277281b26626';
const SERVICE_CTB = 'e17ba3a3-4842-4097-87bc-0778a64d2755';
const PAYMENT = '2e8f7aa5-3e83-4d4a-8900-ab1f0048694a';
const SELLER = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const NEW_CIS_PK = '070652f3-3cb0-414a-ad80-98bf4c967e59';

const out = {};

// ── VG2 freeze re-assert (READ-ONLY) ─────────────────────────────────────────
out.vg2_freeze = (await runSQL(`
  SELECT
    (SELECT jsonb_build_object('amount', amount, 'status', status, 'payment_type', payment_type)
       FROM payments WHERE id = '${PAYMENT}') AS payment,
    (SELECT jsonb_build_object('checked_in_at', checked_in_at, 'therapist_id', therapist_id, 'status', status, 'visit_type', visit_type)
       FROM check_ins WHERE id = '${CHECKIN}') AS check_in,
    (SELECT jsonb_build_object('name', name, 'price', price, 'active', active)
       FROM services WHERE id = '${SERVICE_CTB}') AS service_ctb
`)).data;

// ── VG4 baselines (READ-ONLY) ────────────────────────────────────────────────
out.vg4_baseline = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = '${CLINIC}') AS rev_0728,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay_count,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc_count,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS kr_cosmetic_sum,
    (SELECT count(*) FROM check_in_services WHERE check_in_id = '${CHECKIN}' AND service_id = '${SERVICE_CTB}') AS ctb_cis_count
`)).data;

// ── No-Persistence dry-run: INSERT → measure 4 deltas → RAISE (rollback), deltas in message ──
const dryrunSQL = `
DO $$
DECLARE
  rev_b numeric; rev_a numeric;
  pay_b bigint;  pay_a bigint;
  sc_b  bigint;  sc_a  bigint;
  cos_b numeric; cos_a numeric;
BEGIN
  SELECT single_revenue INTO rev_b FROM public.v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = '${CLINIC}';
  SELECT count(*) INTO pay_b FROM public.payments WHERE check_in_id = '${CHECKIN}';
  SELECT count(*) INTO sc_b  FROM public.service_charges WHERE check_in_id = '${CHECKIN}';
  SELECT COALESCE(sum(price),0) INTO cos_b FROM public.check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0;

  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  VALUES
    ('${NEW_CIS_PK}'::uuid, '${CHECKIN}'::uuid, '${SERVICE_CTB}'::uuid,
     'Care Toe Band (CTB)', 15000, 15000, false, NULL, '${SELLER}'::uuid,
     '{}'::jsonb, false, false);

  SELECT single_revenue INTO rev_a FROM public.v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = '${CLINIC}';
  SELECT count(*) INTO pay_a FROM public.payments WHERE check_in_id = '${CHECKIN}';
  SELECT count(*) INTO sc_a  FROM public.service_charges WHERE check_in_id = '${CHECKIN}';
  SELECT COALESCE(sum(price),0) INTO cos_a FROM public.check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0;

  RAISE EXCEPTION 'VG4_DRYRUN_DELTAS rev=% pay=% sc=% cos=%',
    (rev_a - rev_b), (pay_a - pay_b), (sc_a - sc_b), (cos_a - cos_b);
END $$;
`;
const dr = await runSQL(dryrunSQL, { expectError: true });
out.dryrun_raw = dr.error || dr.data;

// ── post-probe: 무영속 재확인 ─────────────────────────────────────────────────
out.postprobe = (await runSQL(`
  SELECT
    (SELECT count(*) FROM check_in_services WHERE id = '${NEW_CIS_PK}') AS new_pk_count,
    (SELECT count(*) FROM check_in_services WHERE check_in_id = '${CHECKIN}' AND service_id = '${SERVICE_CTB}') AS ctb_cis_count_after
`)).data;

// ── ledger: un-applied 확인 ───────────────────────────────────────────────────
out.ledger = (await runSQL(`
  SELECT count(*) AS applied FROM supabase_migrations.schema_migrations WHERE version = '20260809100000'
`, { expectError: true }));

console.log(J(out));
