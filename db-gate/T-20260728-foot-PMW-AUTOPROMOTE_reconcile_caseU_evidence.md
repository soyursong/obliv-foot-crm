# T-20260728-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX — DA Ledger Reconciliation Case U 집행 evidence

- exec: supervisor (전속, DA-20260802-foot-PMW-OOB-REJECTEDBODY-RECONCILE GO)
- SSOT: `da_decision_foot_pmw_oob_rejectedbody_migledger_reconcile_20260802.md` §Case U
- 집행 시각: 2026-08-02 11:38~11:42 KST (Mgmt API, foot prod rxlomoozakkjesdqjtvd)
- 게이트: §8 2.8 GO 직전 DA HOLD 재확인 = 활성 HOLD/RETRACT/BINDING 0 · MQ 인박스 = 본 GO 메시지 자체

## PRE-APPLY 실측 (READ-ONLY, C19 ②)
- promote md5 = `fb08ef1fb4f4ec0fb4c1d65683e0b594` (rejected 지문, DA 결정문서 §0 일치 — 신규 stomp 無)
- count md5 = `84ce2e0fd0c7096397e1b5b1f54e017d` (동일)
- ledger 20260802160000 created_by = NULL (OOB 손자국 그대로)
- cron `foot-pmw-autopromote` 부재(containment 유지) · job_run_details 발화 0 = **오염 0**
- apply 직전 재대조(2차): 동일 → PASS

## Leg1 — d1668759 literal body CREATE OR REPLACE (함수 2종만, cron 제외 split)
- 소스: `_wt-foot-pmw-autopromote` @ d1668759, 파일-md5 `c44a51a1183491c1eb426f8f95cbeecc` (DA 문서 일치)
- BASE-PARITY (Case K ⑥) POST-DUMP:
  - promote: has_reconciled_pred=**true** · has_settled=**false** · has_raise_log=**true** · orphan(customer_id=ci.customer_id) **부재** ✅
  - count: has_reconciled_pred=**true** · has_settled=**false** · orphan 부재 ✅
- **go-forward canonical prosrc-md5 pin**:
  - `promote_reconciled_payment_waiting` = `3f8da66b3466dcc08409fde5c13669ec`
  - `count_stuck_reconciled_payment_waiting` = `9035653078372849c7f399e7c9bad6fb`

## Leg2 — ledger row 20260802160000 re-provenance
- 기법(exec-lane 결정) = **in-place UPDATE** (row 부재 window 0 · version 유지 · blast 최소)
- 가드 = `WHERE version='20260802160000' AND created_by IS NULL` (지문 단일행) → rows=1 assert PASS
- 종국 상태: created_by = `supervisor:reconcile-caseU:DA-20260802-...| supersedes OOB-applied DA-REJECTED body | DA REAFFIRM MSG-20260802-110350-7yit | blessed=d1668759 | prosrc-md5 pin`
  + statements[1] = 승인 body 전문(reconciled_pred O·raise_log O·orphan 매칭 X) — 불변조건 3항 read-back PASS

## Leg3 — cron 재활성 (BASE-PARITY PASS 후 전용 게이트)
- 재등록 직전 go-forward pin 재대조 PASS → cron 섹션(d1668759 verbatim) apply
- cron.job: jobid=**30** · `15 19 * * *` (04:15 KST) · active=true · command=`SELECT public.promote_reconciled_payment_waiting()` = **승인 body 결속 확인** (구 jobid29 OOB job 승계 아님·신규 등록)

## POSTCHECK (마이그 하단 체크리스트)
- 함수 2행 실재 ✅ · cron 등록 ✅
- count_stuck() = 0 (dormant — DA H1 92/92 정합)
- 수동 1틱 promoted=0/skipped=0 · 2틱 promoted=0 = **멱등 ✅** (앵커검증 = N/A, 승격행 0)
- 관측성(GO조건6): prosrc has_raise_log=true + 반환 카운트 발화 실증

## deploy
- main merge 08a2e346 (d1668759 → main, FE src 무접점 = bundle 무변, db_only)

## ⚠️ 별건 flag — version 20260802160000 충돌 (planner 통지)
- origin/main 에 `20260802160000_foot_closing_confirmed_edit.sql`(T-20260730-DAYCLOSE, prod 미적용·deploy-ready) 공존.
- ledger version PK 는 본 reconciliation 으로 PMW(d1668759)가 정당 점유 확정 → DAYCLOSE 는 **apply 전 renumber 필수**(미조치 시 recordLedger ON CONFLICT no-op = silent ledger 유실 drift). DAYCLOSE DB-gate 진입 시 supervisor가 renumber 미이행이면 fail-closed 예정.
