#!/usr/bin/env node
// T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX — build 선행 census (DA CONSULT-REPLY require)
//   목적: 7/23 shape-blind 탈락행(구 뷰 IN(...) 3치논리 탈락 → 신 뷰 COALESCE 로 표면화)의
//         _mode(observe/auto/폴러원본) 분포 census. observe 확정 시 guard 유해 확증(넣지 않음 판정).
//   READ-ONLY (write/DDL 0). auth = Supabase Management API(service_role, RLS 우회).
//   PHI 위생: 개별 trxid/approval_no/order_no/성명 미출력. 금액·mode·count 집계만(비-PII, ticket §근거).
import fs from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
function loadDotenv(p) {
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* noop */ }
}
loadDotenv('.env.local');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(text); e.http = r.status; throw e; }
  return JSON.parse(text);
}

// 7/23 KST = 2026-07-22T15:00:00Z ~ 2026-07-23T15:00:00Z
// 구 경로: merchant = raw_payload->'merchant'->>'id',  tid = r.tid
// 신 경로: merchant = COALESCE(merchant->id, data->>merchant_id), tid = COALESCE(r.tid, data->>tid)
const CENSUS_SQL = `
WITH reg_m AS (SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain='foot' AND active),
     reg_t AS (SELECT tid FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL),
     scoped AS (
       SELECT r.id,
              r.amount::numeric AS amount,
              r.external_status,
              COALESCE(r.raw_payload->>'_mode',
                       CASE WHEN r.raw_payload ? '_source' THEN '(_source,no_mode)' ELSE '(poller_origin)' END) AS mode_key,
              (r.raw_payload->'merchant'->>'id')                                        AS old_merchant,
              COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') AS new_merchant,
              r.tid                                                                     AS old_tid,
              COALESCE(r.tid, r.raw_payload->'data'->>'tid')                            AS new_tid
       FROM public.redpay_raw_transactions r
       WHERE r.approved_at >= '2026-07-22T15:00:00Z' AND r.approved_at < '2026-07-23T15:00:00Z'
     ),
     classed AS (
       SELECT *,
              (old_merchant IN (SELECT merchant_id FROM reg_m) AND old_tid IN (SELECT tid FROM reg_t)) AS old_pass,
              (new_merchant IN (SELECT merchant_id FROM reg_m) AND new_tid IN (SELECT tid FROM reg_t)) AS new_pass
       FROM scoped
     )
SELECT mode_key,
       count(*)                                            AS rows,
       count(*) FILTER (WHERE new_pass AND NOT old_pass)   AS newly_surfaced,
       count(*) FILTER (WHERE old_pass)                    AS already_surfaced,
       sum(amount) FILTER (WHERE new_pass AND NOT old_pass) AS newly_surfaced_amount
FROM classed
GROUP BY mode_key
ORDER BY mode_key;`;

// 신규표면화 행의 금액 목록(비-PII, ticket 명시 5건 8.7M/250k/260k/10k/20k 대조)
const AMOUNTS_SQL = `
WITH reg_m AS (SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain='foot' AND active),
     reg_t AS (SELECT tid FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL)
SELECT r.amount::numeric AS amount,
       r.external_status,
       COALESCE(r.raw_payload->>'_mode','(no_mode)') AS mode_key
FROM public.redpay_raw_transactions r
WHERE r.approved_at >= '2026-07-22T15:00:00Z' AND r.approved_at < '2026-07-23T15:00:00Z'
  AND (r.raw_payload->'merchant'->>'id') IS DISTINCT FROM 'x'  -- noop keep shape
  AND COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id') IN (SELECT merchant_id FROM reg_m)
  AND COALESCE(r.tid, r.raw_payload->'data'->>'tid') IN (SELECT tid FROM reg_t)
  AND NOT ( (r.raw_payload->'merchant'->>'id') IN (SELECT merchant_id FROM reg_m)
            AND r.tid IN (SELECT tid FROM reg_t) )
ORDER BY r.amount DESC;`;

(async () => {
  console.log('=== [CENSUS] 7/23 KST _mode 분포 (newly_surfaced = 신 뷰만 표면화) ===');
  const census = await q(CENSUS_SQL);
  console.table(census);
  console.log('\n=== [AMOUNTS] 신규표면화 행 금액·status·mode (비-PII, 5건 대조) ===');
  const amounts = await q(AMOUNTS_SQL);
  console.table(amounts);
  const total = amounts.length;
  const observe = amounts.filter((a) => a.mode_key === 'observe').length;
  console.log(`\n신규표면화 총 ${total}건 / observe ${observe}건 / non-observe ${total - observe}건`);
  console.log('판정: observe 다수 → guard 유해 확증(미포함). auto/폴러라도 판정 불변(guard 불요).');
})().catch((e) => { console.error('CENSUS FAIL:', e.message); process.exit(1); });
