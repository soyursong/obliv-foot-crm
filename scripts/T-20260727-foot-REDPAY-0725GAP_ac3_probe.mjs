/**
 * T-20260727-foot-REDPAY-WHITELIST-EXPAND-0725GAP — AC-3 / post-apply DoD probe (READ-ONLY)
 *
 * ★★ 2026-07-27 개정(DA CONSULT-REPLY MSG-20260727-091320-x9zf ★지적 #1 반영) ★★
 * ─────────────────────────────────────────────────────────────────────────────
 * evidence-validity trap 제거. 구 probe(73ad7bd9)는 post-apply DoD 신호로 부적합했음:
 *   · Q1 raw 조회를 `r.tid`(=NULL) OR `raw_payload->>'tid'`(top-level=NULL) 로만 함
 *     → 뷰가 실제로 읽는 중첩 `data.tid` 미확인 → raw 존재를 false-negative 로 놓칠 위험.
 *   · Q2b registry_hit 을 `reg.tid = r.tid`(=NULL) 로 조인 → remap 前後 모두 0 에 고착
 *     → 정상 remap 을 "실패"로 오판(false-negative).
 * ⇒ 웹훅 payload shape = 중첩: col tid=NULL / top raw_payload->>'tid'=NULL /
 *    data.tid=538235·538245 / data.merchant_id=289003·289008.
 *    뷰 resolver = COALESCE(r.tid, raw_payload->'data'->>'tid').
 *
 * ★ post-apply 검증 DoD (단일 권위 신호) = live 뷰 resolver 직접 질의:
 *     SELECT count(*) FROM public.v_redpay_reconciliation_daily
 *      WHERE tid IN ('1047538235','1047538245');
 *   · apply 前 = 0 (현 silent-drop 확인)  ·  apply 後 = 3 (소급 표면화 = 완전 수렴).
 *   registry_hit/raw-only 카운트를 성공신호로 쓰지 말 것.
 *
 * ★지적 #2 (recon scope 정합): remap 後 3행은 matched_payment_id=NULL 이라
 *   recon_status='missing_in_crm' 로 뜬다(정상 — recon 뷰는 VAN↔CRM 대조 read-layer, 매출원장 아님).
 *   (i) 대응 CRM payments 존재 → runMatcher(5분 cron, approval_no/tid/amount) 자동 링크 → matched 자가치유.
 *   (ii) payments 부재 → 'missing_in_crm' 이 정확한 상태(현장 결제등록 필요) = payments-원장 gap.
 *   어느 쪽이든 재-pull/backfill 불요(raw 이미 완전, datalake/Silver 매출은 payments 원장 파생).
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
// 뷰 resolver 와 동일: COALESCE(col tid, 중첩 data.tid)
const RESOLVED_TID = `COALESCE(r.tid, r.raw_payload->'data'->>'tid')`;

console.log('=== T-20260727 0725GAP post-apply DoD probe (DA x9zf 지적 #1 반영) ===\n');

// ★ DoD (단일 권위): live 뷰 resolver 직접 질의 — apply 前 0 / 後 3
const dod = await q(`
  SELECT count(*) AS surfaced
  FROM public.v_redpay_reconciliation_daily
  WHERE tid IN ('${TIDS.join("','")}');`);
const surfaced = Number(dod[0].surfaced);
console.log('★ DoD [live 뷰 v_redpay_reconciliation_daily 소급 표면화 카운트]:');
console.log(`   surfaced = ${surfaced}  (apply 前 기대=0 / apply 後 기대=3)`);
console.log(`   판정: ${surfaced === 3 ? '✅ REMAP 수렴(3) — DoD PASS' : surfaced === 0 ? '⏳ pre-apply(0) — remap 미적용 상태' : `⚠ 예상외(${surfaced}) — 재확인`}\n`);

// Q1: raw 원장 235/245 영속 여부 — ★중첩 data.tid resolver(구 probe false-negative 교정)
const raw = await q(`
  SELECT ${RESOLVED_TID}                                 AS resolved_tid,
         COALESCE(r.raw_payload->'merchant'->>'id',
                  r.raw_payload->'data'->>'merchant_id') AS merchant_id,
         count(*)                                        AS cnt,
         sum(COALESCE(r.raw_payload->>'amount',
                      r.raw_payload->'data'->>'amount')::numeric) AS amt,
         min(r.created_at)                               AS first_seen,
         max(r.created_at)                               AS last_seen
  FROM public.redpay_raw_transactions r
  WHERE ${RESOLVED_TID} IN ('${TIDS.join("','")}')
  GROUP BY 1,2 ORDER BY 1;`);
console.log('Q1 [raw 원장 235/245 영속 — 중첩 data.tid resolver, 행 있으면 재-pull 불요 확증]:');
console.table(raw);

// Q2: recon_status 분포 — ★지적 #2 (missing_in_crm=정상, matched=자가치유)
const rs = await q(`
  SELECT tid, recon_status, count(*) AS cnt
  FROM public.v_redpay_reconciliation_daily
  WHERE tid IN ('${TIDS.join("','")}')
  GROUP BY 1,2 ORDER BY 1,2;`);
console.log('\nQ2 [recon_status 분포 — missing_in_crm=정상(payments-원장 gap or runMatcher 대기), matched=자가치유]:');
console.table(rs);

// Q3: 289003/289008 registry 상태 (remap 반영 = tid 신 538xxx + 구 479xxx superseded)
const reg = await q(`
  SELECT merchant_id, tid, superseded_tids, terminal_label, domain, active
  FROM public.redpay_terminal_registry
  WHERE merchant_id IN ('1777289003','1777289008')
  ORDER BY merchant_id;`);
console.log('\nQ3 [registry — apply 後 tid=신538xxx / superseded_tids=구479xxx 편입 확인]:');
console.table(reg);

// Q4: merchant bizno 대역 (457 foot 정본 vs 511 body) — cross-tenant 무오염
const bizno = await q(`
  SELECT DISTINCT
    COALESCE(r.raw_payload->'merchant'->>'id',    r.raw_payload->'data'->>'merchant_id')   AS merchant_id,
    COALESCE(r.raw_payload->'merchant'->>'bizNo', r.raw_payload->'data'->>'business_no')   AS biz_no,
    COALESCE(r.raw_payload->'merchant'->>'name',  r.raw_payload->'data'->>'merchant_name') AS name
  FROM public.redpay_raw_transactions r
  WHERE ${RESOLVED_TID} IN ('${TIDS.join("','")}')
  ORDER BY 1;`);
console.log('\nQ4 [bizNo=457 foot 정본, body 511 아님 = cross-tenant 무오염]:');
console.table(bizno);

console.log('\n=== 판정 요약 ===');
console.log(`★ post-apply DoD (live 뷰): surfaced=${surfaced} / 기대 3  →  ${surfaced === 3 ? '✅ PASS' : surfaced === 0 ? '⏳ pre-apply' : '⚠'}`);
console.log(`  raw 영속(중첩 resolver): ${raw.length > 0 ? 'YES(재-pull 불요)' : 'NO'}`);
console.log('  주의: registry_hit/raw-only 카운트는 DoD 아님 — 오직 live 뷰 surfaced=3 이 성공신호(DA x9zf 지적 #1).');
