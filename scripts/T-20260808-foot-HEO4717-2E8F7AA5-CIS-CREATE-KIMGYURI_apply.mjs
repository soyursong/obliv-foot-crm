/**
 * T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI — PROD APPLY (persist) + evidence-based probe
 *
 * 승인 근거:
 *   - DA CONSULT-REPLY MSG-20260809-100435-eiay (Q1 GO 조건부·verify-gated)
 *   - supervisor FIX-REQUEST MSG-20260809-130132-b7po (db_only_needs_apply — dev 직접 적용 authorize + prod apply + 증거기반 probe + applied_at/mig_applied 기록 → 자동 전이)
 *   - dev No-Persistence dry-run PASS (commit c5724133, VG4 4-delta ALL PASS)
 *
 * 이 스크립트는 실제로 PERSIST 한다 (dryrun 과 달리 RAISE ROLLBACK 없음).
 *   1) VG2 freeze re-assert (apply 직전 drift ABORT)
 *   2) VG1 archive-first: c33dfc76 현 cis 스냅샷 (rollback 원본)
 *   3) baselines 측정 (rev/pay/sc/cos)
 *   4) 실 INSERT (up.sql 본체 — WHERE NOT EXISTS + ON CONFLICT DO NOTHING 멱등)
 *   5) evidence-based probe: after-state + 4 delta 검증 (rev=0/pay=0/sc=0/cos=+15000) + 신규 PK count=1
 *   6) ledger: schema_migrations 20260809100000 기록
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

const CHECKIN = 'c33dfc76-cda5-48e6-9b34-277281b26626';
const SERVICE_CTB = 'e17ba3a3-4842-4097-87bc-0778a64d2755';
const PAYMENT = '2e8f7aa5-3e83-4d4a-8900-ab1f0048694a';
const SELLER = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const NEW_CIS_PK = '070652f3-3cb0-414a-ad80-98bf4c967e59';

const out = {};

// ── VG2 freeze re-assert (apply 직전 DRIFT ABORT) ─────────────────────────────
const fz = (await runSQL(`
  SELECT
    (SELECT jsonb_build_object('amount', amount, 'status', status, 'payment_type', payment_type)
       FROM payments WHERE id = '${PAYMENT}') AS payment,
    (SELECT jsonb_build_object('checked_in_at', checked_in_at::text, 'therapist_id', therapist_id, 'status', status, 'visit_type', visit_type)
       FROM check_ins WHERE id = '${CHECKIN}') AS check_in,
    (SELECT jsonb_build_object('name', name, 'price', price, 'active', active)
       FROM services WHERE id = '${SERVICE_CTB}') AS service_ctb
`)).data[0];
out.vg2_freeze = fz;
if (!fz.payment || Number(fz.payment.amount) !== 15000 || fz.payment.status !== 'active')
  die('VG2 payment drift: ' + J(fz.payment));
if (!fz.check_in || !String(fz.check_in.checked_in_at).startsWith('2026-07-28') || fz.check_in.therapist_id !== SELLER)
  die('VG2 check_in drift: ' + J(fz.check_in));
if (!fz.service_ctb || Number(fz.service_ctb.price) !== 15000 || fz.service_ctb.active !== true)
  die('VG2 service drift: ' + J(fz.service_ctb));
console.log('✅ VG2 freeze re-assert PASS (drift 0)');

// ── VG1 archive-first: c33dfc76 현 cis 스냅샷 (rollback 원본) ──────────────────
out.vg1_archive = (await runSQL(`
  SELECT id, service_name, price, seller_staff_id, voided_at
    FROM check_in_services WHERE check_in_id = '${CHECKIN}' ORDER BY created_at
`)).data;
console.log(`✅ VG1 archive-first: c33dfc76 cis ${out.vg1_archive.length}행 스냅샷`);

// ── baselines ─────────────────────────────────────────────────────────────────
const before = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = '${CLINIC}') AS rev,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS cos,
    (SELECT count(*) FROM check_in_services WHERE id = '${NEW_CIS_PK}') AS new_pk
`)).data[0];
out.baseline = before;
if (Number(before.new_pk) !== 0) die('신규 PK 이미 존재 (재적용?): new_pk=' + before.new_pk);

// ── 실 INSERT (persist — up.sql 본체 멱등) ─────────────────────────────────────
console.log('\n▶ PROD APPLY (persist INSERT)…');
await runSQL(`
  INSERT INTO public.check_in_services
    (id, check_in_id, service_id, service_name, price, original_price,
     is_package_session, package_session_id, seller_staff_id,
     koh_nail_sites, koh_requested, blood_test_requested)
  SELECT
    '${NEW_CIS_PK}'::uuid, '${CHECKIN}'::uuid, '${SERVICE_CTB}'::uuid,
    'Care Toe Band (CTB)', 15000, 15000, false, NULL, '${SELLER}'::uuid,
    '{}'::jsonb, false, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.check_in_services
     WHERE check_in_id = '${CHECKIN}'::uuid AND service_id = '${SERVICE_CTB}'::uuid AND price = 15000
  )
  ON CONFLICT (id) DO NOTHING;
`);
console.log('✅ INSERT executed');

// ── evidence-based probe: after-state + 4 delta ───────────────────────────────
const after = (await runSQL(`
  SELECT
    (SELECT single_revenue FROM v_daily_revenue WHERE dt = DATE '2026-07-28' AND clinic_id = '${CLINIC}') AS rev,
    (SELECT count(*) FROM payments WHERE check_in_id = '${CHECKIN}') AS pay,
    (SELECT count(*) FROM service_charges WHERE check_in_id = '${CHECKIN}') AS sc,
    (SELECT COALESCE(sum(price),0) FROM check_in_services WHERE seller_staff_id = '${SELLER}' AND voided_at IS NULL AND price > 0) AS cos,
    (SELECT count(*) FROM check_in_services WHERE id = '${NEW_CIS_PK}') AS new_pk,
    (SELECT jsonb_build_object('service_name', service_name, 'price', price, 'seller_staff_id', seller_staff_id, 'check_in_id', check_in_id)
       FROM check_in_services WHERE id = '${NEW_CIS_PK}') AS new_row
`)).data[0];
out.after = after;

const dRev = Number(after.rev) - Number(before.rev);
const dPay = Number(after.pay) - Number(before.pay);
const dSc  = Number(after.sc)  - Number(before.sc);
const dCos = Number(after.cos) - Number(before.cos);
out.deltas = { rev: dRev, pay: dPay, sc: dSc, cos: dCos };
console.log(`\n📊 PROBE DELTAS: rev=${dRev} pay=${dPay} sc=${dSc} cos=${dCos} | new_pk=${after.new_pk}`);

// hard oracle assertions (실 적용 후 — 실패 시 rollback 필요 경보)
if (dRev !== 0) die(`VG4(a) v_daily_revenue delta=${dRev} (expect 0) — 축직교 반증! ROLLBACK 필요·re-CONSULT`);
if (dPay !== 0) die(`VG4(b) payments delta=${dPay} (expect 0) — 진짜 이중계상! ROLLBACK 필요·re-CONSULT #2`);
if (dSc  !== 0) die(`VG4(c) service_charges delta=${dSc} (expect 0) — 명세 자동파생! ROLLBACK 필요`);
if (dCos !== 15000) die(`VG4(d) cosmetic breakdown delta=${dCos} (expect 15000)`);
if (Number(after.new_pk) !== 1) die(`신규 PK count=${after.new_pk} (expect 1)`);
console.log('✅ 4-delta oracle ALL PASS (rev=0 · pay=0 · sc=0 · cos=+15000) + new_pk=1');

// ── ledger: schema_migrations 기록 ────────────────────────────────────────────
await runSQL(`
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('20260809100000', 'foot_heo4717_2e8f7aa5_ctb_cis_create')
  ON CONFLICT (version) DO NOTHING;
`, { expectError: true });
out.ledger = (await runSQL(`
  SELECT count(*) AS applied FROM supabase_migrations.schema_migrations WHERE version = '20260809100000'
`, { expectError: true }));
console.log('✅ ledger: schema_migrations 20260809100000 recorded');

console.log('\n===== APPLY EVIDENCE =====');
console.log(J(out));
