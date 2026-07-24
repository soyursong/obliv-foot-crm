/**
 * T-20260724-foot-SOGYEONSEO-SONJA-DIAGDATE-FIX — R2 재진단 프로브 (READ-ONLY)
 * 목적: 손정아(F-4673) 소견서 발행본의 final_text 안에서 '진단일'이 어떻게 각인되는지 확인.
 *   → 발행 폼의 [날짜](docDate, editable) 경로로 각인되는지, 아니면 오늘 고정인지 판정(A/B 분기 근거).
 * author: dev-foot / 2026-07-24
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

// 1) 손정아 F-4673 customer 식별
out.customer = await q(`
  SELECT id, chart_number, name, birth_date
  FROM customers
  WHERE chart_number = 'F-4673'
  LIMIT 5;
`);

// 1b) opinion_doc 템플릿 id + [날짜]/진단일 마커 유무 (needsDate 근거)
out.template = await q(`
  SELECT id, form_key,
         (field_map::text LIKE '%[날짜]%')  AS template_has_date_marker,
         (field_map::text LIKE '%진단일%')   AS template_has_diagdate_label
  FROM form_templates
  WHERE form_key = 'opinion_doc'
  LIMIT 5;
`);

// 2) 해당 고객 opinion_doc 발행본 전체 (final_text 안 진단일 각인 확인)
out.opinion_docs = await q(`
  SELECT fs.id, fs.status, fs.created_at, fs.template_id,
         (fs.field_data->>'doc_type')      AS doc_type,
         (fs.field_data->>'published_at')  AS published_at,
         (fs.field_data->>'issue_date')    AS issue_date_fd,
         left(fs.field_data->>'final_text', 1400) AS final_text_head
  FROM form_submissions fs
  JOIN customers c ON c.id = fs.customer_id
  WHERE c.chart_number = 'F-4673'
    AND fs.template_id IN (SELECT id FROM form_templates WHERE form_key='opinion_doc')
  ORDER BY fs.created_at DESC
  LIMIT 10;
`);

console.log(JSON.stringify(out, null, 2));
