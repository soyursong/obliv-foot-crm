# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — 3-leg AUTHORING 증적 (dev-foot)

- 실행: dev-foot / 2026-08-11 / foot prod rxlomoozakkjesdqjtvd / Management API (READ-ONLY census + no-persist dry-run)
- 근거: planner NEW-TASK **MSG-20260811-082849-425f** (총괄 김주연 '완전정리' ts 1786403792.800929 → §PRECEDENCE erase-의도 게이트 RESOLVED).
- DA GO: **z676**(Path-B scoped-DISABLE 조건부·SSOT da_decision_foot_testacct_cleanup_formsubmissions_retention_purge_20260810.md §ADDENDUM#1) + **DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY**(Leg B is_test).
- **상태: AUTHORING 완료 · prod 미적용(DELETE/DDL/WRITE/flag-UPDATE 0). ★apply 전건 = supervisor GO-token 발행 後에만(apply_before_go 금지). Path-B(Leg A-(b))는 CEO 경량 sign-off(H6) 추가 co-gate.**
- ball = dev-foot(authoring 완료) → planner FOLLOWUP. apply = CEO H6(Path-B) + supervisor GO-token 게이트.

## 0. 3-leg 대상 roster (identity re-bind 확증 · freeze-set)
| leg | 이름 | chart | customer_id | 처분 |
|-----|------|-------|-------------|------|
| **A-(a)** 정상삭제 | 엄경은2 | F-4691 | a0f8c846-9f93-47bf-a79e-57d265d989b6 | 물리삭제 |
| **A-(a)** 정상삭제 | 엄경은2(DUMMY) | F-4703 | 02594dfa-9428-4405-b640-95ab50ad5e5d | 물리삭제 |
| **A-(a)** 정상삭제 | 풋 서류 테스트 입니다 | F-4468 | c074025b-cd27-443c-93a9-151d6d4214d4 | 물리삭제 |
| **A-(b)** Path-B | 풋테스트3 | F-4425 | 21a82994-b231-4bcc-94ff-dd9e6c3a4951 | 물리삭제(scoped DISABLE) |
| **A-(b)** Path-B | 송지현2 | F-4692 | d7faae9b-8e0b-421a-b68b-483ede6834a3 | 물리삭제(scoped DISABLE) |
| **B** is_test | 풋테스트1 | F-4427 | e72022d0-7cf5-4f42-b5e3-b5162005b454 | 테스트표시(view-hide) |
| **B** is_test | 박민석(동명이인 별건) | F-4445 | 66c08e48-c708-4e50-963d-aaa56b27d9ea | 테스트표시(view-hide) |

- **identity re-bind 7/7 확증**: chart↔id↔name 일치·`is_test=false`·`is_simulation=false`·`created_by=NULL`(전행).
- **★동명이인 실고객/KEEP 배제(NFC exact)**: F-4790 박민석 **본계정**(1c61bad2-ad49-4e7d-92ae-2d132aae95cb)·F-4451 송지현·F-4623 엄경은 = 대상셋 무혼입 confirm. ★F-4445 ≠ 본계정 F-4790(4jg4 확정).

## 1. FK closure census (READ-ONLY · scripts/T-…_3leg-census.mjs, -p2.mjs)
### Leg A-(a) [F-4691,F-4703,F-4468] — form_submissions **0행**(trigger 무관)
- closure 15 tables 50 rows + notification_logs 2(SET NULL→명시삭제) + phi_access_log 28(loose) = **총 80행**, customers 3 소멸.
- per-table: reservations2 packages2 check_ins2 assignment_actions2 chart_treatment_requests1 check_in_room_logs2 check_in_services20 customer_treatment_memos1 health_q_results1 health_q_tokens2 reservation_logs1 reservation_memo_history1 status_transitions9 package_sessions1.
### Leg A-(b) [F-4425,F-4692] — form_submissions **2행**(draft b0edd82a·voided 755ac489·둘 다 serial NULL)
- closure 15 tables 51 rows(fs 2 포함) + notification_logs 5 + phi_access_log 35 = **총 91행**, customers 2 소멸.
- per-table: reservations3 packages2 check_ins2 assignment_actions2 chart_treatment_requests2 check_in_room_logs4 check_in_services16 customer_treatment_memos1 form_submissions2 health_q_results1 health_q_tokens1 reservation_logs2 reservation_memo_history1 status_transitions10.
- form_submissions_audit_log(RESTRICT child)=**0** · self source ref=0 · 트리거 `trg_form_submissions_published_immutable` tgenabled=**'O'**.
### Leg B [F-4427,F-4445] — is_test flag
- 인프라(customers.is_test boolean nullable default false + v_daily_revenue is_test 참조) = 旣 APPLIED(01:08). 현재 is_test=true = 3(F-4574,F-4990,F-5113 = 1차분). 대상 2건 현재 false → flip.

## 2. LEDGER/MEDICAL GUARD (purge legs A-a+A-b 합집합) — 전건 0 PASS
payments **0** · service_charges **0** · package_payments **0** · package_credit_ledger **0** · medical_charts **0** · prescriptions **0** · consent_forms **0** · insurance_claims **0**. → 의료법 보존의무 무저촉(retention firewall CLEAR: 대상 fs = serial-NULL·never-issued·재무⊥).

## 3. 마이그레이션 산출물 (up/down/dryrun) — 3 legs × 3 파일
| leg | up.sql | rollback.sql | dryrun.mjs |
|-----|--------|--------------|------------|
| A-(a) | 20260811040000_foot_testacct8_legAa_normaldelete_3row.sql | .rollback.sql | .dryrun.mjs |
| A-(b) | 20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row.sql | .rollback.sql | .dryrun.mjs |
| B | 20260811060000_foot_testacct8_legB_istest_flag_2row.sql | .rollback.sql | .dryrun.mjs |

- **A-(a)**: archive-first(17 _arch_aa_* 테이블) → children-first DELETE → parents. In-txn 가드: customers=3 exact · form_submissions=0 확증(>0 이면 ABORT) · KEEP/실고객 id 미혼입.
- **A-(b) Path-B**: archive-first(17 _arch_ab_*) → same-txn `ALTER..DISABLE TRIGGER trg_form_submissions_published_immutable → DELETE(fs 2 한정) → 커밋 前 ENABLE → tgenabled 사후재확인(H3, in-txn)`. In-txn 가드: customers=2·fs=2 exact · **F-4427 leak guard**(serial NOT NULL/printed/fs id b4a36c4e 혼입 시 ABORT) · KEEP/실고객/F-4427 id 미혼입. **{F-4425,F-4692} 2행 한정 scoped(blanket 금지)**.
- **B**: per-row `UPDATE customers SET is_test=true WHERE id IN (2 whitelist) AND is_test IS DISTINCT FROM true`(멱등·rows-affected=2). In-txn self-test: 대상 2 flag 확증 · **박민석 본계정 F-4790 미flag 확증** · over-flag 차단(is_test=true 전체 = 정확히 {F-4427,F-4445,F-4574,F-4990,F-5113} 5건).

## 4. Migration Dry-Run No-Persistence — 3 legs 전건 PASS
dryrun_lib 3요소(txn-control strip[BEGIN;/COMMIT;] · plpgsql exception-rollback · post-probe absent).
- **A-(a)**: 17 _arch_aa_* prod 부재 + customers 3행 잔존 → **PASS**.
- **A-(b)**: 17 _arch_ab_* 부재 + customers 2행 잔존 + **fs 2행 잔존** + **tgenabled='O' 무누출** → **PASS**. (Path-A blanket 차단 대비 Path-B scoped 통과 실증.)
- **B**: 대상 2건 is_test 미영속(flag 롤백) + 본계정 F-4790 false 불변 + is_test=true 전체=3(1차분·미영속) → **PASS**.

## 5. Migration Ledger Reconciliation — clean (3자 정합)
- schema_migrations 원장에 version 20260811040000/050000/060000 **미기록**(name+version 무충돌).
- ledger tip = 20260811030000 → 신규 3버전 후행 monotonic.
- prod 실재: `_arch_testacct8_aa/ab_*` 테이블 **0**(미적용) · 구 6계정 superseded `_arch_testacct8_*`(20260810220000) **0**(never-applied) → 파일선언(신규 CREATE)과 정합. ADDITIVE forward·OOB divergence 0.

## 6. before-snapshot (no-snapshot-no-delete · off-git PHI)
| leg | off-git path | rows | sha256(payload) |
|-----|--------------|------|------------------|
| A-(a) | ~/medibuilder-offgit-snapshots/foot-TESTACCT8-legAa-before-snapshot-20260811.json | 80 | `36ef23414b55fa47199cf3781266867d83002a139cc8d105b20c7a06d488bc06` |
| A-(b) | ~/medibuilder-offgit-snapshots/foot-TESTACCT8-legAb-before-snapshot-20260811.json | 91 | `db4346d61983d077a332a0c1c8a42084fb6f20f6b173ca41bba73d0c265e1d9c` |
- per-table 카운트 = 마이그 expect-N 과 100% 일치. in-DB archive(_arch_*)는 마이그 §1 이 무손실 재생성(rollback source).
- ★ 스냅샷은 authoring 시점(2026-08-11) 캡처. apply 시 supervisor 가 GO-token 시점 freeze-set 재대조(행 drift 시 abort) 권고.

## 7. apply-gate 잔여 (순서 고정 · apply_before_go 금지)
| leg | apply-gate |
|-----|-----------|
| A-(a) | supervisor DDL-diff(archive INSERT 컬럼 완전성) + Migration Dry-Run No-Persistence + DB-GATE rows-affected(freeze-set 3행 exact=80행) + 물리 GO-token |
| A-(b) | **CEO 경량 sign-off(H6·§3.1)** + supervisor DDL-diff(up/down) + Dry-Run No-Persistence + DB-GATE rows-affected(2행 exact=91행) + **tgenabled 사후재확인** + 물리 GO-token |
| B | supervisor DB-GATE(freeze-set 2행 + rows-affected=2 + silent 0-row 금지 + GO-token) |

## 8. db_change 4-field (deploy-ready 마킹용)
- **mig_files**: 위 §3 9개 파일(3 legs × up/down/dryrun).
- **mig_dryrun**: 3 legs PASS(§4·dryrun_lib 무영속 3요소).
- **mig_ledger_check**: clean(§5·3자 정합·ADDITIVE forward).
- **mig_rollback**: 각 leg .rollback.sql(parents-first INSERT·ON CONFLICT DO NOTHING 멱등) + off-git before-snapshot(§6 sha256).

## 9. 계정별 처리결과 매트릭스 (AC-4 → planner→responder→총괄)
| 계정 | chart | 처리 | 상태 |
|------|-------|------|------|
| 엄경은2 | F-4691 | 물리삭제(정상) | 마이그 authored·GO-token 대기 |
| 엄경은2(DUMMY) | F-4703 | 물리삭제(정상) | 마이그 authored·GO-token 대기 |
| 풋 서류 테스트 입니다 | F-4468 | 물리삭제(정상) | 마이그 authored·GO-token 대기 |
| 풋테스트3 | F-4425 | 물리삭제(Path-B) | 마이그 authored·CEO H6+GO-token 대기 |
| 송지현2 | F-4692 | 물리삭제(Path-B) | 마이그 authored·CEO H6+GO-token 대기 |
| 풋테스트1 | F-4427 | 테스트표시(is_test·의료법 보존) | flag 마이그 authored·GO-token 대기 |
| 박민석(별건) | F-4445 | 테스트표시(is_test·의료법 보존) | flag 마이그 authored·GO-token 대기 |
| — 서류테스트 F-4990 / 총괄테스트중 F-4574 / 서류테스트2 F-5113 | | 테스트표시 | **旣 완료(Leg B 1차 applied 01:08)** |
| — 김민경 / 박민석 본계정 F-4790 | | KEEP(버그확인용) | 무접촉 confirm |
