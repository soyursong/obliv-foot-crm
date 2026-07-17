/**
 * T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT — 마이그 DRY-RUN (무영속, Management API)
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md v1.0 (3요소: txn-strip + plpgsql exception-handler + post-probe)
 * 러너: 공용 dryrun_lib.mjs (buildHarness/runDryrun) 재사용.
 * 대상: 20260716140000_foot_dopamine_reschedule_emit.sql (ADDITIVE: CHECK+reschedule 1 + 신규 트리거함수/트리거 1)
 * author: dev-foot / 2026-07-16 (step1 게이트 해소 후 배포단계 dry-run)
 */
import { readFileSync } from 'node:fs';
import { runDryrun, q, procAbsent, triggerAbsent } from './dryrun_lib.mjs';

const UP = 'supabase/migrations/20260716140000_foot_dopamine_reschedule_emit.dryrun.sql';

// ── (0) baseline: prod 현재 상태 실측 (ADDITIVE 근거 + no-persistence 기준선) ──
console.log('== (0) BASELINE (prod 실측) ==');
const conBefore = await q(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='dopamine_callback_outbox_event_type_check';`);
console.log('   CHECK def(before):', JSON.stringify(conBefore));
const procBefore = await q(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enqueue_dopamine_reschedule';`);
console.log('   enqueue_dopamine_reschedule() before n=', procBefore[0].n, '(기대 0 = 신규)');
const trgBefore = await q(`SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname='reservations' AND t.tgname='trg_dopamine_cb_resv_reschedule' AND NOT t.tgisinternal;`);
console.log('   trg_dopamine_cb_resv_reschedule before n=', trgBefore[0].n, '(기대 0 = 신규)');
const hasReschedBefore = (conBefore[0]?.def||'').includes('reschedule');
console.log('   CHECK contains reschedule (before)?', hasReschedBefore, '(기대 false)');

// ── (1)~(3) 무영속 dry-run: txn-strip + plpgsql exception-handler + in-txn 어설션 ──
console.log('\n== (1-3) NO-PERSISTENCE DRY-RUN ==');
const r = await runDryrun({
  upPath: UP,
  passNote: '(reschedule CHECK+trigger ADDITIVE, foot outbox)',
  exitProcess: false,
  assertAbsent: [
    procAbsent('enqueue_dopamine_reschedule'),
    triggerAbsent('trg_dopamine_cb_resv_reschedule', 'reservations'),
    // ADDITIVE 변경(CHECK reschedule 추가)이 prod 에 영속되지 않았는지 = 여전히 미포함
    { label: "CHECK constraint still WITHOUT 'reschedule'",
      sql: `SELECT NOT (pg_get_constraintdef(oid) LIKE '%reschedule%') AS absent FROM pg_constraint WHERE conname='dopamine_callback_outbox_event_type_check';` },
  ],
});

console.log('\n== RESULT ==', JSON.stringify(r));
if (!r.pass) { console.error('DRYRUN FAILED'); process.exit(1); }
console.log('DRYRUN PASS — 무영속(post-probe absent) + ADDITIVE 어설션 통과');
