# Leg A-(b) FRESH 무영속 dry-run + prestate probe — DB-GATE-REQUEST 동봉 증적

- ticket: T-20260810-foot-TESTACCT-CLEANUP-8ACCT
- leg: A-(b) Path-B 물리삭제 2행 [F-4425 draft / F-4692 voided · serial NULL]
- context: supervisor DB-GATE-REPLY(MSG-20260811-165542-wxav) — DDL-diff(up/down) 구조검토 ✅ PASS, 잔여 유일 게이트 = FRESH 무영속 dry-run(apply-JIT). apply-JIT 시점 fresh 재현 동봉.
- dev-foot 실행: 2026-08-11 17:44 KST (probe/dryrun server utc 08:44Z)
- branch: ticket/T-20260810-foot-TESTACCT-CLEANUP-8ACCT-3leg · HEAD 16ccb5aa
- **apply_before_go 준수**: prod DELETE/DISABLE TRIGGER/DDL 선집행 0. dry-run=무영속. prestate=READ-ONLY.

## file sha256 (supervisor EXACT 재바인딩)

| file | sha256 |
|------|--------|
| up.sql (`..._legAb_pathb_scopeddisable_2row.sql`) | `c85fa1b1c7ec6db820ff432caaf354cf9bfb56b655ce78250ac5636454d5fc91` |
| rollback.sql | `523a68b084c2e68cd230552ab104d3e8663a41be2996b7526d50f05ff4949bc7` |
| dryrun.mjs | `3b4aaa9cabce853956046e303b0aaf1769f366a4f1533dfb643131b7808e7205` |

★ up.sql sha256 `c85fa1b1…` = supervisor 명시 "sha256 c85fa1b1 EXACT" 와 **바이트 일치** → DDL-diff 대상과 동일 파일 무변동 확증.

## 1) FRESH 무영속 dry-run 3요소 (dryrun_lib · migration_dryrun_no_persistence_standard §1)

**== DRY-RUN PASS ==** (txn-control stripped · plpgsql exception-rollback · post-probe absent)

- ① txn-strip (INV-5): stripped top-level txn-control = `["BEGIN;","COMMIT;"]` (plpgsql 본문 내부 BEGIN/END 보존)
- ② plpgsql exception-rollback: strip 후 payload 를 `DO $$ ... EXECUTE ... EXCEPTION WHEN OTHERS` 로 동적실행 → implicit savepoint rollback (진짜 무영속) · harness response `[]`
- ③ post-probe absent (20건 전건 absent=TRUE):
  - 17 × `_arch_testacct8_ab_*_20260811` prod 부재 (CREATE 롤백)
  - customers 2행 잔존(DELETE 롤백) = TRUE
  - form_submissions 2행 잔존(scoped purge 롤백) = TRUE
  - `trg_form_submissions_published_immutable` tgenabled='O'(DISABLE 무누출) = TRUE

→ scoped DISABLE→DELETE(fs 2)→ENABLE 가 retention-guard 차단 없이 통과 · tgenabled 무누출 · 91행 · 무영속 확증.

## 2) 현 PRESTATE PROBE (READ-ONLY · A-a apply[06:52Z 80행삭제] 이후 실측)

- probe server time: 2026-08-11 08:44:33Z (17:44:33 KST)
- **A-b 대상 customers live = 2** (apply 미집행):
  - F-4425 풋테스트3 `21a82994-b231-4bcc-94ff-dd9e6c3a4951` · is_test=false · is_simulation=false
  - F-4692 송지현2 `d7faae9b-8e0b-421a-b68b-483ede6834a3` · is_test=false · is_simulation=false
- **대상 form_submissions = 2** (retention firewall clear):
  - draft `b0edd82a…` (F-4425 소유) · doc_serial_seq=NULL · rx_issue_seq=NULL · is_deleted=false
  - voided `755ac489…` (F-4692 소유) · doc_serial_seq=NULL · rx_issue_seq=NULL · is_deleted=false
- **F-4427 leak-guard**: fs `b4a36c4e…` = customer_id `e72022d0…`(F-4427) 소유 · printed · doc_serial_seq=74 · `owned_by_ab_target=FALSE` → A-b 스코프 미포함 확증
- **retention trigger** tgenabled='O' (현재 enabled)
- **FK closure prestate = 91행 (up.sql expected 정합)**: customers 2 · reservations 3 · packages 2 · check_ins 2 · assignment_actions 2 · chart_treatment_requests 2 · check_in_room_logs 4 · check_in_services 16 · customer_treatment_memos 1 · form_submissions 2 · health_q_results 1 · health_q_tokens 1 · reservation_logs 2 · reservation_memo_history 1 · status_transitions 10 · notification_logs 5 · phi_access_log 35 → closure 51 + notif 5 + phi 35 = **91**
- **LEDGER/MEDICAL guard = 전건 0**: payments 0 · service_charges 0 · package_payments 0 · medical_charts 0 · prescriptions 0 · consent_forms 0
- **Leg A-(a) 3행 live = 0** (F-4691/F-4703/F-4468 이미 삭제 종결 06:52Z — supersede 재확인)
- **_arch_testacct8_ab_* prod 부재** (arch_customers=null · arch_fs=null → apply_before_go 준수)

## 상류 게이트 (supervisor 회신 인용 · 전건 CLEAR)

- CEO H6 sign-off CLEARED (2026-08-11 12:22 MSG-20260811-122210-psik)
- DA z676 조건부 GO (scoped-DISABLE designation · SSOT da_decision_foot_testacct_cleanup_formsubmissions_retention_purge_20260810.md §ADDENDUM#1)
- §2.8 DA HOLD 재확인 CLEAN (foot/TESTACCT 활성 HOLD/RETRACT 0)

## 잔여 = supervisor JIT 발행

fresh 무영속 독립재현 + freeze-set 재대조 → ed25519 signed GO.token.json/.sig → db-gate/ 커밋·push(sha 재바인딩) → TTL 내 즉시 apply(db_apply_guard.sh prod lane) → POSTCHECK(삭제 91행 · customers 2 소멸 · fs 2 소멸 · tgenabled='O' live · 완전가역).

evidence scripts:
- prestate: `scripts/T-20260810-testacct8_legAb_prestate_probe.mjs`
- dryrun: `supabase/migrations/20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row.dryrun.mjs`
