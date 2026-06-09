/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — BACKFILL APPLY (GATED)
 *
 * ⚠⚠⚠ 이 스크립트는 supervisor 백필 게이트 승인 후에만 집행한다. ⚠⚠⚠
 *   - 기본 실행 = DRY-RUN(아무 write 없음). 실제 집행은 환경변수 APPLY=1 필요.
 *   - 분류 A/B/C 는 _backfill_dryrun.mjs 와 동일 로직으로 매 실행 시 재계산(idempotent).
 *   - 멱등성: 이미 정정된 행은 조건에서 자동 제외되므로 중복 실행해도 안전.
 *
 * 보정 정책(A안, 김주연 총괄 U0ATDB587PV 2026-06-10):
 *   [A] amount=0 + tax_type='선수금'  → 매출 증발
 *        payments.amount = 체험가, tax_type=null
 *        + 해당 check_in 의 체험권 check_in_services.is_package_session=false (Closing 매출 산입)
 *        복구 예상: 2건 / 69,000원 (pay fb73c931=10,000 / 9c1682a3=59,000, acct=2026-05-26)
 *   [B] tax_type='선수금' + amount>0  → 오분류 (금액 보존)
 *        payments.tax_type=null (amount 유지)
 *   [C] payment 없음                  → 백필 안 함 (현장 확인 권고)
 *
 * 실행:
 *   node scripts/T-20260609-foot-TRIAL-REVENUE-ZERO_backfill_apply.mjs        # dry-run
 *   APPLY=1 node scripts/T-20260609-foot-TRIAL-REVENUE-ZERO_backfill_apply.mjs # 집행
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.env.APPLY === '1';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'));

async function fetchAll(table, columns, filter) {
  const out = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < PAGE) break;
  }
  return out;
}

// ── 체험권 check_in별 금액 + check_in_services id 수집 ────────────────────────
const cis = await fetchAll('check_in_services', 'id, service_name, price, check_in_id, is_package_session');
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
const trialPrice = new Map();      // ciId → 체험권 합계 금액
const trialCisIds = new Map();     // ciId → [check_in_services.id ...]
for (const c of trialCis) {
  trialPrice.set(c.check_in_id, (trialPrice.get(c.check_in_id) ?? 0) + (c.price ?? 0));
  if (!trialCisIds.has(c.check_in_id)) trialCisIds.set(c.check_in_id, []);
  trialCisIds.get(c.check_in_id).push(c.id);
}

const pays = await fetchAll('payments', 'id, check_in_id, amount, method, payment_type, tax_type, accounting_date');
const byCi = new Map();
for (const p of pays) { if (!byCi.has(p.check_in_id)) byCi.set(p.check_in_id, []); byCi.get(p.check_in_id).push(p); }

const A = [], B = [], C = [];
for (const [ciId, price] of trialPrice) {
  const ps = (byCi.get(ciId) ?? []).filter((p) => p.payment_type === 'payment');
  if (ps.length === 0) { C.push({ ciId, price }); continue; }
  for (const p of ps) {
    if ((p.amount ?? 0) === 0 && p.tax_type === '선수금') A.push({ id: p.id, ciId, price });
    else if (p.tax_type === '선수금' && (p.amount ?? 0) > 0) B.push({ id: p.id, ciId, amount: p.amount });
  }
}

console.log(`═══ BACKFILL APPLY ${APPLY ? '★ LIVE (APPLY=1) ★' : '(DRY-RUN — no write)'} ═══\n`);
console.log(`[A] 매출 복구 대상: ${A.length}건 / 합계 ${won(A.reduce((s, a) => s + a.price, 0))}원`);
console.log(`[B] 선수금 오분류 재분류 대상: ${B.length}건 (금액 유지)`);
console.log(`[C] 보류(현장 확인): ${C.length}건\n`);

if (!APPLY) {
  for (const a of A) console.log(`  [A] pay ${a.id?.slice(0, 8)} amount 0→${won(a.price)}, tax 선수금→null + cis is_package_session→false`);
  for (const b of B) console.log(`  [B] pay ${b.id?.slice(0, 8)} amount=${won(b.amount)} 유지, tax 선수금→null`);
  for (const c of C) console.log(`  [C] ci ${c.ciId?.slice(0, 8)} 체험가=${won(c.price)} — 백필 제외`);
  console.log('\n⚠ DRY-RUN 종료 — 실제 집행하려면 APPLY=1 (supervisor 게이트 승인 후).');
  process.exit(0);
}

// ── LIVE 집행 ────────────────────────────────────────────────────────────────
let aOk = 0, bOk = 0, cisOk = 0;
for (const a of A) {
  const { error: pe } = await sb.from('payments')
    .update({ amount: a.price, tax_type: null })
    .eq('id', a.id).eq('amount', 0).eq('tax_type', '선수금'); // 멱등 가드
  if (pe) { console.error(`  [A] pay ${a.id?.slice(0, 8)} 실패: ${pe.message}`); continue; }
  aOk++;
  const cisIds = trialCisIds.get(a.ciId) ?? [];
  if (cisIds.length > 0) {
    const { error: ce } = await sb.from('check_in_services')
      .update({ is_package_session: false })
      .in('id', cisIds).eq('is_package_session', true);
    if (ce) console.error(`  [A] cis ${a.ciId?.slice(0, 8)} 플래그 정정 실패: ${ce.message}`);
    else cisOk += cisIds.length;
  }
  console.log(`  [A] pay ${a.id?.slice(0, 8)} → amount ${won(a.price)}, tax null ✓`);
}
for (const b of B) {
  const { error: pe } = await sb.from('payments')
    .update({ tax_type: null })
    .eq('id', b.id).eq('tax_type', '선수금'); // 멱등 가드
  if (pe) { console.error(`  [B] pay ${b.id?.slice(0, 8)} 실패: ${pe.message}`); continue; }
  bOk++;
  console.log(`  [B] pay ${b.id?.slice(0, 8)} → tax null (amount ${won(b.amount)} 유지) ✓`);
}

console.log(`\n═══ 집행 완료 — A:${aOk}/${A.length} · B:${bOk}/${B.length} · cis플래그:${cisOk}건 · C보류:${C.length} ═══`);
