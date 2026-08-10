/**
 * T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — PROD APPLY (persist) + evidence-based probe
 *
 * ⚠️ apply_before_go 금지: 이 스크립트는 supervisor DB-GATE GO-token 발행 후에만 실행한다.
 *    dev-foot 는 deploy-ready 마킹까지만 (freeze-set + No-Persistence dry-run). 실 apply = supervisor lane.
 *
 * 승인 근거(예정):
 *   - DA CONSULT-REPLY 조건부 GO (da_decision_foot_f4741_cis_reinsert_kimgyuri_20260809.md, e16841f2f36)
 *   - seller attestation: 김주연 총괄 2026-08-10 08:07 → seller=3a0c6774(치료사 김규리)
 *   - dev No-Persistence dry-run PASS (4-delta oracle: rev=0/pay=0/sc=0/cos=+73000)
 *   - supervisor DB-GATE GO-token (발행 시 기입)
 *
 * 이 스크립트는 실제로 PERSIST 한다 (dryrun 과 달리 RAISE ROLLBACK 없음).
 *   1) VG2 freeze re-assert (apply 직전 drift ABORT)
 *   2) VG1 archive-first: dec7e6c4 현 cis 스냅샷 (rollback 원본 · 순소실0 감사)
 *   3) baselines 측정 (rev/pay/sc/cos)
 *   4) 실 INSERT (up.sql 본체 — VALUES + WHERE NOT EXISTS + ON CONFLICT DO NOTHING 멱등)
 *   5) evidence-based probe: after-state + 4 delta 검증 (rev=0/pay=0/sc=0/cos=+73000) + 신규 PK count=3
 *   6) ledger: schema_migrations 20260810120000 기록
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
const REV_DT  = '2026-08-01';
const LINES = [
  { pk: 'ab3c1841-3557-419c-9d0d-1acbfa961c1d', svc: '89095450-223f-4863-89a9-c7f32f62809d', name: '풋샴푸 (200ml)',        price: 42000 },
  { pk: '47eb9b88-b595-46af-a183-c32c720b6845', svc: 'e17ba3a3-4842-4097-87bc-0778a64d2755', name: 'Care Toe Band (CTB)',  price: 15000 },
  { pk: '515a6214-b038-4f45-8869-5dfd1db151da', svc: 'cb6443a3-fe53-40e7-bd51-a4444d8a8966', name: '리페어 핸드크림 (30ml)', price: 16000 },
];
const SVC_LIST = LINES.map((l) => `'${l.svc}'`).join(',');
const PK_LIST  = LINES.map((l) => `'${l.pk}'`).join(',');
const EXPECT_COS = LINES.reduce((s, l) => s + l.price, 0);
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const out = {};

// ── VG2 freeze re-assert (drift ABORT) ───────────────────────────────────────
const fz = (await runSQL(`
  SELECT
    (SELECT jsonb_build_object('amount', amount, 'status', status) FROM payments WHERE id = '${PAYMENT}') AS payment,
    (SELECT jsonb_build_object('checked_in_at', checked_in_at::text, 'therapist_id', therapist_id) FROM check_ins WHERE id = '${CHECKIN}') AS check_in,
    (SELECT count(*) FROM services WHERE id IN (${SVC_LIST}) AND active = true) AS active_svc,
    (SELECT role FROM staff WHERE id = '${SELLER}') AS seller_role
`)).data[0];
out.vg2_freeze = fz;
if (!fz.payment || Number(fz.payment.amount) !== 73000 || fz.payment.status !== 'active') die('VG2 payment drift: ' + J(fz.payment));
if (!fz.check_in || !String(fz.check_in.checked_in_at).startsWith('2026-08-01') || fz.check_in.therapist_id !== SELLER) die('VG2 check_in drift: ' + J(fz.check_in));
if (Number(fz.active_svc) !== 3) die('VG2 service drift (active !=3): ' + J(fz.active_svc));
if (fz.seller_role !== 'therapist') die('VG2 seller drift (attestation=therapist): ' + J(fz.seller_role));
console.log('✅ VG2 freeze re-assert PASS (drift 0)');

// ── VG1 archive-first: dec7e6c4 현 cis 스냅샷 (rollback 원본) ──────────────────
out.vg1_archive = (await runSQL(`
  SELECT id, service_id, service_name, price, seller_staff_id, voided_at
    FROM check_in_services WHERE check_in_id = '${CHECKIN}' ORDER BY created_at
`)).data;
console.log(`✅ VG1 archive-first: dec7e6c4 cis ${out.vg1_archive.length}행 스냅샷 (before-image)`);

// ── baselines ─────────────────────────────────────────────────────────────────
const before = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '${REV_DT}' AND clinic_id = '${CLINIC}') AS rev,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS cos,
    (SELECT count(*) FROM check_in_services WHERE id IN (${PK_LIST})) AS new_pk
`)).data[0];
out.baseline = before;
if (Number(before.new_pk) !== 0) die('신규 PK 이미 존재 (재적용?): new_pk=' + before.new_pk);

// ── 실 INSERT (persist — up.sql 본체 멱등) ─────────────────────────────────────
const valuesSQL = LINES.map((l) =>
  `('${l.pk}'::uuid,'${CHECKIN}'::uuid,'${l.svc}'::uuid,${sqlStr(l.name)},${l.price},${l.price},false,NULL,'${SELLER}'::uuid,'[]'::jsonb,false,false)`
).join(',\n    ');
console.log('\n▶ PROD APPLY (persist INSERT 3-row)…');
await runSQL(`
  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  SELECT v.id, v.check_in_id, v.service_id, v.service_name, v.price, v.original_price,
         v.a, v.b, v.seller_staff_id, v.k, v.kr, v.bt
  FROM (VALUES
    ${valuesSQL}
  ) AS v(id, check_in_id, service_id, service_name, price, original_price, a, b, seller_staff_id, k, kr, bt)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.check_in_services c
     WHERE c.check_in_id = v.check_in_id AND c.service_id = v.service_id AND c.price = v.price AND c.voided_at IS NULL
  )
  ON CONFLICT (id) DO NOTHING;
`);
console.log('✅ INSERT executed');

// ── evidence-based probe: after-state + 4 delta ───────────────────────────────
const after = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '${REV_DT}' AND clinic_id = '${CLINIC}') AS rev,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS cos,
    (SELECT count(*) FROM check_in_services WHERE id IN (${PK_LIST})) AS new_pk
`)).data[0];
out.after = after;
const d = { rev: Number(after.rev) - Number(before.rev), pay: Number(after.pay) - Number(before.pay), sc: Number(after.sc) - Number(before.sc), cos: Number(after.cos) - Number(before.cos) };
out.deltas = d;
console.log(`\n📊 PROBE DELTAS: rev=${d.rev} pay=${d.pay} sc=${d.sc} cos=${d.cos} | new_pk=${after.new_pk}`);
if (d.rev !== 0) die(`VG4(a) v_daily_revenue delta=${d.rev} (expect 0) — ROLLBACK 필요`);
if (d.pay !== 0) die(`VG4(b) payments delta=${d.pay} (expect 0) — ROLLBACK 필요`);
if (d.sc  !== 0) die(`VG4(c) service_charges delta=${d.sc} (expect 0) — ROLLBACK 필요`);
if (d.cos !== EXPECT_COS) die(`VG4(d) cosmetic breakdown delta=${d.cos} (expect ${EXPECT_COS})`);
if (Number(after.new_pk) !== 3) die(`신규 PK count=${after.new_pk} (expect 3)`);
console.log(`✅ 4-delta oracle ALL PASS (rev=0 · pay=0 · sc=0 · cos=+${EXPECT_COS}) + new_pk=3`);

// ── ledger: schema_migrations 기록 ────────────────────────────────────────────
await runSQL(`
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('20260810120000', 'foot_f4741_b7ab6496_cosmetic_cis_reinsert')
  ON CONFLICT (version) DO NOTHING;
`, { expectError: true });
console.log('✅ ledger: schema_migrations 20260810120000 recorded');

console.log('\n===== APPLY EVIDENCE =====');
console.log(J(out));
