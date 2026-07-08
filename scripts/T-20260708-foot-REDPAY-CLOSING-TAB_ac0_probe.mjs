// T-20260708-foot-REDPAY-CLOSING-TAB 선행1 — prod 스키마 실재 선검증
// PORT 마이그(20260607190000_pay_recon_port.sql) prod 적용 여부 확인.
// PostgREST(service_role) 로 테이블/뷰/컬럼 실재 probe. read-only.
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('missing env'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function tblExists(t) {
  const r = await fetch(`${URL_}/rest/v1/${t}?limit=1`, { headers: H });
  return { status: r.status, ok: r.ok };
}
async function colExists(table, cols) {
  // information_schema via RPC unavailable → select the columns directly
  const r = await fetch(`${URL_}/rest/v1/${table}?select=${cols.join(',')}&limit=1`, { headers: H });
  return { status: r.status, ok: r.ok, body: r.ok ? 'OK' : await r.text() };
}

console.log('=== 선행1: PORT 스키마 prod 실재 검증 ===');
for (const t of ['redpay_raw_transactions', 'payment_reconciliation_log', 'redpay_poller_state']) {
  const e = await tblExists(t);
  console.log(`  ${e.ok ? '✅ 있음' : '❌ 없음'} ${t}  (HTTP ${e.status})`);
}
console.log('=== payments external_* 컬럼 실재 ===');
const pc = await colExists('payments', ['external_trxid', 'external_status', 'external_root_trxid', 'external_approval_no', 'external_tid', 'reconciled_at']);
console.log(`  ${pc.ok ? '✅ 6종 존재' : '❌ 일부/전부 부재'}  (HTTP ${pc.status}) ${pc.ok ? '' : pc.body}`);
console.log('=== 기존 뷰 v_redpay_reconciliation_daily 실재(있으면 재적용) ===');
const v = await tblExists('v_redpay_reconciliation_daily');
console.log(`  ${v.ok ? '⚠️ 이미 있음' : '신규 대상(없음)'} v_redpay_reconciliation_daily (HTTP ${v.status})`);
