// DIAG probe2 — 승인 under-count 정밀: CRM payments 대조 + boundary + NULL행 domain 재확인
// READ-ONLY. service_role. PHI 위생(금액/시각/trxid tail/status만).
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const URL_ = env.VITE_SUPABASE_URL;
const FOOT = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const won = (n)=> n==null?'-':Number(n).toLocaleString('ko-KR');
const kst = (iso)=> iso? new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'-';
async function q(p){const r=await fetch(`${URL_}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error('❌',r.status,await r.text());return null;} return r.json();}

// ── payments 카드 18:05+ KST (CRM 수납측 = 현장 승인9 검증) ──
console.log('── payments 카드결제 18:05+ KST (CRM 수납측) ──');
const pays = await q(`payments?clinic_id=eq.${FOOT}&method=eq.card&payment_type=eq.payment&created_at=gte.2026-07-23T09:05:00.000Z&created_at=lt.2026-07-23T15:00:00.000Z&select=id,amount,status,created_at,reconciled_at,external_trxid&order=created_at.asc`);
if (pays){
  const live = pays.filter(p=>(p.status||'')!=='deleted');
  console.log(`  CRM 카드수납(비삭제) 18:05+: ${live.length}건, 합 ${won(live.reduce((a,p)=>a+Number(p.amount||0),0))}`);
  for (const p of live) console.log(`    ${kst(p.created_at)} · ${won(p.amount)} · status=${p.status} · reconciled=${p.reconciled_at?'Y':'-'} · trxid=${p.external_trxid?String(p.external_trxid).slice(-6):'-'}`);
}

// ── raw boundary 17:00~18:05 (현장 window 경계 오차 확인) ──
console.log('\n── raw 17:00~18:05 경계 (현장 18:05 기준선 검증) ──');
const bd = await q(`redpay_raw_transactions?clinic_id=eq.${FOOT}&approved_at=gte.2026-07-23T08:00:00.000Z&approved_at=lt.2026-07-23T09:05:00.000Z&select=approved_at,external_status,tid,amount,approval_no,raw_payload&order=approved_at.asc`);
if (bd){
  console.log(`  17:00~18:05 raw: ${bd.length}건`);
  for (const r of bd){ const mid=r?.raw_payload?.merchant?.id??'NULL'; console.log(`    ${kst(r.approved_at)} · mid=${mid} · tid=${r.tid??'NULL'} · ${r.external_status} · ${won(r.amount)} · appr=${r.approval_no}`);}
}

// ── NULL-merchant 행 raw_payload 구조 덤프 (payload-shape 원인 확인) ──
console.log('\n── NULL-merchant 승인행 raw_payload 키 구조 (payload-shape 진단) ──');
const nullrows = await q(`redpay_raw_transactions?clinic_id=eq.${FOOT}&approved_at=gte.2026-07-23T09:05:00.000Z&approved_at=lt.2026-07-23T15:00:00.000Z&external_status=eq.Y&select=approved_at,tid,amount,approval_no,raw_payload&order=approved_at.asc`);
if (nullrows){
  for (const r of nullrows){
    const mid=r?.raw_payload?.merchant?.id ?? null;
    const topKeys = r.raw_payload ? Object.keys(r.raw_payload).join(',') : '(payload null)';
    const merchantObj = r.raw_payload?.merchant ? JSON.stringify(r.raw_payload.merchant) : '(no merchant key)';
    console.log(`    ${kst(r.approved_at)} · ${won(r.amount)} · tid=${r.tid??'NULL'} · mid=${mid??'NULL'}`);
    console.log(`        payload keys: ${topKeys}`);
    console.log(`        merchant obj: ${merchantObj}`);
  }
}
console.log('\n진단 종료 (READ-ONLY, mutation 0)');
