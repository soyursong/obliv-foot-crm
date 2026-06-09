/**
 * T-20260609-foot-TRIAL-REVENUE-ZERO — ROLLBACK SQL 캡처 제너레이터 (READ-ONLY)
 *
 * 백필 _apply 의 정확한 역연산 SQL을 현재(=백필 전) DB 상태에서 캡처한다.
 *   - 절대 write 안 함(SELECT만). 출력 = rollback/T-20260609-foot-TRIAL-REVENUE-ZERO_rollback.sql
 *   - APPLY 가 A/B 로 바꾸기 직전의 실제 행 값(amount, tax_type, is_package_session)을
 *     full UUID 와 함께 그대로 박아넣어 무손실 역복원을 보장한다.
 *
 * _apply 의 forward 변환:
 *   [A] payments.amount 0→price, tax_type 선수금→null + cis.is_package_session true→false
 *   [B] payments.tax_type 선수금→null (amount 유지)
 * → rollback 은 이 전부를 캡처된 원값으로 되돌린다.
 *
 * 실행: node scripts/T-20260609-foot-TRIAL-REVENUE-ZERO_rollback_capture.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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
const sqlVal = (v) => (v == null ? 'NULL' : (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`));

// ── _apply 와 동일 분류 (현재=백필 전 상태) ──────────────────────────────────
const cis = await fetchAll('check_in_services', 'id, service_name, price, check_in_id, is_package_session');
const trialCis = cis.filter((c) => c.service_name && /체험/.test(c.service_name));
const trialPrice = new Map();
const trialCisRows = new Map(); // ciId → [{id, is_package_session} ...]
for (const c of trialCis) {
  trialPrice.set(c.check_in_id, (trialPrice.get(c.check_in_id) ?? 0) + (c.price ?? 0));
  if (!trialCisRows.has(c.check_in_id)) trialCisRows.set(c.check_in_id, []);
  trialCisRows.get(c.check_in_id).push({ id: c.id, is_package_session: c.is_package_session });
}
const pays = await fetchAll('payments', 'id, check_in_id, amount, method, payment_type, tax_type, accounting_date');
const byCi = new Map();
for (const p of pays) { if (!byCi.has(p.check_in_id)) byCi.set(p.check_in_id, []); byCi.get(p.check_in_id).push(p); }

const A = [], B = [];
for (const [ciId, price] of trialPrice) {
  const ps = (byCi.get(ciId) ?? []).filter((p) => p.payment_type === 'payment');
  if (ps.length === 0) continue;
  for (const p of ps) {
    if ((p.amount ?? 0) === 0 && p.tax_type === '선수금') A.push({ pay: p, ciId, price });
    else if (p.tax_type === '선수금' && (p.amount ?? 0) > 0) B.push({ pay: p, ciId });
  }
}

// ── 롤백 SQL 생성 ────────────────────────────────────────────────────────────
const ts = new Date().toISOString();
const L = [];
L.push('-- ============================================================================');
L.push('-- T-20260609-foot-TRIAL-REVENUE-ZERO — BACKFILL ROLLBACK SQL');
L.push(`-- 생성: ${ts} (rollback_capture.mjs, READ-ONLY 캡처)`);
L.push('-- 목적: _backfill_apply.mjs (APPLY=1) 집행분의 무손실 역복원.');
L.push('-- 사용: 백필 집행 후 문제 발생 시 supabase SQL editor 에서 BEGIN; ... COMMIT; 으로 실행.');
L.push('--      각 UPDATE 는 백필이 건드린 정확한 행(full UUID)을 캡처 시점 원값으로 되돌린다.');
L.push('-- 멱등: WHERE 절이 백필-후 상태를 가드하므로 미집행/중복 실행 시 0 row affected (안전).');
L.push('-- ----------------------------------------------------------------------------');
L.push(`-- [A] 매출 복구분 역복원: ${A.length}건 (amount→0, tax_type→'선수금', cis.is_package_session→true)`);
L.push(`-- [B] 선수금 재분류분 역복원: ${B.length}건 (tax_type→'선수금', amount 무변경)`);
L.push('-- ============================================================================');
L.push('BEGIN;');
L.push('');
L.push('-- ── [A] 매출 복구분 되돌리기 ──────────────────────────────────────────────');
for (const a of A) {
  L.push(`-- pay ${a.pay.id} (acct ${a.pay.accounting_date ?? '-'}) : 백필이 amount 0→${a.price}, tax '선수금'→null 로 바꿈 → 역복원`);
  L.push(`UPDATE payments SET amount = 0, tax_type = '선수금'`);
  L.push(`  WHERE id = ${sqlVal(a.pay.id)} AND amount = ${a.price} AND tax_type IS NULL;`);
  const rows = trialCisRows.get(a.ciId) ?? [];
  for (const r of rows) {
    // 백필 직전 is_package_session 원값으로 복원 (캡처 시점 값)
    L.push(`UPDATE check_in_services SET is_package_session = ${r.is_package_session === true ? 'true' : (r.is_package_session === false ? 'false' : 'NULL')}`);
    L.push(`  WHERE id = ${sqlVal(r.id)};  -- check_in ${a.ciId}`);
  }
  L.push('');
}
L.push('-- ── [B] 선수금 재분류분 되돌리기 ─────────────────────────────────────────');
for (const b of B) {
  L.push(`-- pay ${b.pay.id} (acct ${b.pay.accounting_date ?? '-'}) : 백필이 tax '선수금'→null (amount ${b.pay.amount} 유지) → 역복원`);
  L.push(`UPDATE payments SET tax_type = '선수금'`);
  L.push(`  WHERE id = ${sqlVal(b.pay.id)} AND tax_type IS NULL AND amount = ${b.pay.amount};`);
  L.push('');
}
L.push('COMMIT;');
L.push('-- ROLLBACK 끝. 적용 후 _backfill_apply.mjs dry-run 으로 A/B 가 다시 잡히는지(=원복) 확인 권장.');
L.push('');

const outPath = new URL('../rollback/T-20260609-foot-TRIAL-REVENUE-ZERO_rollback.sql', import.meta.url);
writeFileSync(outPath, L.join('\n'), 'utf8');
console.log(`✓ 롤백 SQL 생성: rollback/T-20260609-foot-TRIAL-REVENUE-ZERO_rollback.sql`);
console.log(`  [A] ${A.length}건 역복원 / [B] ${B.length}건 역복원`);
for (const a of A) console.log(`  [A] pay ${a.pay.id} → amount 0, tax '선수금', cis ${(trialCisRows.get(a.ciId) ?? []).length}행 복원`);
for (const b of B) console.log(`  [B] pay ${b.pay.id} → tax '선수금'`);
