#!/usr/bin/env node
// T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX — 무영속 dry-run + 검증
//   (1) 컬럼 시그니처 byte-동일 (BEFORE prod == AFTER dry-run) — 3뷰 + freshness fn 반환.
//   (2) 무영속: migration 을 BEGIN;...;ROLLBACK 로 실행 → prod 미영속(post-probe 로 확증).
//   (3) 회귀: 기존 정규화 shape 표면화 행 수 불변(≥ BEFORE, 감소 0).
//   (4) dedup: row_id 중복 0 (Part A 단일스캔 + UNIQUE 제약).
//   (5) 효능: 3 신규TID(1047535xxx) 를 tx 내 임시 seed 시 웹훅shape 5행 표면화(COALESCE 검증) → ROLLBACK.
//   READ/무영속 only. auth = Supabase Management API(service_role).
import fs from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
for(const line of fs.readFileSync('.env.local','utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();}
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){console.error('SUPABASE_ACCESS_TOKEN 필요');process.exit(1);}
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok){const e=new Error(t);e.http=r.status;throw e;}return JSON.parse(t);}

const MIG = fs.readFileSync('supabase/migrations/20260724190000_redpay_view_payload_shape_coalesce.sql','utf8');
// 안전: 내장 txn 제어문(COMMIT/BEGIN/ROLLBACK) 없음을 확인(No-Persistence Protocol).
if(/\b(commit|begin|rollback)\b/i.test(MIG.replace(/--.*$/gm,''))){console.error('ABORT: migration 에 txn 제어문 내장(무영속 위반 위험)');process.exit(1);}

const SIG_SQL = `
SELECT json_build_object(
  'views', (SELECT json_agg(row_to_json(x) ORDER BY x.table_name, x.ordinal_position) FROM (
      SELECT table_name, ordinal_position, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN
        ('v_redpay_reconciliation_daily','v_receipt_settlement_daily','v_redpay_unclassified_merchants')
    ) x),
  'func', (SELECT json_agg(row_to_json(y)) FROM (
      SELECT proname, pg_get_function_result(oid) AS result, pg_get_function_arguments(oid) AS args
      FROM pg_proc WHERE proname='get_redpay_feed_freshness'
    ) y)
) AS sig`;

