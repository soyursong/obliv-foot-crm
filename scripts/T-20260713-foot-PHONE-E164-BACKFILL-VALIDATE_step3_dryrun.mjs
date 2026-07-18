/**
 * Step3 VALIDATE — DRY-RUN (No-Persistence Protocol) evidence runner.
 *   supervisor DDL-diff 게이트 제출용. 무영속: DO 내 VALIDATE → sentinel RAISE 롤백.
 *   post-probe: 실행 후 두 제약이 여전히 convalidated=false(NOT VALID) 임을 재확인.
 * READ-safe (무영속). author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const one = (r) => (Array.isArray(r) ? r : r.result ?? []);
const FILE = '20260718220000_foot_phone_e164_validate.dryrun.sql';
const sql = readFileSync(join(process.cwd(), 'supabase/migrations', FILE), 'utf8');

console.log('══ Step3 VALIDATE dry-run (no-persistence) ══');
console.log('측정시각(UTC):', new Date().toISOString(), '\n');

// 사전 convalidated 상태
const pre = one(await query(`SELECT conname, convalidated FROM pg_constraint
  WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk') ORDER BY 1;`));
console.log('사전 convalidated:', JSON.stringify(pre));

// dry-run 실행 (sentinel RAISE 로 무영속 롤백 기대)
const res = await query(sql).catch((e) => ({ __err: e.message }));
const msg = res.__err || res?.message || JSON.stringify(res);
const sentinelOK = /DRYRUN_SENTINEL_OK/.test(msg);
const violated = /23514|check_violation/.test(msg);
console.log('dry-run 결과:', msg.slice(0, 300));

// post-probe: 무영속 실증 (여전히 false)
const post = one(await query(`SELECT conname, convalidated FROM pg_constraint
  WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk') ORDER BY 1;`));
const stillNotValid = post.every((r) => r.convalidated === false);
console.log('사후 convalidated (무영속 실증, false 기대):', JSON.stringify(post));

console.log('\n════════════════════════════════════');
const pass = sentinelOK && stillNotValid && !violated;
console.log(`판정: ${pass ? '✅ DRYRUN PASS — VALIDATE 성공(위반 0) + 무영속 롤백 실증' : '❌ FAIL' + (violated ? ' (잔존 위반행 존재)' : '')}`);
process.exit(pass ? 0 : 1);
