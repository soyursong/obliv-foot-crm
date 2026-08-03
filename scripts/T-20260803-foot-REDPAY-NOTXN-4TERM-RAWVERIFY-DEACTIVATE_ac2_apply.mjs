#!/usr/bin/env node
/**
 * T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE — AC-2 비활성 실행 (soft flag)
 *
 * freeze-set = AC-0 raw census 로 TRUE-ZERO 확정된 3 TID (157 은 HOLD: merchant 1777289013 07-23 net0 취소쌍 158-class).
 * soft only: active=false (UPDATE). hard-delete/DDL/원장 무접점. rows-affected assert = 3.
 * 롤백 SQL 자동 생성. 실행 전/후 registry diff evidence.
 *
 * 사용:
 *   node ..._ac2_apply.mjs            # DRY-RUN (기본): 대상행·롤백SQL 출력, write 0
 *   node ..._ac2_apply.mjs --apply    # 실제 UPDATE (freeze-set·assert 가드)
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// ── freeze-set: AC-0 TRUE-ZERO 확정 3 TID (하드코딩) ──
const FREEZE_SET = ['1047479476', '1047479148', '1047479155'];
const HELD = { '1047479157': 'merchant 1777289013 07-23 net0 승인+취소쌍(1004원, tid 1047479153) 158-class + tid/merchant registry 불일치 → CANCELPAIR-AUDIT 편입 보고' };
const EXPECT = FREEZE_SET.length; // 3
const NOTE = 'DEACTIVATED T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE 2026-08-03 (AC-0 raw TRUE-ZERO: feed_cnt=0 AND raw_cnt=0, VAN∪조회API 정본대조)';
const j = (o) => JSON.stringify(o, null, 2);
const inList = FREEZE_SET.map((t) => `'${t}'`).join(',');

// 1) BEFORE snapshot (freeze-set 정확히)
const before = await query(`
  SELECT id, domain, merchant_id, tid, terminal_label, active, source, updated_at
  FROM public.redpay_terminal_registry
  WHERE tid IN (${inList}) AND domain='foot'
  ORDER BY tid;`);
console.log('── BEFORE (freeze-set 3 TID) ──');
console.log(j(before));

// freeze-set 무결성 검증: 정확히 3행, 전부 active=true, domain=foot
const beforeActive = before.filter((r) => r.active === true);
if (before.length !== EXPECT) {
  console.error(`[ABORT] freeze-set 매칭 ${before.length}행 ≠ 기대 ${EXPECT}. 중단.`);
  process.exit(3);
}
if (beforeActive.length !== EXPECT) {
  console.error(`[ABORT] freeze-set 중 active=true 아닌 행 존재(이미 비활성?). active=${beforeActive.length}. 중단.`);
  process.exit(3);
}

// 2) 롤백 SQL 자동 생성 (원본 active·source·updated_at 복원)
const rollback = before.map((r) =>
  `UPDATE public.redpay_terminal_registry SET active=${r.active}, source=$$${r.source}$$, updated_at='${r.updated_at}' WHERE id='${r.id}'; -- tid ${r.tid}`
).join('\n');
const rollbackPath = `${HERE}/T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE_ac2_rollback.sql`;
writeFileSync(rollbackPath, `-- ROLLBACK for AC-2 deactivation (restore active=true + original source/updated_at)\n-- generated ${WINDOW()} \n${rollback}\n`);
function WINDOW() { return '2026-08-03 (dev-foot)'; }
console.log(`\n── ROLLBACK SQL (saved: ${rollbackPath}) ──\n${rollback}`);

// 3) HELD 보고
console.log(`\n── HELD (비활성 제외) ──\n${j(HELD)}`);

if (!APPLY) {
  console.log(`\n[DRY-RUN] --apply 없음 → write 0. 위 ${EXPECT}행이 active=false 로 전환될 예정.`);
  process.exit(0);
}

// 4) APPLY — 가드된 UPDATE (freeze-set·domain·active=true AND) + RETURNING 으로 rows-affected 확인
const applied = await query(`
  UPDATE public.redpay_terminal_registry
  SET active=false,
      source = source || $$ | ${NOTE}$$,
      updated_at = now()
  WHERE tid IN (${inList}) AND domain='foot' AND active=true
  RETURNING tid, active;`);
const affected = applied.length;
console.log(`\n── APPLY 결과 rows-affected=${affected} (기대 ${EXPECT}) ──`);
console.log(j(applied));

if (affected !== EXPECT) {
  console.error(`\n[ASSERT-FAIL] rows-affected=${affected} ≠ freeze-set 크기 ${EXPECT}. 롤백 SQL 로 원복 필요: ${rollbackPath}`);
  process.exit(4);
}

// 5) AFTER snapshot
const after = await query(`
  SELECT tid, merchant_id, active, updated_at FROM public.redpay_terminal_registry
  WHERE tid IN (${inList}) AND domain='foot' ORDER BY tid;`);
console.log('\n── AFTER ──');
console.log(j(after));

// 6) evidence
const evidence = {
  ticket: 'T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE',
  ac: 'AC-2', applied_at: '2026-08-03',
  freeze_set: FREEZE_SET, expected: EXPECT, rows_affected: affected, assert_ok: affected === EXPECT,
  method: 'soft flag active=false, no DDL, no ledger contact', rollback_sql: rollbackPath,
  held: HELD, before, after,
};
const evPath = `${HERE}/T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE_ac2_evidence.json`;
writeFileSync(evPath, j(evidence));
console.log(`\n[written] ${evPath}`);
console.log(`\n✅ AC-2 완료: ${EXPECT}행 active=false (freeze-set assert PASS). 157 HOLD.`);
