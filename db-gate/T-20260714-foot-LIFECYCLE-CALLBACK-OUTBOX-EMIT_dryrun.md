# T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT — MIG-GATE dry-run 증거 (무영속)

**작성**: dev-foot / 2026-07-16 (step1 게이트 해소 후 배포단계 dry-run)
**마이그**: `supabase/migrations/20260716140000_foot_dopamine_reschedule_emit.sql` (+`.rollback.sql`, +`.dryrun.sql`)
**러너**: `scripts/T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT_dryrun.mjs` (공용 `dryrun_lib.mjs` = Management API, txn-strip + plpgsql exception-handler + post-probe)
**표준**: `migration_dryrun_no_persistence_standard.md` v1.0 / `migration_ledger_reconciliation.md`

## ⚠ 버전 충돌 해소 (ledger reconciliation)
- 원 파일 `20260715140000_foot_dopamine_reschedule_emit.sql` = prod 旣적용 `20260715140000 foot_stats_revenue_attrib_axis_unify`(REVENUE-ATTRIB)와 **동일 version 충돌**(feature 브랜치 33d05ec5 stale → timestamp 중복 발번).
- **해소**: DDL 내용 무변경, 파일 version 만 `20260716140000`(旣적용 max=`20260715230000` 이후, 20260716 슬롯 ledger 0건)로 재발번. → collision NO ✓.

## dry-run 결과 (PASS)
```
(0) BASELINE(prod 실측):
   CHECK def(before) = visited/no_show/cancelled/rejected  (reschedule 미포함 ✓)
   enqueue_dopamine_reschedule() before n=0  (신규 ✓)
   trg_dopamine_cb_resv_reschedule before n=0  (신규 ✓)
(1-3) NO-PERSISTENCE DRY-RUN:
   stripped top-level txn-control: ["BEGIN;","ROLLBACK;"]
   in-txn 어설션(DO $chk$): CHECK+reschedule 등재 + 旣존4값 보존 + 함수/트리거 실존 = 통과
   post-probe absent: proc ✓ / trigger ✓ / CHECK still WITHOUT reschedule ✓
== DRY-RUN PASS == (무영속 실측 + ADDITIVE 어설션)
```

## 판정
- **mig_dryrun: pass** (무영속 확증 — 3 post-probe 전부 absent)
- **mig_dryrun_postprobe: absent** (proc·trigger·CHECK-additive 3건 prod 부재 실측)
- **mig_ledger_check: clean** (재발번 후 20260716140000 미적용·무충돌)
- **DDL**: ADDITIVE (event_type CHECK +reschedule 1건 + 신규 트리거함수/트리거 1) — 旣존 값·행·경로 무손상. no-op 아님(supervisor DDL-diff 정정치 반영).
