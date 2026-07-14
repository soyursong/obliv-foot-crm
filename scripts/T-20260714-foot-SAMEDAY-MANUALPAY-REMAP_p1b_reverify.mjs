/**
 * T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 1b READ-ONLY 재검증(재조회).
 * INFO MSG-wity "재조회 후 반영" 대응: 선행 Phase1 snapshot(13건 freeze) 이 현재도 유효한지 대사.
 *   (1) 현재 closing_manual_payments(2026-07-14) 목록 → snapshot 13건과 drift 확인
 *   (2) canonical 마커(T-20260714-SAMEDAY-REMAP) 사전 존재여부 → 타 세션 apply 여부(멱등/중복 감시)
 *   (3) 11개 대상 패키지 현재 balance → 아직 미수(paid_amount) 상태인지
 * SELECT only. write 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const out = {};

out.cmp_today = await q(`
  SELECT id, pay_time, chart_number, customer_name, amount, method, staff_name, memo, created_at
  FROM closing_manual_payments
  WHERE clinic_id='${CLINIC}' AND close_date='2026-07-14'
  ORDER BY created_at;
`);

out.canonical_marker_pp = await q(`
  SELECT id, package_id, amount, method, memo, created_at FROM package_payments
  WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%' ORDER BY created_at;
`);
out.canonical_marker_pay = await q(`
  SELECT id, customer_id, amount, method, memo, created_at FROM payments
  WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%' ORDER BY created_at;
`);

out.pkg_balance = await q(`
  SELECT id, package_name, total_amount, paid_amount, (total_amount - paid_amount) AS balance, status
  FROM packages WHERE id IN (
    'f84a95cd-ab07-4f83-8760-d941c46ed079','04feb879-afbf-4158-ba29-3dfaa39c0c3c',
    '3ba632cd-82ec-4abc-89ca-7ac2ca710286','1f7a61f1-f7d0-438b-adb6-620d203969db',
    '84808f19-c6c4-45d6-bf85-8e242b01bee4','a8d402ba-7763-4dd8-8f63-5fca23dc484c',
    '387c8f6a-f151-426d-ac56-96366188a2f4','24e02b64-84b0-4e44-82cd-670768340927',
    '692fb8d5-ce16-48c0-a25b-19c885757483','1637a08f-5d5a-4eab-bcb8-aea9b84253e1',
    '876e1a55-0545-4c5f-8591-75609be0bd06')
  ORDER BY package_name;
`);

// repro F-4652 진태주: canonical payments/package_payments 현황 + 패키지 balance
out.repro_f4652 = await q(`
  SELECT 'pkg' AS src, pp.amount, pp.memo, pp.created_at FROM package_payments pp
    WHERE pp.package_id='1f7a61f1-f7d0-438b-adb6-620d203969db'
  UNION ALL
  SELECT 'pay' AS src, p.amount, p.memo, p.created_at FROM payments p
    WHERE p.customer_id='3210644b-04a5-4f24-b425-c3d10ae87dc9';
`);

const cmpIds = out.cmp_today.map(r => r.id).sort();
const snapshotIds = [
  '804b6d72-cf9f-4827-9545-1aa126f59573','b674132c-b68f-4920-9b25-977527e39eb9',
  'a503218f-0d0a-4393-a771-a6ddf8a02173','dfd30a1a-1b6c-463d-a433-2d03c486c616',
  'f0f16293-d146-4bb1-a430-5547623a88d0','28e305ff-4e54-404c-b360-21336eb0508e',
  'a41079be-81eb-4874-949d-d6636974dae8','c3f9b8fd-58fe-4a38-a8c5-68aabf81f489',
  'bb54e3f4-30f1-4069-8aec-c5fe238a1359','832b75bc-1555-444c-8354-f3c1b5aba4df',
  'a226fb72-683a-4e74-abe5-b869c87eae1f','38a37a50-a9f4-44f3-b233-376345b4d3d7',
  '4e73d913-8bf4-4c9b-ae92-f76f3ac28055'].sort();
out.DRIFT = {
  cmp_count_now: out.cmp_today.length,
  snapshot_count: 13,
  missing_from_db: snapshotIds.filter(id => !cmpIds.includes(id)),
  new_in_db: cmpIds.filter(id => !snapshotIds.includes(id)),
  canonical_already_applied: out.canonical_marker_pp.length + out.canonical_marker_pay.length,
};
console.log(JSON.stringify(out, null, 2));
