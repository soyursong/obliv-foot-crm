/**
 * T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI — VG1~VG5 READ-ONLY census probe
 *
 * *** READ-ONLY. prod write 0. SELECT-only. DA GO(조건부·verify-gated) 후 gate order:
 *     DA GO → SOP 봉투(VG1 archive-first + VG3 dry-run + VG4 acceptance oracle + 판정근거 스냅샷)
 *     → 박민지/총괄 per-row comp-gate → supervisor DB-GATE GO-token → dev apply.
 *     본 스크립트는 어떤 write 도 하지 않는다. apply_before_go 금지. ***
 *
 * DA SSOT: agents/docs/da_replies/da_decision_foot_heo4717_2e8f7aa5_cis_create_kimgyuri_20260809.md
 *
 * 확인 항목 (DA §5 VG1~VG5 매핑):
 *  VG1  archive-first — 부모 check_in c33dfc76 현 cis 스냅샷(=롤백 원본 before-image)
 *  VG2  freeze-set — c33dfc76(부모) + service e17ba3a3(CTB 15,000) + payment 2e8f7aa5(15,000)
 *  VG4  acceptance oracle baseline — (a) v_daily_revenue[2026-07-28] 현재값
 *       (b) payments count(2e8f7aa5 1건) (c) service_charges count(c33dfc76)
 *       (d) 김규리(3a0c6774) 화장품-판매자 breakdown 현재 합(CREATE 후 +15,000 예상)
 *       (e) c33dfc76 하 CTB(e17ba3a3) cis 부재 확인(=CREATE 대상·무→유)
 *  VG5  seller provenance — 김규리 동명이인 census(therapist 3a0c6774 vs admin d26717cb)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const URL = envVal('VITE_SUPABASE_URL') || envVal('SUPABASE_URL');
const KEY = envVal('SUPABASE_SERVICE_ROLE_KEY');
if (!URL || !KEY) { console.error('missing env'); process.exit(1); }

async function q(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) return { error: `${r.status} ${await r.text()}` };
  return { data: await r.json() };
}
async function qCount(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = r.headers.get('content-range'); // e.g. 0-0/1
  return { count: cr ? cr.split('/')[1] : null, status: r.status };
}

// full UUIDs (sibling VG evidence + ticket 확정)
const SERVICE_CTB = 'e17ba3a3-4842-4097-87bc-0778a64d2755';   // Care Toe Band (CTB) 15,000
const PAYMENT = '2e8f7aa5-3e83-4d4a-8900-ab1f0048694a';       // 15,000 card active
const SELLER_THERAPIST = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'; // 김규리 therapist (DA Q4 확정 seller)
const SELLER_ADMIN = 'd26717cb-2088-4cde-84d0-8fcd98367bbf';     // 김규리 admin (DA Q4 배제)

const out = { _meta: { ticket: 'T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI', mode: 'READ-ONLY', prod_write: 0 } };

// VG2 freeze — payment 2e8f7aa5 (→ check_in_id, customer_id, clinic_id 도출)
out.vg2_payment = await q(`payments?id=eq.${PAYMENT}&select=id,amount,status,payment_type,created_at,accounting_date,check_in_id,customer_id,clinic_id,parent_payment_id`);
const pay = out.vg2_payment.data && out.vg2_payment.data[0];
const CHECKIN = pay ? pay.check_in_id : null;

// VG2 freeze — 부모 check_in
out.vg2_checkin = CHECKIN ? await q(`check_ins?id=eq.${CHECKIN}&select=id,checked_in_at,clinic_id,customer_id,therapist_id,technician_id,visit_type,status`) : { error: 'no payment.check_in_id' };
const ci = out.vg2_checkin.data && out.vg2_checkin.data[0];

// VG2 freeze — service CTB
out.vg2_service_ctb = await q(`services?id=eq.${SERVICE_CTB}&select=id,name,price,category,category_label,active,clinic_id`);

// VG1 archive-first — 부모 check_in 현 cis 전체 스냅샷(before-image)
if (ci) {
  out.vg1_cis_snapshot = await q(`check_in_services?check_in_id=eq.${ci.id}&select=id,service_id,service_name,price,original_price,seller_staff_id,is_package_session,package_session_id,voided_at,created_at&order=created_at.asc`);
  // VG4(e) — CTB(e17ba3a3) cis 부재 확인(CREATE 대상)
  out.vg4e_ctb_cis_absent = await q(`check_in_services?check_in_id=eq.${ci.id}&service_id=eq.${SERVICE_CTB}&select=id`);
  // VG4(c) — service_charges count under c33dfc76 (CTB 명세 자동파생 0 baseline)
  out.vg4c_service_charges = await q(`service_charges?check_in_id=eq.${ci.id}&select=*`);
}

// VG4(b) — payments count: 2e8f7aa5 단건 유지 baseline (customer+CTB amount+date band)
if (ci) {
  out.vg4b_payments_customer = await qCount(`payments?customer_id=eq.${ci.customer_id}&amount=eq.15000&select=id`);
}

// VG4(a) — v_daily_revenue[2026-07-28] baseline (컬럼 introspection 후 date filter)
{
  const probe = await q(`v_daily_revenue?select=*&limit=1`);
  out._vdr_columns = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : probe;
  // 날짜 컬럼 후보 자동 탐색
  const cols = out._vdr_columns && Array.isArray(out._vdr_columns) ? out._vdr_columns : [];
  const dateCol = cols.find(c => /date|day|dt/.test(c));
  if (dateCol && ci) {
    out.vg4a_v_daily_revenue_0728 = await q(`v_daily_revenue?${dateCol}=eq.2026-07-28&clinic_id=eq.${ci.clinic_id}&select=*`);
    out.vg4a_v_daily_revenue_0728._dateCol = dateCol;
  } else {
    out.vg4a_v_daily_revenue_0728 = { note: 'date column not auto-detected', cols };
  }
}

// VG4(d) — 김규리(3a0c6774) 화장품-판매자 breakdown 현재 합
//   SalesStaffTab 산식: check_in_services(풋화장품) 버킷 COALESCE(seller_staff_id, therapist_id), voided_at IS NULL, price>0
if (ci) {
  // seller_staff_id = 3a0c6774 인 cis (직접 귀속분)
  out.vg4d_cis_seller_kimgyuri = await q(`check_in_services?seller_staff_id=eq.${SELLER_THERAPIST}&voided_at=is.null&price=gt.0&select=id,check_in_id,service_id,service_name,price&limit=200`);
}

// VG5 — 김규리 동명이인 census
if (ci) {
  out.vg5_kimgyuri = await q(`staff?clinic_id=eq.${ci.clinic_id}&name=eq.%EA%B9%80%EA%B7%9C%EB%A6%AC&select=id,name,role,active`);
}

// ── derived summary (VG4 baseline math) ──────────────────────────────
out._summary = {};
if (out.vg1_cis_snapshot && out.vg1_cis_snapshot.data) {
  out._summary.vg1_cis_rows = out.vg1_cis_snapshot.data.length;
  out._summary.vg1_cis_has_ctb = out.vg1_cis_snapshot.data.some(r => r.service_id === SERVICE_CTB);
}
out._summary.vg4e_ctb_absent = !!(out.vg4e_ctb_cis_absent && out.vg4e_ctb_cis_absent.data && out.vg4e_ctb_cis_absent.data.length === 0);
if (out.vg4c_service_charges && out.vg4c_service_charges.data) out._summary.vg4c_service_charges_count = out.vg4c_service_charges.data.length;
out._summary.vg4b_payments_15000_customer = out.vg4b_payments_customer && out.vg4b_payments_customer.count;
if (out.vg4a_v_daily_revenue_0728 && out.vg4a_v_daily_revenue_0728.data && out.vg4a_v_daily_revenue_0728.data[0]) {
  out._summary.vg4a_single_revenue_0728 = out.vg4a_v_daily_revenue_0728.data[0].single_revenue;
}
if (out.vg4d_cis_seller_kimgyuri && out.vg4d_cis_seller_kimgyuri.data) {
  const d = out.vg4d_cis_seller_kimgyuri.data;
  out._summary.vg4d_seller3a0c_cis_count = d.length;
  out._summary.vg4d_seller3a0c_cis_sum = d.reduce((s, r) => s + (r.price || 0), 0);
  out._summary.vg4d_c33dfc76_present = d.some(r => r.check_in_id === (ci && ci.id));
}
if (out.vg5_kimgyuri && out.vg5_kimgyuri.data) out._summary.vg5_kimgyuri_rows = out.vg5_kimgyuri.data;

console.log(JSON.stringify(out, null, 2));
