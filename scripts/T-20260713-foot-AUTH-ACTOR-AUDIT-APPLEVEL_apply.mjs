/**
 * T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL — prod forward-apply (canonical pilot)
 *
 * 마이그 20260713170000_foot_staff_auth_action_audit.sql (v0.4 amend: actor_user_id NOT NULL)
 * 을 prod rxlomoozakkjesdqjtvd 에 forward-apply + schema_migrations 원장 idempotent 기록.
 *   applyMigration() 단일경로 = DDL 적용 + 원장 기록 (Track3 "적용=원장기록" 표준).
 *
 * 배경: supervisor QA FAIL(phase2 E2E) = record_auth_action PGRST202 / staff_auth_action_audit PGRST205
 *       → 1차원인 = prod 미적용 (probe: table/fn 부재, ledger max=20260713150000).
 *       amend(a01278c2)+deploy-ready 재마킹은 旣완료 → 남은 블로커 = prod apply뿐.
 *       supervisor FIX-REQUEST(MSG-20260714-000022) 명시 요청 + DDL-diff(정적) 旣수행 = 게이트 충족.
 *
 * 성격: ADDITIVE (신규 테이블 1 + 함수 2, 기존 스키마/PHI/RLS 무변경). 파괴 DDL 0. 멱등.
 *
 * 사용:
 *   node scripts/..._apply.mjs           # dry-run (기본, 계획만)
 *   node scripts/..._apply.mjs --apply   # PROD forward-apply
 *
 * author: dev-foot / 2026-07-14
 */
import { applyMigration, ledgerVersions, query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MIG = { version: '20260713170000', file: '20260713170000_foot_staff_auth_action_audit.sql' };

console.log(`── AUTH-ACTOR-AUDIT prod forward-apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);

const before = await ledgerVersions();
const preState = await query(`
  SELECT
    to_regclass('public.staff_auth_action_audit') IS NOT NULL AS table_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='record_auth_action')        AS record_fn_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='stamp_auth_action_outcome') AS stamp_fn_exists;
`);
console.log('사전 prod 상태:', JSON.stringify(preState[0]));
console.log(`사전 원장 ${before.size}행, 20260713170000 ${before.has(MIG.version) ? '기존' : '미기록'}`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음.');
  process.exit(0);
}

const r = await applyMigration({ version: MIG.version, file: MIG.file, dryRun: false, createdBy: 'T-20260713-AUTH-ACTOR-AUDIT-APPLEVEL' });
console.log(`\n✓ 적용+원장기록: ${r.version} (${r.name})`);

// PostgREST schema cache reload (PGRST202/205 해소 필수)
await query(`NOTIFY pgrst, 'reload schema';`);
console.log("✓ NOTIFY pgrst 'reload schema' 발행");

// 사후 실재 검증
const post = await query(`
  SELECT
    to_regclass('public.staff_auth_action_audit') IS NOT NULL AS table_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='record_auth_action')        AS record_fn_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname='stamp_auth_action_outcome') AS stamp_fn_exists,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='staff_auth_action_audit'
              AND column_name='actor_user_id' AND is_nullable='NO')           AS actor_user_id_notnull;
`);
console.log('사후 prod 실재:', JSON.stringify(post[0]));
const after = await ledgerVersions();
console.log(`사후 원장 ${after.size}행, max=${[...after].sort().pop()}`);

const ok = post[0].table_exists && post[0].record_fn_exists && post[0].stamp_fn_exists && post[0].actor_user_id_notnull && after.has(MIG.version);
console.log(`\n>> APPLY verdict: ${ok ? 'PASS ✅ (실재+원장 정합)' : 'FAIL ❌'}`);
process.exit(ok ? 0 : 1);