(async()=>{
  // ── (1) BEFORE signatures (prod 현행) ──
  const before = (await q(SIG_SQL))[0].sig;

  // ── (2)+(1-after) 무영속 dry-run: migration → AFTER 시그니처 캡처 → ROLLBACK ──
  const afterRes = await q(`BEGIN;\n${MIG}\n${SIG_SQL};\nROLLBACK;`);
  const after = afterRes[0].sig;

  const beforeStr = JSON.stringify(before);
  const afterStr = JSON.stringify(after);
  const sigOK = beforeStr === afterStr;
  console.log(`\n[V1] 컬럼 시그니처 byte-동일 : ${sigOK ? 'PASS ✅' : 'FAIL ❌'}`);
  if(!sigOK){
    console.log('  BEFORE:', beforeStr);
    console.log('  AFTER :', afterStr);
  } else {
    console.log(`  views 컬럼 ${before.views.length}개 + func 반환 시그니처 불변.`);
  }

  // ── (2b) post-probe: 무영속 확증 — dry-run 후 prod 뷰 정의에 COALESCE data.merchant_id 미포함 ──
  const post = await q(`SELECT (pg_get_viewdef('public.v_redpay_reconciliation_daily'::regclass) LIKE '%data%merchant_id%') AS has_coalesce`);
  const noPersist = post[0].has_coalesce === false;
  console.log(`[V2] 무영속(post-probe: prod 뷰 미변경) : ${noPersist ? 'PASS ✅' : 'FAIL ❌'}`);

  // BEFORE total (구 뷰, prod 현행) — 참고
  const beforeTotal = (await q(`SELECT count(*) AS n FROM public.v_redpay_reconciliation_daily`))[0].n;

  // ── (3)+(4) 회귀(superset)/dedup: migration-only → ROLLBACK ──
  //   회귀 정의 = 기존 표면화행이 하나도 사라지지 않음(dropped=0). read-broadening 은 의도(added≥0 정상).
  //   old-view 키를 temp 에 스냅샷 후 migration 적용 → EXCEPT 로 dropped/added 산출.
  const REG_TXN = `BEGIN;
CREATE TEMP TABLE _oldk AS SELECT row_id, anchor FROM public.v_redpay_reconciliation_daily;
${MIG}
SELECT json_build_object(
  'before_n',    (SELECT count(*) FROM _oldk),
  'after_n',     (SELECT count(*) FROM public.v_redpay_reconciliation_daily),
  'dropped',     (SELECT count(*) FROM (SELECT row_id,anchor FROM _oldk EXCEPT SELECT row_id,anchor FROM public.v_redpay_reconciliation_daily) d),
  'added',       (SELECT count(*) FROM (SELECT row_id,anchor FROM public.v_redpay_reconciliation_daily EXCEPT SELECT row_id,anchor FROM _oldk) a),
  'dup_row_ids', (SELECT count(*) FROM (SELECT row_id, anchor FROM public.v_redpay_reconciliation_daily GROUP BY row_id, anchor HAVING count(*)>1) g)
) AS r;
ROLLBACK;`;
  const reg = (await q(REG_TXN))[0].r;

  // ── (5) 효능: migration + 신규TID 임시 whitelist(UPDATE) → 웹훅shape 5행 표면화 검증 → ROLLBACK ──
  //   UPDATE 는 구 tid 를 신 tid 로 교체(=cause b whitelist-expand 시뮬). old-tid 행 이탈은 효능검증과 무관(별 tx).
  const EFF_TXN = `BEGIN;
${MIG}
UPDATE public.redpay_terminal_registry SET tid='1047535837' WHERE merchant_id='1777285005';
UPDATE public.redpay_terminal_registry SET tid='1047535842' WHERE merchant_id='1777285003';
UPDATE public.redpay_terminal_registry SET tid='1047535797' WHERE merchant_id='1777285007';
SELECT json_build_object(
  'webhook_5_surfaced', (SELECT count(*) FROM public.v_redpay_reconciliation_daily
                          WHERE anchor='redpay'
                            AND approved_at >= '2026-07-22T15:00:00Z' AND approved_at < '2026-07-23T15:00:00Z'
                            AND external_status='Y'
                            AND tid IN ('1047535837','1047535842','1047535797')),
  'webhook_5_amount',   (SELECT sum(van_amount) FROM public.v_redpay_reconciliation_daily
                          WHERE anchor='redpay'
                            AND approved_at >= '2026-07-22T15:00:00Z' AND approved_at < '2026-07-23T15:00:00Z'
                            AND tid IN ('1047535837','1047535842','1047535797'))
) AS r;
ROLLBACK;`;
  const eff = (await q(EFF_TXN))[0].r;

  const v3 = Number(reg.dropped)===0;
  console.log(`[V3] 회귀(superset, dropped=0)  : before=${reg.before_n} after=${reg.after_n} / dropped=${reg.dropped} added=${reg.added} ${v3?'PASS ✅':'FAIL ❌'}`);
  console.log(`     (dropped=0 → 기존 표면화행 소실 0. added=${reg.added} → registry-내 웹훅shape 실거래 신규 표면화 = 의도된 broadening)`);
  console.log(`[V4] dedup(row_id 중복 0)      : ${reg.dup_row_ids}건 ${Number(reg.dup_row_ids)===0?'PASS ✅':'FAIL ❌'}`);
  console.log(`[V5] 효능(웹훅shape 5행 표면화, 신규TID whitelist 시뮬): ${eff.webhook_5_surfaced}건 / 금액 ${eff.webhook_5_amount} ${Number(eff.webhook_5_surfaced)===5?'PASS ✅':'FAIL ❌'}`);
  console.log(`     (5=8.7M+260k+250k+20k+10k=9,240,000 기대. 실 prod 는 cause(b) T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP 로 신규TID whitelist 후 표면화)`);

  const allPass = sigOK && noPersist && v3 && Number(reg.dup_row_ids)===0 && Number(eff.webhook_5_surfaced)===5;
  void beforeTotal;
  console.log(`\n=== DRY-RUN ${allPass?'ALL PASS ✅ — 배포 안전':'FAIL ❌ — 배포 중단'} ===`);
  if(!allPass) process.exit(1);
})().catch((e)=>{console.error('DRYRUN FAIL:',e.message);process.exit(1);});
