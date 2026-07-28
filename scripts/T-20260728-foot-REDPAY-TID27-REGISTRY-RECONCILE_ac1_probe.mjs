/**
 * T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE — AC-1 READ-ONLY 27-TID vs registry 대조 probe
 *
 * 원 요청(최필경 총괄 req2, MSG-20260728-171757-q6lh 재relay): 레드페이 조회 API 실측
 *   (457-23-00938 풋센터, 7/15~7/28) 전체 TID 27개를 현 registry(DB)와 1:1 대조.
 *
 * AC-1 (READ-ONLY, DA 무관 선행): 각 TID vs registry 대조표 —
 *   TID·대역·현장라벨(raw_payload.data 실측, 추측금지)·registry 상태(active / superseded(어느 신TID로) /
 *   absent)·최근거래 존재여부. → absent 목록 확정.
 *   ★absent + 최근거래 존재 = 매출 silent-drop 후보 → 즉시 planner FOLLOWUP + P0 승격.
 *
 * AC-3 HARD guard: 구대역 479xxx 13개 전부 admitted 유지 실측(active OR superseded_tids[] UNION).
 *   ⛔OL을 admit 대상에서 제외 금지. 취소거래(cancel) 실제 수집·표면화 샘플(479474/475).
 *
 * ⚠ SELECT-only. write 0. Supabase Management API READ. 무영속.
 * 실행: node scripts/T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE_ac1_probe.mjs
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

// ── 레드페이 조회 실측 27-set (총괄 req2, 457-23-00938 풋, 7/15~7/28) ──────────────
const TIDS = [
  // 구대역 1047479xxx (13) ★OL, 제거 금지
  '1047479153', '1047479158', '1047479471', '1047479472', '1047479473',
  '1047479474', '1047479475', '1047479477', '1047479478', '1047479479',
  '1047479480', '1047479481', '1047479483',
  // VAN 1047535xxx (6)
  '1047535797', '1047535835', '1047535837', '1047535842', '1047535843', '1047535845',
  // 신대역 1047538xxx (8)
  '1047538231', '1047538235', '1047538236', '1047538237', '1047538239',
  '1047538241', '1047538245', '1047538246',
];
const IN = `'${TIDS.join("','")}'`;
const VALUES = TIDS.map((t) => `('${t}')`).join(',');

// 뷰 resolver 정합 (0725GAP probe 계승): col tid → 중첩 data.tid
const RTID = `COALESCE(r.tid, r.raw_payload->'data'->>'tid')`;
const RMID = `COALESCE(r.raw_payload->'merchant'->>'id',   r.raw_payload->'data'->>'merchant_id')`;
const RNAME = `COALESCE(r.raw_payload->'merchant'->>'name', r.raw_payload->'data'->>'merchant_name')`;
const RBIZ = `COALESCE(r.raw_payload->'merchant'->>'bizNo', r.raw_payload->'data'->>'business_no')`;
const RAMT = `COALESCE(r.raw_payload->>'amount', r.raw_payload->'data'->>'amount')::numeric`;
const RSTATUS = `COALESCE(r.raw_payload->'data'->>'status', r.external_status)`;

console.log('=== T-20260728 REDPAY TID27 registry reconcile — AC-1 READ-ONLY probe ===');
console.log(`27-set 확증: ${TIDS.length}개 (구479:13 / VAN535:6 / 신538:8)\n`);

// ── Q0: registry foot 전체 현 상태 (참조) ──────────────────────────────────────
const regAll = await q(`
  SELECT merchant_id, tid, superseded_tids, terminal_label, active, domain
  FROM public.redpay_terminal_registry
  WHERE domain = 'foot'
  ORDER BY merchant_id;`);
console.log(`Q0 [registry foot 행 전체: ${regAll.length}행]`);
console.table(regAll);

// ── Q1: ★AC-1 대조표 — 27 TID 각각 registry 상태 (active/superseded/absent) ──────
const recon = await q(`
  WITH probe(tid) AS (VALUES ${VALUES}),
  reg_active AS (
    SELECT tid AS reg_tid, merchant_id, terminal_label, active
    FROM public.redpay_terminal_registry WHERE domain = 'foot'
  ),
  reg_sup AS (
    SELECT unnest(superseded_tids) AS sup_tid, tid AS current_tid, merchant_id, terminal_label
    FROM public.redpay_terminal_registry
    WHERE domain = 'foot' AND superseded_tids IS NOT NULL
  )
  SELECT
    p.tid,
    substr(p.tid,1,7) AS band,
    CASE
      WHEN ra.reg_tid IS NOT NULL THEN 'active'
      WHEN rs.sup_tid IS NOT NULL THEN 'superseded'
      ELSE 'absent'
    END AS registry_status,
    ra.merchant_id      AS active_merchant,
    ra.active           AS active_flag,
    rs.current_tid      AS superseded_to_tid,
    rs.merchant_id      AS superseded_merchant,
    COALESCE(ra.terminal_label, rs.terminal_label) AS registry_label
  FROM probe p
  LEFT JOIN reg_active ra ON ra.reg_tid = p.tid
  LEFT JOIN reg_sup    rs ON rs.sup_tid = p.tid
  ORDER BY p.tid;`);
console.log('\nQ1 [★AC-1 대조표 — 27 TID registry 상태]');
console.table(recon);

// ── Q2: 현장라벨(raw_payload.data 실측, 추측금지) + 최근거래(7/15~7/28) 존재 ────────
const raw = await q(`
  SELECT
    ${RTID}   AS resolved_tid,
    ${RMID}   AS merchant_id,
    ${RNAME}  AS merchant_name_raw,
    ${RBIZ}   AS biz_no,
    count(*)                            AS trx_count,
    sum(${RAMT})                        AS amt_sum,
    min(r.approved_at)                  AS first_approved,
    max(r.approved_at)                  AS last_approved
  FROM public.redpay_raw_transactions r
  WHERE ${RTID} IN (${IN})
  GROUP BY 1,2,3,4
  ORDER BY 1;`);
console.log('\nQ2 [현장라벨 raw_payload.data 실측 + raw 거래 존재 (전기간)]');
console.table(raw);

// ── Q2b: 최근거래 7/15~7/28 윈도우 (Asia/Seoul) 한정 카운트 ──────────────────────
const win = await q(`
  SELECT
    ${RTID} AS resolved_tid,
    count(*) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                           BETWEEN '2026-07-15' AND '2026-07-28') AS trx_win,
    max(r.approved_at) FILTER (WHERE (r.approved_at AT TIME ZONE 'Asia/Seoul')::date
                           BETWEEN '2026-07-15' AND '2026-07-28') AS last_win
  FROM public.redpay_raw_transactions r
  WHERE ${RTID} IN (${IN})
  GROUP BY 1
  ORDER BY 1;`);
console.log('\nQ2b [최근거래 7/15~7/28 윈도우 한정]');
console.table(win);

// ── Q3: ★AC-3 HARD guard — 구대역 479xxx 13개 admit 유지 (active ∪ superseded UNION) ──
const OLD479 = TIDS.filter((t) => t.startsWith('1047479'));
const admit = await q(`
  WITH probe(tid) AS (VALUES ${OLD479.map((t) => `('${t}')`).join(',')}),
  admitted AS (
    SELECT tid AS admit_tid FROM public.redpay_terminal_registry WHERE domain='foot' AND active
    UNION
    SELECT unnest(superseded_tids) FROM public.redpay_terminal_registry WHERE domain='foot' AND active
  )
  SELECT
    p.tid,
    (a.admit_tid IS NOT NULL) AS admitted
  FROM probe p
  LEFT JOIN admitted a ON a.admit_tid = p.tid
  ORDER BY p.tid;`);
console.log('\nQ3 [★AC-3 구대역 479xxx 13개 admit(active∪superseded UNION) 유지]');
console.table(admit);
const notAdmitted = admit.filter((r) => r.admitted === false || r.admitted === 'false');
console.log(`   구479 admit: ${admit.length - notAdmitted.length}/${admit.length}  →  ${notAdmitted.length === 0 ? '✅ 전건 admitted (OL 회귀 없음)' : `⛔ 미admit ${notAdmitted.length}건: ${notAdmitted.map((r) => r.tid).join(',')}`}`);

// ── Q4: 취소거래(cancel) 실 수집·표면화 샘플 (479474/479475) ─────────────────────
const cancel = await q(`
  SELECT
    ${RTID}    AS resolved_tid,
    ${RSTATUS} AS status,
    r.external_status,
    count(*)   AS cnt,
    sum(${RAMT}) AS amt_sum
  FROM public.redpay_raw_transactions r
  WHERE ${RTID} IN ('1047479474','1047479475')
  GROUP BY 1,2,3
  ORDER BY 1,2;`);
console.log('\nQ4 [취소거래 샘플 479474/479475 — external_status/status 분포]');
console.table(cancel);

// ── 판정 요약 ──────────────────────────────────────────────────────────────────
const absent = recon.filter((r) => r.registry_status === 'absent');
const rawTids = new Set(raw.map((r) => r.resolved_tid));
const winMap = Object.fromEntries(win.map((w) => [w.resolved_tid, Number(w.trx_win)]));
const silentDrop = absent.filter((r) => winMap[r.tid] > 0);

console.log('\n=== ★ 판정 요약 ===');
console.log(`absent 목록 (${absent.length}건): ${absent.map((r) => r.tid).join(', ') || '없음'}`);
console.log(`  ↳ 대역별 absent: ${['1047479','1047535','1047538'].map((b) => `${b}xxx=${absent.filter((r) => r.tid.startsWith(b)).length}`).join(' / ')}`);
console.log(`★ silent-drop 후보 (absent + 최근거래 7/15~28 존재) (${silentDrop.length}건): ${silentDrop.map((r) => `${r.tid}(${winMap[r.tid]}건)`).join(', ') || '없음'}`);
console.log(`  → ${silentDrop.length > 0 ? '⛔ P0 승격 요청 대상' : '✅ silent-drop 없음'}`);
console.log(`raw 미출현 TID (등록됐으나 7/15~28 거래 0): ${recon.filter((r) => !rawTids.has(r.tid)).map((r) => r.tid).join(', ') || '없음'}`);
