#!/usr/bin/env node
/**
 * dryrun_selftest.mjs — dryrun_lib.mjs 자체 검증 로그 (FIX-REQUEST 완료보고 항목 5).
 *
 * 표준 §3 불변식 INV-1~5 + §5 NON_TXN_DDL 동작을, 내장 top-level COMMIT 을 가진 샘플
 * 마이그레이션 1건으로 실증한다:
 *   (A) 순수함수 검증 (DB 무접촉):
 *       - stripTxnControl 이 top-level BEGIN;/COMMIT; 만 제거하고, plpgsql 함수 본문의
 *         BEGIN/END 는 보존 (INV-1).
 *       - detectNonTxnDdl 이 §5 무영속불가 DDL(CREATE INDEX CONCURRENTLY)을 검출.
 *   (B) prod 무영속 실행 검증 (rxlomoozakkjesdqjtvd, 영속 0):
 *       - 내장 COMMIT 이 있는 샘플을 dry-run → plpgsql exception-handler 롤백.
 *       - post-probe 로 생성 대상(table/proc)이 prod 에 **부재** 실측 (INV-3).
 *
 * usage: node scripts/dryrun_selftest.mjs
 */
import {
  stripTxnControl, detectNonTxnDdl, buildHarness, runDryrun,
  regclassAbsent, procAbsent, q,
} from './dryrun_lib.mjs';

const T = '_dryrun_selftest_foot';       // 절대 실재하면 안 되는 임시 오브젝트
const FN = '_dryrun_selftest_touch';

// 내장 top-level COMMIT 을 가진 샘플 마이그레이션.
// 함수 본문에 plpgsql BEGIN/END 를 넣어 lexer 보존을 검증한다.
const SAMPLE = `-- sample migration WITH embedded top-level transaction control (the hazard)
BEGIN;

CREATE TABLE public.${T} (
  id   bigserial PRIMARY KEY,
  note text NOT NULL DEFAULT 'x'   -- string literal with a $$-looking token: $$not a quote$$
);

CREATE OR REPLACE FUNCTION public.${FN}() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN            -- plpgsql block BEGIN — MUST be preserved (not top-level)
  NEW.note := coalesce(NEW.note, 'y');
  RETURN NEW;
END;             -- plpgsql block END — MUST be preserved
$$;

CREATE TRIGGER ${T}_bi BEFORE INSERT ON public.${T}
  FOR EACH ROW EXECUTE FUNCTION public.${FN}();

COMMIT;
`;

// §5 검증용 별도 샘플 (무영속 불가 DDL).
const NON_TXN_SAMPLE = `CREATE INDEX CONCURRENTLY idx_foo ON public.bar (baz);`;

