#!/usr/bin/env node
/**
 * AC-0b (side-effect guard, READ-ONLY): 후보 merchant 별 registry 커버리지 확인.
 *
 * 발견: merchant 1777289013(후보 TID 157 소속)이 sibling TID 1047479153 으로 feed 2건 활동.
 * 폴러 admission = merchant_id allowlist(active=true 파생, TID-agnostic). 따라서 후보 TID 를 active=false
 * 하면 그 merchant 의 유일 active row 였을 경우 merchant 가 allowlist 에서 이탈 → sibling TID 거래 미적재(신규 silent-miss).
 * → 후보 merchant 각각에 대해 (a)active registry row 수 (b)1047479153 등록 여부 확인.
 */
import { query } from './lib/foot_migration_ledger.mjs';
const j = (o) => JSON.stringify(o, null, 2);

const CAND_MERCHANTS = ['1777289002', '1777289010', '1777289011', '1777289013'];

// merchant 별 전체 registry rows (active 무관)
const rows = await query(`
  SELECT merchant_id, tid, terminal_label, active, superseded_tids, created_at
  FROM public.redpay_terminal_registry
  WHERE merchant_id IN (${CAND_MERCHANTS.map((m) => `'${m}'`).join(',')})
  ORDER BY merchant_id, tid;`);
console.log('── 후보 merchant registry rows ──');
console.log(j(rows));

// merchant 별 active row 수
const byM = {};
for (const r of rows) {
  byM[r.merchant_id] = byM[r.merchant_id] || { total: 0, active: 0, tids: [], active_tids: [] };
  byM[r.merchant_id].total++;
  byM[r.merchant_id].tids.push(r.tid);
  if (r.active) { byM[r.merchant_id].active++; byM[r.merchant_id].active_tids.push(r.tid); }
}
console.log('\n── merchant 별 active 커버리지 ──');
console.log(j(byM));

// 1047479153 이 registry 에 등록돼 있나 (tid 또는 superseded_tids)
const t153 = await query(`
  SELECT merchant_id, tid, active, superseded_tids FROM public.redpay_terminal_registry
  WHERE tid='1047479153' OR '1047479153' = ANY(superseded_tids);`);
console.log('\n── 1047479153 registry 등록 여부 ──');
console.log(t153.length ? j(t153) : '  [MISSING] 1047479153 은 registry 미등록(tid/superseded 모두 없음)');

// side-effect 판정: 후보 TID active=false 시 merchant 가 allowlist 이탈하나?
console.log('\n── side-effect 판정 (후보 TID 비활성 → merchant allowlist 영향) ──');
const CAND_TIDS = { '1777289002': '1047479476', '1777289010': '1047479148', '1777289011': '1047479155', '1777289013': '1047479157' };
for (const m of CAND_MERCHANTS) {
  const info = byM[m] || { active: 0, active_tids: [] };
  const candTid = CAND_TIDS[m];
  const remainingActive = info.active_tids.filter((t) => t !== candTid);
  const merchantLeavesAllowlist = remainingActive.length === 0;
  console.log(`  m=${m} cand=${candTid}: active_tids=${JSON.stringify(info.active_tids)} → 비활성 후 잔여 active=${JSON.stringify(remainingActive)} ${merchantLeavesAllowlist ? '⚠ merchant allowlist 이탈(부수효과 위험)' : 'OK(merchant 유지)'}`);
}
