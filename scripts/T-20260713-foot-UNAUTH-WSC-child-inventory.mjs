/**
 * WS-C 보조 — dup 자식 상세 인벤토리 (READ-ONLY). DA Step A(check_ins-only) 초과 자식 정밀 파악.
 * 목적: (1) 각 dup 별 자식 행 열거 (2) raw 에 동일 자식 이미 존재하는지(merge 시 unique 충돌 위험) 대조.
 */
import { query } from './lib/foot_migration_ledger.mjs';
const PAIRS = [
  { dup: '512998d0-d51a-42c4-947e-b0cb2cc69da4', raw: '8fa12f4c-abfe-405e-8736-c2ca8e4aef8a', label: 'A' },
  { dup: '0356b229-e8c7-4655-aa6e-651b15370c1f', raw: 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b', label: 'B' },
];
const DUP = PAIRS.map((p) => p.dup), RAW = PAIRS.map((p) => p.raw);
const inList = (a) => a.map((x) => `'${x}'`).join(',');
const CHILD_TABLES = ['check_ins', 'health_q_tokens', 'health_q_results', 'customer_consult_memos', 'package_payments', 'packages'];

for (const t of CHILD_TABLES) {
  const onDup = await query(`SELECT id, customer_id, created_at FROM ${t} WHERE customer_id IN (${inList(DUP)}) ORDER BY customer_id, created_at`);
  const onRaw = await query(`SELECT count(*)::int AS n FROM ${t} WHERE customer_id IN (${inList(RAW)})`);
  console.log(`\n── ${t} ──  (dup 참조 ${onDup.length}건 / raw 이미보유 ${onRaw?.[0]?.n}건)`);
  console.log(JSON.stringify(onDup, null, 2));
}

// 각 dup/raw 별로 어느 pair 인지 매핑 카운트
console.log('\n── pair 별 dup 자식 분포 ──');
for (const p of PAIRS) {
  const counts = {};
  for (const t of CHILD_TABLES) {
    const r = await query(`SELECT count(*)::int AS n FROM ${t} WHERE customer_id='${p.dup}'`);
    if (r?.[0]?.n) counts[t] = r[0].n;
  }
  const rawCounts = {};
  for (const t of CHILD_TABLES) {
    const r = await query(`SELECT count(*)::int AS n FROM ${t} WHERE customer_id='${p.raw}'`);
    if (r?.[0]?.n) rawCounts[t] = r[0].n;
  }
  console.log(`  ${p.label}: dup 자식=${JSON.stringify(counts)} · raw 기보유=${JSON.stringify(rawCounts)}`);
}
console.log('\n===== 인벤토리 완료 (read-only) =====');