function assert(cond, label) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}`);
  if (!cond) { process.exitCode = 1; }
  return cond;
}

console.log('════════ (A) 순수함수 검증 (DB 무접촉) ════════');

// INV-1: top-level 만 제거, plpgsql 본문 BEGIN/END 보존
const { stripped, removed } = stripTxnControl(SAMPLE);
console.log('  stripped top-level txn-control:', JSON.stringify(removed));
assert(removed.length === 2 && /^BEGIN;?$/i.test(removed[0]) && /^COMMIT;?$/i.test(removed[1]),
  'INV-1: top-level BEGIN; / COMMIT; 2건 제거');
assert(!/^\s*BEGIN\s*;\s*$/im.test(stripped) && !/^\s*COMMIT\s*;\s*$/im.test(stripped),
  'INV-1: strip 후 top-level BEGIN;/COMMIT; 잔존 없음');
assert(/LANGUAGE plpgsql AS \$\$\s*\n\s*BEGIN/i.test(stripped) && /END;\s*(--[^\n]*)?\s*\n\$\$/i.test(stripped),
  'INV-1: 함수 본문 plpgsql BEGIN/END 보존 (오손 없음)');

// §5: 무영속 불가 DDL 검출
const nonTxnA = detectNonTxnDdl(SAMPLE);
assert(nonTxnA.length === 0, '§5: 정상 샘플에는 non-txn DDL 없음');
const nonTxnB = detectNonTxnDdl(NON_TXN_SAMPLE);
assert(nonTxnB.length === 1 && nonTxnB[0].code === 'CREATE_INDEX_CONCURRENTLY',
  '§5: CREATE INDEX CONCURRENTLY 검출 → NON_TXN_DDL_CANNOT_DRYRUN');

// harness 구조 확인: EXECUTE + EXCEPTION handler 존재
const { harness } = buildHarness(SAMPLE);
assert(/EXECUTE \$dr_body\d+\$/.test(harness) && /EXCEPTION WHEN OTHERS THEN/.test(harness) && /RAISE;/.test(harness),
  'INV-2/INV-4: harness = EXECUTE + EXCEPTION handler + non-sentinel re-raise');

console.log('\n════════ (B) prod 무영속 실행 검증 (영속 0) ════════');

// 사전: 대상이 이미 없어야 정직한 검증. (있으면 이전 잔재 → 정리 후 재실행)
const preTable = await q(`SELECT to_regclass('public.${T}') IS NOT NULL AS present;`);
if (Object.values(preTable[0])[0] === true) {
  console.error(`  ✖ 사전조건 위반: public.${T} 가 이미 존재. 잔재 정리 후 재실행 필요.`);
  process.exit(1);
}
console.log(`  사전조건 OK: public.${T} prod 부재 확인`);

// 내장 COMMIT 샘플을 무영속 dry-run + post-probe (INV-3)
const res = await runDryrun({
  upPath: undefined,
  upSql: SAMPLE,
  passNote: '(selftest: embedded-COMMIT sample)',
  assertAbsent: [
    regclassAbsent(`public.${T}`),
    procAbsent(FN),
  ],
  exitProcess: false,
});

console.log('\n════════ 결과 ════════');
assert(res.pass, 'dry-run PASS (strip + plpgsql rollback + post-probe absent)');

// 사후: 독립 재확인 — 정말로 아무것도 영속되지 않았는가
const postTable = await q(`SELECT to_regclass('public.${T}') IS NULL AS absent;`);
const postFn = await q(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${FN}') AS absent;`);
assert(Object.values(postTable[0])[0] === true, `사후 독립확인: public.${T} 여전히 부재 (무영속 확증)`);
assert(Object.values(postFn[0])[0] === true, `사후 독립확인: public.${FN}() 여전히 부재 (무영속 확증)`);

console.log('\n════════ (C) 음성 대조 (실패 은폐 금지 검증) ════════');

// INV-4: 실제 마이그 에러(비-sentinel)는 PASS 로 오분류되면 안 된다 → FAIL 이어야 정상.
const brokenSql = `CREATE TABLE public.${T} (id int);\nDO $x$ BEGIN RAISE EXCEPTION 'REAL_MIGRATION_ERROR: not the sentinel'; END $x$;`;
const brokenRes = await runDryrun({ upSql: brokenSql, assertAbsent: [regclassAbsent(`public.${T}`)], exitProcess: false });
assert(!brokenRes.pass, 'INV-4: 실 마이그 에러 → FAIL (sentinel 로 은폐 안 됨)');

// §5: 무영속 불가 DDL 은 러너 전체 경로에서 PASS 반환 금지 (code=3).
const nonTxnRes = await runDryrun({ upSql: NON_TXN_SAMPLE, exitProcess: false });
assert(!nonTxnRes.pass && nonTxnRes.code === 3, '§5: CREATE INDEX CONCURRENTLY → NON_TXN_DDL_CANNOT_DRYRUN (PASS 금지)');

console.log(process.exitCode ? '\n❌ SELFTEST FAILED' : '\n✅ SELFTEST PASSED — strip · plpgsql rollback · post-probe · 실패-비은폐 모두 정상');
