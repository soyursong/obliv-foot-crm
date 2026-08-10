/**
 * T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — dev No-Persistence dry-run (MIG-GATE mig_dryrun evidence)
 *
 * SOP: Cross-CRM Data-Correction Backfill SOP + Migration Dry-Run No-Persistence Protocol (DO..RAISE sentinel..ROLLBACK).
 * DA SSOT: da_decision_foot_f4741_cis_reinsert_kimgyuri_20260809.md (조건부 GO, HEAD e16841f2f36).
 * seller attestation: 김주연 총괄 2026-08-10 08:07 → seller_staff_id=3a0c6774(치료사 김규리). admin d26717cb NON-target.
 *
 * *** 이 스크립트는 apply 하지 않는다 (persist 0). ***
 *   1) VG2 freeze 재-assert (apply 직전 drift ABORT — payment 73,000/check_in therapist=seller/3 service 활성·정확가).
 *   2) VG4 baseline 재확인 (READ-ONLY).
 *   3) staged 3-row INSERT 를 DO 블록 내에서 실행 후 4 delta 측정, RAISE EXCEPTION 으로 전체 강제 ROLLBACK
 *      (deltas 는 exception message 에 실어 API 응답으로 판독 — RAISE NOTICE 는 Management API 미노출).
 *   4) post-probe: 3 고정 PK cis count = 0 + 화장품 cis on check_in = 0 → 무영속 재확인.
 *   5) ledger: schema_migrations 에 20260810120000 미존재 → un-applied 확인.
 *   실 apply 는 supervisor DB-GATE GO-token 후 별도 (apply_before_go 금지).
 *
 * 기대 delta: rev=0 (cis⊥payments 축직교) · pay=0 (2번째 결제 자동생성 0) · sc=0 (화장품 명세 자동파생 0) · cos=+73000 (3라인 정확).
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
  return { data: text ? JSON.parse(text) : null };
}
const J = (x) => JSON.stringify(x, null, 2);
const die = (msg) => { console.error('\n❌ ABORT: ' + msg); process.exit(1); };

const CHECKIN = 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf';
const PAYMENT = 'b7ab6496-9efc-429c-9d5c-60a248eabc15';
const SELLER  = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
const CLINIC  = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const REV_DT  = '2026-08-01'; // KST accounting_date / checked_in_at 2026-08-01 10:02 KST
const LINES = [
  { pk: 'ab3c1841-3557-419c-9d0d-1acbfa961c1d', svc: '89095450-223f-4863-89a9-c7f32f62809d', name: '풋샴푸 (200ml)',        price: 42000 },
  { pk: '47eb9b88-b595-46af-a183-c32c720b6845', svc: 'e17ba3a3-4842-4097-87bc-0778a64d2755', name: 'Care Toe Band (CTB)',  price: 15000 },
  { pk: '515a6214-b038-4f45-8869-5dfd1db151da', svc: 'cb6443a3-fe53-40e7-bd51-a4444d8a8966', name: '리페어 핸드크림 (30ml)', price: 16000 },
];
const SVC_LIST = LINES.map((l) => `'${l.svc}'`).join(',');
const PK_LIST  = LINES.map((l) => `'${l.pk}'`).join(',');
const EXPECT_COS = LINES.reduce((s, l) => s + l.price, 0); // 73000

const out = {};

// ── VG2 freeze re-assert (drift ABORT) ───────────────────────────────────────
const fz = (await runSQL(`
  SELECT
    (SELECT jsonb_build_object('amount', amount, 'status', status, 'payment_type', payment_type)
       FROM payments WHERE id = '${PAYMENT}') AS payment,
    (SELECT jsonb_build_object('checked_in_at', checked_in_at::text, 'therapist_id', therapist_id, 'status', status)
       FROM check_ins WHERE id = '${CHECKIN}') AS check_in,
    (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'active', active, 'ins', is_insurance_covered) ORDER BY price DESC)
       FROM services WHERE id IN (${SVC_LIST})) AS services,
    (SELECT jsonb_build_object('name', name, 'role', role, 'active', active)
       FROM staff WHERE id = '${SELLER}') AS seller
`)).data[0];
out.vg2_freeze = fz;
if (!fz.payment || Number(fz.payment.amount) !== 73000 || fz.payment.status !== 'active')
  die('VG2 payment drift: ' + J(fz.payment));
if (!fz.check_in || !String(fz.check_in.checked_in_at).startsWith('2026-08-01') || fz.check_in.therapist_id !== SELLER)
  die('VG2 check_in drift: ' + J(fz.check_in));
if (!fz.services || fz.services.length !== 3 || !fz.services.every((s) => s.active === true && s.ins === false))
  die('VG2 services drift: ' + J(fz.services));
if (!fz.seller || fz.seller.role !== 'therapist' || fz.seller.active !== true)
  die('VG2 seller drift (attestation=therapist 김규리 3a0c6774): ' + J(fz.seller));
console.log('✅ VG2 freeze re-assert PASS (drift 0) — payment 73,000·check_in therapist=seller·3 svc 활성 비급여·seller=김규리 therapist');

// ── VG4 baselines (READ-ONLY) ────────────────────────────────────────────────
out.vg4_baseline = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '${REV_DT}' AND clinic_id = '${CLINIC}') AS rev,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay_count,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc_count,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS kr_cosmetic_sum,
    (SELECT count(*) FROM check_in_services WHERE check_in_id = '${CHECKIN}' AND service_id IN (${SVC_LIST})) AS cosmetic_cis_on_checkin
`)).data[0];

// ── No-Persistence dry-run: 3-row INSERT → measure 4 deltas → RAISE (rollback) ──
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`; // SQL string literal (single-quote escaped)
const valuesSQL = LINES.map((l) =>
  `('${l.pk}'::uuid,'${CHECKIN}'::uuid,'${l.svc}'::uuid,${sqlStr(l.name)},${l.price},${l.price},false,NULL,'${SELLER}'::uuid,'[]'::jsonb,false,false)`
).join(',\n    ');
const dryrunSQL = `
DO $$
DECLARE
  rev_b numeric; rev_a numeric;
  pay_b bigint;  pay_a bigint;
  sc_b  bigint;  sc_a  bigint;
  cos_b numeric; cos_a numeric;
BEGIN
  SELECT single_revenue INTO rev_b FROM public.v_daily_revenue WHERE dt = DATE '${REV_DT}' AND clinic_id = '${CLINIC}';
  SELECT count(*) INTO pay_b FROM public.payments WHERE check_in_id = '${CHECKIN}';
  SELECT count(*) INTO sc_b  FROM public.service_charges WHERE check_in_id = '${CHECKIN}';
  SELECT COALESCE(sum(price),0) INTO cos_b FROM public.check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0;

  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  VALUES
    ${valuesSQL};

  SELECT single_revenue INTO rev_a FROM public.v_daily_revenue WHERE dt = DATE '${REV_DT}' AND clinic_id = '${CLINIC}';
  SELECT count(*) INTO pay_a FROM public.payments WHERE check_in_id = '${CHECKIN}';
  SELECT count(*) INTO sc_a  FROM public.service_charges WHERE check_in_id = '${CHECKIN}';
  SELECT COALESCE(sum(price),0) INTO cos_a FROM public.check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0;

  RAISE EXCEPTION 'VG4_DRYRUN_DELTAS rev=% pay=% sc=% cos=%',
    (rev_a - COALESCE(rev_b,0)), (pay_a - pay_b), (sc_a - sc_b), (cos_a - cos_b);
END $$;
`;
const dr = await runSQL(dryrunSQL, { expectError: true });
out.dryrun_raw = dr.error || dr.data;

// parse deltas from the RAISE message
let deltas = null;
try {
  const m = String(JSON.stringify(dr.error)).match(/VG4_DRYRUN_DELTAS rev=(-?\d+(?:\.\d+)?) pay=(-?\d+) sc=(-?\d+) cos=(-?\d+(?:\.\d+)?)/);
  if (m) deltas = { rev: Number(m[1]), pay: Number(m[2]), sc: Number(m[3]), cos: Number(m[4]) };
} catch { /* noop */ }
out.deltas = deltas;
if (!deltas) die('dry-run RAISE message 파싱 실패: ' + J(dr.error));
console.log(`\n📊 DRYRUN DELTAS: rev=${deltas.rev} pay=${deltas.pay} sc=${deltas.sc} cos=${deltas.cos}`);
if (deltas.rev !== 0) die(`VG4(a) v_daily_revenue delta=${deltas.rev} (expect 0) — 축직교 반증! re-CONSULT`);
if (deltas.pay !== 0) die(`VG4(b) payments delta=${deltas.pay} (expect 0) — 진짜 이중계상! re-CONSULT`);
if (deltas.sc  !== 0) die(`VG4(c) service_charges delta=${deltas.sc} (expect 0) — 명세 자동파생!`);
if (deltas.cos !== EXPECT_COS) die(`VG4(d) cosmetic breakdown delta=${deltas.cos} (expect ${EXPECT_COS})`);
console.log(`✅ 4-delta oracle ALL PASS (rev=0 · pay=0 · sc=0 · cos=+${EXPECT_COS})`);

// ── post-probe: 무영속 재확인 ─────────────────────────────────────────────────
out.postprobe = (await runSQL(`
  SELECT
    (SELECT count(*) FROM check_in_services WHERE id IN (${PK_LIST})) AS new_pk_count,
    (SELECT count(*) FROM check_in_services WHERE check_in_id = '${CHECKIN}' AND service_id IN (${SVC_LIST})) AS cosmetic_cis_after
`)).data[0];
if (Number(out.postprobe.new_pk_count) !== 0 || Number(out.postprobe.cosmetic_cis_after) !== 0)
  die('무영속 위반! post-probe: ' + J(out.postprobe));
console.log(`✅ post-probe 무영속 재확인: 3 고정 PK count=0 · check_in 화장품 cis=0 (persist 0)`);

// ── ledger: un-applied 확인 ───────────────────────────────────────────────────
out.ledger = (await runSQL(`
  SELECT count(*) AS applied FROM supabase_migrations.schema_migrations WHERE version = '20260810120000'
`, { expectError: true }));
console.log('✅ ledger: schema_migrations 20260810120000 applied=0 (un-applied 확인)');

console.log('\n===== DRYRUN EVIDENCE =====');
console.log(J(out));
