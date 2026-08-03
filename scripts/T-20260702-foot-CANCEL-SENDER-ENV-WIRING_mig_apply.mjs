#!/usr/bin/env node
/**
 * T-20260702-foot-CANCEL-SENDER-ENV-WIRING — mig 20260803120000 prod apply runner
 *
 * DA CONSULT-REPLY MSG-20260803-141811-jti6 GO
 *   (DA-20260803-foot-OUTBOUNDLOG-CANCELLED-CALLBACKTYPE-RECONCILE)
 *   change-class = ADDITIVE CHECK widening ('visited','paid') → ('visited','paid','cancelled').
 *
 * DA apply-직전 HARD assert 3 (의무):
 *   A1. pre-apply 대조: prod 실 CHECK(pg_constraint introspection) == 원본 mig 20260520000040
 *       선언 ('visited','paid') 일치. 발산 시 apply 중단 → supervisor 재회신.
 *   A2. strict-superset 불변식: 신 CHECK 결과도메인 = 기존 ∪ {cancelled} 정확히.
 *       기존값 삭제/축소 금지.
 *   A3. apply 시점 prod CHECK 재introspection (OOB stomp 가드) — pre-apply 대조와
 *       apply 직전 재대조 2회.
 *
 * 사용:
 *   node ..._mig_apply.mjs           # DRY-RUN(기본): introspect 2회 + 계획만, write 0
 *   node ..._mig_apply.mjs --apply   # 실제 DDL 적용(HARD assert 통과 시에만) + 원장 기록 + post-check
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260803120000';
const FILE = '20260803120000_dopamine_outbound_log_cancelled_callbacktype.sql';
const CONSTRAINT = 'dopamine_outbound_log_callback_type_check';
const TABLE = 'public.dopamine_outbound_log';

// 계약 기준값
const ORIGINAL_DECL = new Set(['visited', 'paid']);              // 원본 mig 20260520000040 선언
const EXPECTED_AFTER = new Set(['visited', 'paid', 'cancelled']); // strict-superset = 원본 ∪ {cancelled}

const j = (o) => JSON.stringify(o, null, 2);
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** prod pg_constraint 에서 CHECK def 를 읽어 허용값 Set 을 파싱한다. */
async function introspect() {
  const rows = await query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = '${TABLE}'::regclass
      AND conname = '${CONSTRAINT}';`);
  const arr = Array.isArray(rows) ? rows : [];
  if (arr.length === 0) return { present: false, def: null, values: null };
  const def = arr[0].def;
  // CHECK ((callback_type = ANY (ARRAY['visited'::text, 'paid'::text])))  또는
  // CHECK ((callback_type = ANY ((ARRAY['visited'::text, ...])::text[])))  또는
  // CHECK ((callback_type IN ('visited'::text, 'paid'::text)))
  const lits = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
  const fallback = lits.length ? lits : [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { present: true, def, values: new Set(fallback) };
}

// ── A1 / A3 (1회차): pre-apply introspection ──────────────────────────────
console.log('── [A1] PRE-APPLY introspection (prod 실 CHECK) ──');
const pre = await introspect();
console.log(j({ present: pre.present, def: pre.def, values: pre.values ? [...pre.values] : null }));

if (!pre.present) {
  console.error(`\n[ABORT] CHECK '${CONSTRAINT}' 가 prod 에 부재. 예상 밖 상태 → supervisor 재회신 필요.`);
  process.exit(3);
}
if (!setEq(pre.values, ORIGINAL_DECL)) {
  console.error(`\n[ABORT — A1 발산] prod 실 CHECK 값 {${[...pre.values]}} ≠ 원본 mig 선언 {${[...ORIGINAL_DECL]}}.`);
  console.error('  Migration Ledger Reconciliation: 실재를 먼저 반영(strict-superset 유지)한 수정본으로 재작성 후 supervisor 재회신.');
  // 이미 cancelled 포함된 strict-superset 이면 별도 신호(멱등 재적용 판단)
  if (setEq(pre.values, EXPECTED_AFTER)) {
    console.error('  NOTE: prod 가 이미 목표상태 {visited,paid,cancelled}. mig 멱등 — 재적용 불요. supervisor 통보.');
    process.exit(4);
  }
  process.exit(3);
}
console.log('  [A1 PASS] prod 실 CHECK == 원본 선언 {visited,paid}. 정합.');

// ── A3 (2회차): apply 직전 재introspection (OOB stomp 가드) ────────────────
console.log('\n── [A3] APPLY-직전 재introspection (OOB stomp 가드, 2회차) ──');
const pre2 = await introspect();
console.log(j({ present: pre2.present, values: pre2.values ? [...pre2.values] : null }));
if (!pre2.present || !setEq(pre2.values, ORIGINAL_DECL)) {
  console.error(`\n[ABORT — A3 stomp] 1회차와 2회차 사이 prod CHECK 변동 감지 {${pre2.values ? [...pre2.values] : 'ABSENT'}}. 중단 → supervisor 재회신.`);
  process.exit(3);
}
console.log('  [A3 PASS] 2회 대조 일치. OOB stomp 없음.');

if (!APPLY) {
  console.log('\n=== DRY-RUN 완료 (write 0) ===');
  console.log(`  HARD assert A1·A3 통과. --apply 로 실제 DDL 적용 가능.`);
  console.log(`  적용 예정: ${FILE} → CHECK {visited,paid} ∪ {cancelled} = {visited,paid,cancelled}`);
  process.exit(0);
}

// ── APPLY: DDL 적용 (원장 기록 단일경로) ──────────────────────────────────
console.log('\n── [APPLY] DDL 적용 + 원장 기록 ──');
const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: false,
  createdBy: 'T-20260702-foot-CANCEL-SENDER-ENV-WIRING (DA GO MSG-20260803-141811-jti6)',
});
console.log(j(res));

// ── A2: post-apply strict-superset 검증 ───────────────────────────────────
console.log('\n── [A2] POST-APPLY strict-superset 검증 ──');
const post = await introspect();
console.log(j({ present: post.present, def: post.def, values: post.values ? [...post.values] : null }));
if (!post.present || !setEq(post.values, EXPECTED_AFTER)) {
  console.error(`\n[FAIL — A2] 적용후 CHECK {${post.values ? [...post.values] : 'ABSENT'}} ≠ 기대 {${[...EXPECTED_AFTER]}}. 즉시 supervisor 보고.`);
  process.exit(5);
}
// strict-superset 불변식: 기존값 전부 보존 + cancelled 추가, 그외 없음
const preserved = [...ORIGINAL_DECL].every((v) => post.values.has(v));
const onlyAdded = [...post.values].filter((v) => !ORIGINAL_DECL.has(v));
if (!preserved || onlyAdded.length !== 1 || onlyAdded[0] !== 'cancelled') {
  console.error(`\n[FAIL — A2 불변식] 기존값보존=${preserved}, 추가값=${j(onlyAdded)}. strict-superset 위반.`);
  process.exit(5);
}
console.log('  [A2 PASS] strict-superset 확정: 기존 {visited,paid} 전량 보존 + {cancelled} 만 추가.');
console.log('\n=== APPLY 완료 ===');
console.log(`  applied_at(UTC)= ${post.def ? 'introspected' : ''}`);
console.log(`  mig_version=${VERSION}  ledger=recorded  rollback=${FILE.replace('.sql', '.down.sql')}`);
