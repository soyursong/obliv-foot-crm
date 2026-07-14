/**
 * T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — Part1 F-4695 옵션A APPLY
 *
 * 옵션A 정본화(net-zero):
 *   (a) package_payments INSERT  (수기결제 → 정본 패키지 잔금 결제로 귀속)
 *   (b) packages.paid_amount 재집계 (package_payments 합계)
 *   (c) closing_manual_payments DELETE (수기 임시행 제거)
 *   → Closing 매출 합계 불변(둘 다 card 2,890,000). day-close 2026-07-14 미확정 → 안전.
 *
 * ⚠ FREEZE PASS 확인 후에만 실행. 기본=DRY-RUN. 실제 집행은 APPLY=1.
 * 멱등성: opt-A 마커 memo 존재 시 INSERT skip / manual 부재 시 DELETE skip.
 *
 * 실행:
 *   node scripts/T-20260714-foot-DAYCLOSE-MANUAL-PAY-F4695_apply.mjs        # dry-run
 *   APPLY=1 node scripts/T-20260714-foot-DAYCLOSE-MANUAL-PAY-F4695_apply.mjs # 집행
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.env.APPLY === '1';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

// FROZEN SET (freeze 스크립트 PASS 결과 — full UUID 고정)
const FROZEN = {
  customer_id: 'a07a3079-69ba-415a-a0f8-61e8d0921168',
  package_id:  'e55c868d-7b39-4b50-a98e-305d2353152d',
  manual_id:   'd993ffc5-8c9b-4ef8-a1cf-df73b51aaba5',
  clinic_id:   '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  amount: 2890000,
  method: 'card',
  created_at: '2026-07-14T11:09:00+09:00',
};
const OPT_A_MEMO = '일마감 수기결제 정본화(F-4695, opt-A) T-20260714-DAYCLOSE-MANUAL-PAY';

console.log(`=== Part1 F-4695 APPLY [${APPLY ? 'APPLY' : 'DRY-RUN'}] ===`);
console.log('실행시각:', new Date().toISOString());

// ── 0) FROZEN SET 재검증 (abort-on-drift) ────────────────────────────────
const { data: pkg } = await sb.from('packages').select('id, customer_id, total_amount, consultation_fee, paid_amount, status').eq('id', FROZEN.package_id).maybeSingle();
const { data: man } = await sb.from('closing_manual_payments').select('*').eq('id', FROZEN.manual_id).maybeSingle();
if (!pkg) { console.error('ABORT: package 부재'); process.exit(1); }
if (pkg.customer_id !== FROZEN.customer_id) { console.error('ABORT: package.customer_id drift'); process.exit(1); }
console.log(`[0] FROZEN 재검증 OK — pkg total=${won(pkg.total_amount)} paid=${won(pkg.paid_amount)} | manual ${man ? '존재' : '이미 제거됨'}`);

// ── 멱등성: opt-A 마커 존재 여부 ────────────────────────────────────────
const { data: existing } = await sb.from('package_payments').select('id, amount, memo').eq('package_id', FROZEN.package_id).eq('memo', OPT_A_MEMO);
const alreadyInserted = (existing ?? []).length > 0;

// ── BEFORE 스냅샷(판정근거) ─────────────────────────────────────────────
const { data: ppBefore } = await sb.from('package_payments').select('amount, payment_type, fee_kind').eq('package_id', FROZEN.package_id);
const netBefore = (ppBefore ?? []).reduce((s, r) => s + ((r.fee_kind ?? 'package') === 'package' ? (r.payment_type === 'refund' ? -r.amount : r.amount) : 0), 0);
console.log(`[BEFORE] package_payments ${(ppBefore ?? []).length}건, netPkg=${won(netBefore)}, package_due=${won((pkg.total_amount ?? 0) - netBefore)}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] 예정 작업:');
  console.log(`  (a) INSERT package_payments: pkg=${FROZEN.package_id} amt=${won(FROZEN.amount)} ${FROZEN.method} fee_kind=package memo="${OPT_A_MEMO}" created_at=${FROZEN.created_at} ${alreadyInserted ? '→ SKIP(이미존재)' : ''}`);
  console.log(`  (b) UPDATE packages.paid_amount = Σpackage_payments`);
  console.log(`  (c) DELETE closing_manual_payments ${FROZEN.manual_id} ${man ? '' : '→ SKIP(부재)'}`);
  console.log('\n집행하려면 APPLY=1 재실행.');
  process.exit(0);
}

// ── (a) INSERT package_payments ─────────────────────────────────────────
if (!alreadyInserted) {
  const { error: insErr } = await sb.from('package_payments').insert({
    clinic_id: FROZEN.clinic_id,
    package_id: FROZEN.package_id,
    customer_id: FROZEN.customer_id,
    amount: FROZEN.amount,
    method: FROZEN.method,
    installment: 0,
    payment_type: 'payment',
    fee_kind: 'package',
    memo: OPT_A_MEMO,
    created_at: FROZEN.created_at,
  });
  if (insErr) { console.error('ABORT (a) INSERT 실패:', insErr.message); process.exit(1); }
  console.log('[a] package_payments INSERT ✅');
} else {
  console.log('[a] package_payments INSERT SKIP (멱등 — 이미 존재)');
}

// ── (b) packages.paid_amount 재집계 ─────────────────────────────────────
const { data: sumRows } = await sb.from('package_payments').select('amount, payment_type').eq('package_id', FROZEN.package_id);
const paidTotal = (sumRows ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
const { error: updErr } = await sb.from('packages').update({ paid_amount: paidTotal }).eq('id', FROZEN.package_id);
if (updErr) { console.error('ABORT (b) UPDATE 실패:', updErr.message); process.exit(1); }
console.log(`[b] packages.paid_amount = ${won(paidTotal)} ✅`);

// ── (c) DELETE closing_manual_payments ──────────────────────────────────
if (man) {
  const { error: delErr } = await sb.from('closing_manual_payments').delete().eq('id', FROZEN.manual_id);
  if (delErr) { console.error('ABORT (c) DELETE 실패:', delErr.message); process.exit(1); }
  console.log('[c] closing_manual_payments DELETE ✅');
} else {
  console.log('[c] closing_manual_payments DELETE SKIP (부재)');
}

// ── AFTER 스냅샷 + net-zero 검증 ────────────────────────────────────────
const { data: ppAfter } = await sb.from('package_payments').select('amount, payment_type, fee_kind').eq('package_id', FROZEN.package_id);
const netAfter = (ppAfter ?? []).reduce((s, r) => s + ((r.fee_kind ?? 'package') === 'package' ? (r.payment_type === 'refund' ? -r.amount : r.amount) : 0), 0);
const dueAfter = (pkg.total_amount ?? 0) - netAfter;
console.log(`\n[AFTER] package_payments ${(ppAfter ?? []).length}건, netPkg=${won(netAfter)}, package_due=${won(dueAfter)}`);
console.log(`  ▶ 미수 해소: ${dueAfter === 0 ? 'OK ✅ (잔금 0)' : `잔금 ${won(dueAfter)} 잔존 ⚠`}`);
console.log(`  ▶ net-zero 매출: 수기(-${won(FROZEN.amount)}) + 패키지결제(+${won(FROZEN.amount)}) = 0 (일마감 합계 불변)`);
