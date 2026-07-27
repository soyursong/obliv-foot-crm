/**
 * T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP — AC-3 READ-ONLY 실측 probe
 *
 * 목적(MSG-085030-jt1n INFO §3, 총괄 dvf1 우려): "과거거래 재수집 필요? 뷰가 인라인 파생이
 *   아니라 별도 pull 필요 가능성" — 가정 금지, 실측 판정.
 *   Q1) 235/245 raw 거래가 redpay_raw_transactions 에 이미 영속되어 있나? (있으면 재-pull 불요)
 *   Q2) 뷰 표면화 현재 0 (silent-drop) = view tid-membership 필터 탓인가 (ingestion drop 아님)?
 *   Q3) 289003/289008 registry 旣등록 + 구 tid 세대(479477/479482)/superseded=NULL 재확인 (mechanic=remap).
 *   Q4) merchant band bizno = 457(foot 정본) — cross-tenant(body 511) 무오염.
 *
 * ⚠ SELECT-only. write 0. Management API READ.
 * 실행: node scripts/T-20260727-foot-REDPAY-0725GAP_ac3_probe.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const TIDS = ['1047538235', '1047538245'];

console.log('=== T-20260727 0725GAP AC-3 READ-ONLY probe ===\n');

// Q1+Q2: raw 원장에 235/245 거래가 영속되어 있나? (ingestion drop 아님 확증)
const raw = await q(`
  SELECT r.tid,
         (r.raw_payload->'merchant'->>'id')  AS merchant_id,
         count(*)                            AS cnt,
         sum((r.raw_payload->>'amount')::numeric) AS amt,
         min(r.created_at)                   AS first_seen,
         max(r.created_at)                   AS last_seen
  FROM public.redpay_raw_transactions r
  WHERE r.tid IN ('${TIDS.join("','")}')
     OR (r.raw_payload->>'tid') IN ('${TIDS.join("','")}')
  GROUP BY 1,2 ORDER BY 1;`);
console.log('Q1/Q2 [raw 원장 235/245 영속 여부] — 행 있으면 ingestion-persist 확증(재-pull 불요):');
console.table(raw);

// Q2b: 현재 recon 뷰가 235/245를 표면화하는가? (0 이면 view-filter silent-drop)
const surfaced = await q(`
  SELECT r.tid, count(*) AS raw_cnt,
         count(*) FILTER (WHERE reg.tid IS NOT NULL) AS registry_hit
  FROM public.redpay_raw_transactions r
  LEFT JOIN public.redpay_terminal_registry reg
    ON (reg.tid = r.tid OR r.tid = ANY(reg.superseded_tids))
   AND reg.domain = 'foot' AND reg.active
  WHERE r.tid IN ('${TIDS.join("','")}')
  GROUP BY 1 ORDER BY 1;`);
console.log('\nQ2b [registry_hit=0 → view tid-membership 미편입 = silent-drop 원인이 view-filter]:');
console.table(surfaced);

// Q3: 289003/289008 registry 旣등록 + 구 tid + superseded 상태 (mechanic=remap 확정)
const reg = await q(`
  SELECT merchant_id, tid, superseded_tids, label, domain, active, bizno
  FROM public.redpay_terminal_registry
  WHERE merchant_id IN ('1777289003','1777289008')
  ORDER BY merchant_id;`);
console.log('\nQ3 [289003/289008 旣등록·구 tid·superseded=NULL → mechanic=superseded-remap UPDATE]:');
console.table(reg);

// Q4: merchant bizno 대역 (457 foot vs 511 body) — cross-tenant 무오염
const bizno = await q(`
  SELECT DISTINCT (r.raw_payload->'merchant'->>'id') AS merchant_id,
         (r.raw_payload->'merchant'->>'bizNo')       AS biz_no,
         (r.raw_payload->'merchant'->>'name')        AS name
  FROM public.redpay_raw_transactions r
  WHERE r.tid IN ('${TIDS.join("','")}')
  ORDER BY 1;`);
console.log('\nQ4 [bizNo=457-23-00938 → foot 정본, body 511 아님 = cross-tenant 무오염]:');
console.table(bizno);

console.log('\n=== 판정 요약 ===');
const rawPresent = raw.length > 0;
const noRegistryHit = surfaced.every((s) => Number(s.registry_hit) === 0);
console.log(`AC-3: raw 영속=${rawPresent ? 'YES(재-pull 불요)' : 'NO(재-pull 필요!)'} · registry_hit=0(view-filter drop)=${noRegistryHit}`);
console.log('결론:', rawPresent && noRegistryHit
  ? 'seed(remap)만으로 뷰 소급 표면화 — backfill/재-pull 불요 (총괄 우려 REFUTED, 기존 AC CONFIRMED)'
  : '★분기 재검토 필요 — 아래 데이터로 DA 판정');
