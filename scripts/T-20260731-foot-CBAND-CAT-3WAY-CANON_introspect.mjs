/**
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD — LIVE PROD INTROSPECTION (READ-ONLY)
 *
 * 목적(3-way CANON zpas 확정 재검증 + MUST-VERIFY RC wnl0):
 *   1) payments 실 컬럼: external_approval_no/external_tid/external_trxid 존재 · pos_* 부재 확인.
 *      + payment_attempt_id / merchant_no / accounting_date / paid_at / is_simulation / method 존재여부.
 *   2) cband_payment_attempts 테이블 존재여부(신규 여부 판정).
 *   3) RC(wnl0): redpay_raw_transactions 구조(approval_no/tid/external_trxid) — CAT거래 RedPay 정산피드 출현 근거.
 *   4) schema_migrations 원장에 20260703183000(pos_*, 종이마이그) 기재여부.
 *
 * ⚠ SELECT / information_schema 조회만. write/DDL 0.  실행: node scripts/T-...-CANON_introspect.mjs
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
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

const p = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 1));

(async () => {
  // 1) payments 컬럼 (CAT 관련 후보 전량)
  const payCols = await q(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payments'
      AND column_name IN ('external_approval_no','external_tid','external_trxid','external_root_trxid','external_status',
        'reconciled_at','pos_provider','pos_transaction_id','pos_response','pg_provider','pg_transaction_id',
        'tid','merchant_no','payment_attempt_id','method','method_standard','paid_at','accounting_date','is_simulation','created_at')
    ORDER BY column_name;`);
  p('payments CAT-related columns (실재)', payCols);

  // 2) cband_payment_attempts 존재여부 + 컬럼
  const attemptTbl = await q(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cband_payment_attempts'
    ORDER BY ordinal_position;`);
  p('cband_payment_attempts columns (없으면 [] = 신규테이블)', attemptTbl);

  // 3) RC(wnl0): redpay_raw_transactions 구조 + 최근 CAT-band 출현 근거
  const rawCols = await q(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='redpay_raw_transactions'
      AND column_name IN ('approval_no','tid','external_trxid','external_status','amount','approved_at','matched_payment_id','merchant_id','raw_payload')
    ORDER BY column_name;`);
  p('redpay_raw_transactions 구조(RC wnl0 근거)', rawCols);

  // redpay_terminal_registry foot merchant/tid 수 (MERNO 격리 대사근거)
  const reg = await q(`
    SELECT count(*) AS n
    FROM information_schema.tables WHERE table_schema='public' AND table_name='redpay_terminal_registry';`);
  p('redpay_terminal_registry 존재', reg);

  // 4) schema_migrations 에 20260703183000(pos_* 종이마이그) 기재여부
  const mig = await q(`
    SELECT version FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260703183000','20260523040000','20260607190000','20260731190000')
    ORDER BY version;`).catch((e) => ({ error: String(e) }));
  p('schema_migrations 원장(pos_* 종이마이그 20260703183000 기재?)', mig);

  console.log('\n[introspect] DONE — write/DDL 0, READ-ONLY.');
})().catch((e) => { console.error('INTROSPECT FAIL:', e.message); process.exit(1); });
