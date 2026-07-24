#!/usr/bin/env node
// T-20260724-foot-REDPAY-DAY1-RECONCILE — 관측모드 Day-1(7/23) 웹훅구간 정밀대사
//   READ-ONLY 포렌식 (write/DDL/upsert 0). RAW DB 층(뷰 이전) 1:1 대조.
//   auth-context = Supabase Management API (service_role 권한, RLS 우회 → 실 raw 행 관측,
//     silent 0-row read 아님. Cross-CRM 진단 인증컨텍스트 표준 준수).
//
// AC1 18:05 KST+ 전체 approval_no 추출 (foot merchant/TID·business_no=457-23-00938 스코프)
// AC2 최필경 제공 9건과 1:1 대조 → 누락 2 + 초과 취소 1 특정
// AC3 18:05+ merchant_id 목록 + EF drop 코드경로 검증 근거(실통과 merchant_id 대조)
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

// 최필경 제공 9건 (실측 승인9 / 취소1)
const FIELD9 = ['56894018','62146905','63304014','22005414','29417129','23005414','30031451','30024628','116267542'];

// 18:05 KST = 09:05 UTC. 7/23 KST 전체 = 2026-07-22T15:00:00Z ~ 2026-07-23T14:59:59Z
const SQL = `
WITH base AS (
  SELECT
    id,
    approval_no,
    external_trxid,
    external_status,
    amount,
    approved_at,
    cancelled_at,
    received_at,
    -- webhook shape = raw_payload.data.merchant_id / poller shape = raw_payload.merchant.id
    COALESCE(raw_payload->'data'->>'merchant_id', raw_payload->'merchant'->>'id')     AS merchant_id,
    COALESCE(raw_payload->'data'->>'merchant_name', raw_payload->'merchant'->>'name') AS merchant_name,
    COALESCE(raw_payload->'data'->>'tid', raw_payload->>'tid')                        AS tid,
    COALESCE(raw_payload->>'_source', 'poller')                                       AS src,
    raw_payload->>'_mode'                 AS mode,
    COALESCE(approved_at, cancelled_at, received_at) AS event_ts
  FROM public.redpay_raw_transactions
  WHERE COALESCE(approved_at, cancelled_at, received_at)
        >= '2026-07-22T15:00:00Z'
    AND COALESCE(approved_at, cancelled_at, received_at)
        <  '2026-07-23T15:00:00Z'
)
SELECT * FROM base
ORDER BY event_ts;`;

const SQL_BIZ = `
SELECT DISTINCT raw_payload->'data'->>'business_no' AS business_no,
       count(*) AS n
FROM public.redpay_raw_transactions
WHERE COALESCE(approved_at, cancelled_at, received_at) >= '2026-07-22T15:00:00Z'
  AND COALESCE(approved_at, cancelled_at, received_at) <  '2026-07-23T15:00:00Z'
GROUP BY 1 ORDER BY 2 DESC;`;

const KST = (iso) => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) : null;

