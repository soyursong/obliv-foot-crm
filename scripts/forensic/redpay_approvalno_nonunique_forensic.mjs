#!/usr/bin/env node
// T-20260728-foot-REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD
// AC-1/AC-2 read-only forensic — approval_no 전역-비유일 오링크(false-merge) 감사.
//   근거: 코밴 공식회신(2026-07-28) "승인번호=카드사 발급값, 중복 가능, 고유값 아님".
//   전역 유일키 = trxid (구조 K+tid+YYMMDDhhmmss+approval_no, 충돌 구조적 불가).
// 실행: node scripts/forensic/redpay_approvalno_nonunique_forensic.mjs
// 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT). READ-ONLY (SELECT only).
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOK=(process.env.SUPABASE_ACCESS_TOKEN||env.SUPABASE_ACCESS_TOKEN||'').trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};
// AC-1: 실제 링크가 어느 tier로 성립했는지 (approval_no-alone tier0 노출 여부)
out.tier_dist = await q(`SELECT match_rule, count(*) n FROM public.redpay_raw_transactions WHERE matched_payment_id IS NOT NULL GROUP BY match_rule ORDER BY n DESC;`);
// AC-2: tier0_direct 링크 중 amount/KST-date 불일치(false-merge 지문)
out.tier0_falsemerge = await q(`
  WITH t0 AS (SELECT r.amount raw_amt, p.amount pay_amt, r.approved_at, p.created_at
              FROM public.redpay_raw_transactions r JOIN public.payments p ON p.id=r.matched_payment_id
              WHERE r.match_rule='tier0_direct')
  SELECT count(*) tier0_links,
         count(*) FILTER (WHERE raw_amt<>pay_amt OR (approved_at+interval '9 hour')::date<>(created_at+interval '9 hour')::date) suspect_falsemerge
  FROM t0;`);
// AC-1 표면적: approval_no 전역-비유일 실재(같은 approval_no ↔ 복수 trxid)
out.dup_all = await q(`
  WITH z AS (SELECT approval_no, count(DISTINCT external_trxid) dtrx, count(DISTINCT amount) damt, count(DISTINCT tid) dtid
             FROM public.redpay_raw_transactions WHERE approval_no IS NOT NULL GROUP BY approval_no)
  SELECT count(*) FILTER (WHERE dtrx>1) multi_trx, count(*) FILTER (WHERE dtrx>1 AND damt>1) diff_amt, count(*) FILTER (WHERE dtrx>1 AND dtid>1) diff_tid FROM z;`);
// AC-2: Tier0 진입면 — 스태프 수기 external_approval_no 입력 payments
out.tier0_surface = await q(`SELECT count(*) pays_with_ext_approval, count(*) FILTER (WHERE external_trxid IS NULL AND reconciled_at IS NULL) unmatched_surface FROM public.payments WHERE external_approval_no IS NOT NULL;`);
console.log(JSON.stringify(out,null,2));
