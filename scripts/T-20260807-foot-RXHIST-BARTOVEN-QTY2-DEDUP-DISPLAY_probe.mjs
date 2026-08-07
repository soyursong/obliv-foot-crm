/**
 * T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY — READ-ONLY 진단 probe.
 * 목적: 바르토벤 수량2/건수 표시 결함의 실경로((a)dedup 과수렴 / (b)qty 미표기 / (c)대표+기타 숨김) 확정.
 *   canonical SSOT = form_submissions(form_key='rx_standard'). READ-ONLY(SELECT only). db_change=false.
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
const out = {};

// 1) 김병완 F-4741 고객 식별
out.cust = await q(`
  SELECT id, name, chart_number, is_simulation
  FROM customers
  WHERE chart_number ILIKE '%4741%' OR name = '김병완'
  ORDER BY chart_number LIMIT 10;
`);

// 2) 바르토벤 서비스(약 마스터) 코드 확인
out.bartoven_svc = await q(`
  SELECT service_code, name FROM services
  WHERE name ILIKE '%바르토벤%' OR service_code IN ('57001771','57001772')
  ORDER BY service_code;
`);

// 3) 김병완 rx_standard 발행 이력 — rx_items_html 원본 + 약품 파싱 대상
out.rx_subs = await q(`
  SELECT fs.id, fs.customer_id, fs.printed_at, fs.created_at, fs.is_deleted,
         fs.field_data->>'issue_date'   AS issue_date,
         fs.field_data->>'issue_no'     AS issue_no,
         fs.field_data->>'prescriber_name' AS prescriber,
         fs.field_data->>'rx_items_html' AS rx_items_html
  FROM form_submissions fs
  JOIN form_templates ft ON ft.id = fs.template_id
  WHERE ft.form_key = 'rx_standard'
    AND fs.customer_id IN (
      SELECT id FROM customers WHERE chart_number ILIKE '%4741%' OR name='김병완'
    )
  ORDER BY fs.printed_at DESC NULLS LAST
  LIMIT 50;
`);

// 4) 바르토벤이 든 rx_items_html 이 있는 발행건(전 고객) — 동일 약 복수행/수량 케이스 표본
out.bartoven_any = await q(`
  SELECT fs.id, fs.customer_id,
         fs.field_data->>'issue_date' AS issue_date,
         fs.field_data->>'rx_items_html' AS rx_items_html
  FROM form_submissions fs
  JOIN form_templates ft ON ft.id = fs.template_id
  WHERE ft.form_key = 'rx_standard'
    AND fs.is_deleted = false
    AND fs.field_data->>'rx_items_html' ILIKE '%바르토벤%'
  ORDER BY fs.printed_at DESC NULLS LAST
  LIMIT 15;
`);

import { writeFileSync } from "node:fs"; writeFileSync("/tmp/rxprobe.json", JSON.stringify(out)); console.log("wrote /tmp/rxprobe.json", "rx_subs="+out.rx_subs.length, "bartoven_any="+out.bartoven_any.length);