(async () => {
  const rows = await q(SQL);
  const biz = await q(SQL_BIZ);

  console.log('════════════════════════════════════════════════════════════');
  console.log('  T-20260724-foot-REDPAY-DAY1-RECONCILE — READ-ONLY 포렌식');
  console.log('  대상: redpay_raw_transactions / 7/23 KST 전체 (raw 층)');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`\n총 ${rows.length}행 (7/23 KST 전체구간). business_no 분포:`);
  for (const b of biz) console.log(`  business_no=${b.business_no ?? '∅'} : ${b.n}행`);

  const CUT = new Date('2026-07-23T09:05:00Z').getTime();
  const win = rows.filter(r => new Date(r.event_ts).getTime() >= CUT);

  console.log(`\n── [AC1] 18:05 KST+ 웹훅구간 스냅샷 (${win.length}행) ──`);
  console.log('idx | status | approval_no | trxid | amount | merchant_id | merchant_name | event_ts(KST) | src/mode');
  win.forEach((r, i) => {
    console.log(`${String(i+1).padStart(2)} | ${r.external_status} | ${String(r.approval_no ?? '∅').padStart(11)} | ${r.external_trxid} | ${String(r.amount).padStart(9)} | ${r.merchant_id ?? '∅'} | ${(r.merchant_name??'∅')} | ${KST(r.event_ts)} | ${r.src ?? '∅'}/${r.mode ?? '∅'}`);
  });

  const winY = win.filter(r => r.external_status === 'Y');
  const winN = win.filter(r => r.external_status === 'N' || r.external_status === 'X');
  console.log(`\n  18:05+ 승인(Y)=${winY.length}건 / 취소(N/X)=${winN.length}건`);
  console.log(`  승인 approval_no 셋: [${winY.map(r=>r.approval_no).join(', ')}]`);
  console.log(`  취소 approval_no 셋: [${winN.map(r=>r.approval_no+`(${r.amount}, mid=${r.merchant_id})`).join(', ')}]`);

  console.log(`\n── [AC2] 최필경 제공 9건 ↔ DB 승인(Y) 1:1 대조 ──`);
  const dbApprNos = new Set(winY.map(r => String(r.approval_no)));
  const allWinNos = new Set(win.map(r => String(r.approval_no)));
  console.log('field9 approval_no | DB 승인(Y) 존재? | DB 어디든 존재?');
  const missing = [];
  for (const a of FIELD9) {
    const inY = dbApprNos.has(a);
    const inAny = allWinNos.has(a);
    console.log(`  ${a.padStart(11)} | ${inY ? '✅ Y' : '❌ 누락'} | ${inAny ? 'O' : 'X'}`);
    if (!inY) missing.push(a);
  }
  console.log(`\n  ▶ 누락(field9 승인이나 DB Y 미존재) = ${missing.length}건: [${missing.join(', ')}]`);

  const extraY = winY.filter(r => !FIELD9.includes(String(r.approval_no)));
  console.log(`  ▶ DB 승인(Y) 중 field9 미포함(초과 승인) = ${extraY.length}건: [${extraY.map(r=>r.approval_no).join(', ')}]`);

  console.log(`\n  ▶ DB 취소(N/X) = ${winN.length}건 (field 실측 취소=1). 초과 취소 후보:`);
  winN.forEach(r => console.log(`     approval_no=${r.approval_no} amount=${r.amount} merchant_id=${r.merchant_id}(${r.merchant_name}) ts=${KST(r.event_ts)}`));

  console.log(`\n── [AC3] 18:05+ merchant_id 목록 + 센터 판정 ──`);
  const FOOT = new Set(["1777285001","1777285003","1777285004","1777285005","1777285006","1777285007","1777285008","1777288001","1777288003","1777288004","1777288005","1777288006","1777288008","1777289001","1777289002","1777289003","1777289004","1777289005","1777289006","1777289007","1777289008","1777289009","1777289010","1777289011","1777289012","1777289013"]);
  const BODY = new Set(["1777274001","1777275001","1777275002","1777275003","1777275004","1777275005","1777275006","1777275007","1777275008","1777276001","1777276002","1777276003","1777276004","1777276005"]);
  const center = (m) => FOOT.has(m) ? 'foot' : BODY.has(m) ? 'BODY(도수)' : 'unknown';
  const mids = {};
  for (const r of win) { const m = r.merchant_id ?? '∅'; mids[m] = mids[m] || {n:0, y:0, n2:0}; mids[m].n++; if (r.external_status==='Y') mids[m].y++; else mids[m].n2++; }
  console.log('merchant_id | 건수(Y/취소) | 센터판정');
  let bodyLeak = false;
  for (const [m, c] of Object.entries(mids)) {
    const ctr = center(m);
    if (ctr.startsWith('BODY')) bodyLeak = true;
    console.log(`  ${m} | ${c.n}(${c.y}/${c.n2}) | ${ctr}${ctr==='unknown'?' ⚠':''}${ctr.startsWith('BODY')?' 🔴 LEAK':''}`);
  }
  console.log(`\n  ▶ 도수(body) 혼입 판정: ${bodyLeak ? 'YES 🔴 (BODY merchant_id 적재됨)' : 'NO ✅ (적재 merchant 전량 foot/unknown)'}`);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  RAW JSON DUMP (재현용)');
  console.log('════════════════════════════════════════════════════════════');
  console.log(JSON.stringify({ total_723: rows.length, window_1805: win.length, rows: win.map(r=>({status:r.external_status,approval_no:r.approval_no,trxid:r.external_trxid,amount:r.amount,merchant_id:r.merchant_id,merchant_name:r.merchant_name,tid:r.tid,event_ts_kst:KST(r.event_ts),approved_at:r.approved_at,cancelled_at:r.cancelled_at,received_at:r.received_at,src:r.src,mode:r.mode})) }, null, 1));
})().catch(e => { console.error('ERR', e.http ?? '', e.message); process.exit(1); });
