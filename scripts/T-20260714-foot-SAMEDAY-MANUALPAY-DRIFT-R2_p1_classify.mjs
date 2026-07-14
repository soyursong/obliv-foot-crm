/**
 * R2 Phase1 — 대상 8행 고객 매핑 + 패키지 balance(미수) + 기존 payments/package_payments 대사.
 * B군 이중계상 판정: 허유희 F-4696 8,900(데스크) / 이재성 F-4702 350,000+8,900(병존).
 * SELECT only. write 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const out = {};

// (1) 고객 매핑: 대상 8행의 chart_number(trim/정규화) 또는 name 으로 customers 조회
out.customers = await q(`
  SELECT id, chart_number, name, phone, visit_type, created_at
  FROM customers
  WHERE clinic_id='${CLINIC}'
    AND ( btrim(chart_number) IN ('F-4564','F-4645','F-4642','F-4702','F-4643','F-4696')
          OR name IN ('허유진','김성애','노수옥','이멋진','이재성','황찬식','허유희') )
  ORDER BY name, chart_number;`);

// (2) 위 고객들의 패키지 balance (미수 상태)
out.packages = await q(`
  SELECT c.name, c.chart_number, p.id AS package_id, p.package_name, p.package_type,
         p.total_amount, p.paid_amount, (p.total_amount - p.paid_amount) AS balance, p.status, p.contract_date
  FROM packages p JOIN customers c ON c.id=p.customer_id
  WHERE p.clinic_id='${CLINIC}'
    AND c.name IN ('허유진','김성애','노수옥','이멋진','이재성','황찬식','허유희')
  ORDER BY c.name, p.created_at;`);

// (3) 기존 payments (single) — 대상 고객, 오늘 8,900/350,000 이미 원장 존재하는지 (double-count 대사)
out.payments = await q(`
  SELECT c.name, c.chart_number, p.id, p.amount, p.method, p.payment_type, p.memo, p.check_in_id, p.created_at
  FROM payments p JOIN customers c ON c.id=p.customer_id
  WHERE p.clinic_id='${CLINIC}'
    AND c.name IN ('이재성','허유희','김성애','허유진','노수옥','이멋진','황찬식')
  ORDER BY c.name, p.created_at;`);

// (4) 기존 package_payments — 대상 고객 (특히 이재성 350k 이 이미 pp로 있는지 / 허유희 F-4696 24회권 R1 canonical 확인)
out.package_payments = await q(`
  SELECT c.name, c.chart_number, pk.package_name, pp.id, pp.amount, pp.method, pp.payment_type, pp.memo, pp.created_at
  FROM package_payments pp
  JOIN packages pk ON pk.id=pp.package_id
  JOIN customers c ON c.id=pk.customer_id
  WHERE pk.clinic_id='${CLINIC}'
    AND c.name IN ('이재성','허유희')
  ORDER BY c.name, pp.created_at;`);

// (5) 김성애 동명이인 여부 (chart_no 특정)
out.kimsungae = await q(`
  SELECT id, chart_number, name, phone, visit_type, created_at FROM customers
  WHERE clinic_id='${CLINIC}' AND name='김성애' ORDER BY created_at;`);

console.log(JSON.stringify(out, null, 2));
