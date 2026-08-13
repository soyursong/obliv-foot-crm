# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Leg A DB-GATE 준비 증적 (dev-foot)

- 실행: dev-foot / 2026-08-10 / foot prod rxlomoozakkjesdqjtvd / Management API (READ-ONLY census + no-persist dry-run)
- 근거: planner NEW-TASK MSG-20260810-164607 (총괄 confirm MSG-20260810-164012-o67t "웅 테스트표시ㄱㄱ") · INFO MSG-20260810-163153-uw4c
- AC-1 census: commit f68b9613
- **상태: prod 미적용(DELETE 0). supervisor DB-GATE GO-token 대기 + form_submissions retention-guard 블로커로 DA CONSULT 대기.**

## 1. Leg A 대상 (5이름 / 6행 customers)
| 이름 | F-id | customer_id |
|------|------|-------------|
| 풋테스트3 | F-4425 | 21a82994-b231-4bcc-94ff-dd9e6c3a4951 |
| 풋테스트1 | F-4427 | e72022d0-7cf5-4f42-b5e3-b5162005b454 |
| 풋 서류 테스트 입니다 | F-4468 | c074025b-cd27-443c-93a9-151d6d4214d4 |
| 송지현2 | F-4692 | d7faae9b-8e0b-421a-b68b-483ede6834a3 |
| 엄경은2 | F-4691 | a0f8c846-9f93-47bf-a79e-57d265d989b6 |
| 엄경은2(DUMMY) | F-4703 | 02594dfa-9428-4405-b640-95ab50ad5e5d |

★ Leg B(is_test, 삭제 금지): 서류테스트 F-4990 · 총괄테스트중 F-4574 · 서류테스트2 F-5113 — 본 마이그 제외.

## 2. 재검증 (freeze-set + identity re-bind)
- 6행 customers 잔존·이름 일치·is_simulation=false·created_by=NULL 확인(_legA_reverify.mjs).
- 동명이인 실고객 배제: NFC exact-match. 송지현 F-4451·엄경은 F-4623 별개행 자동배제. KEEP(김OO/박민석) id충돌 0.
- **LEDGER/MEDICAL GUARD PASS**: payments/service_charges/package_payments/package_credit_ledger/insurance_*/consultation_notes/medical_charts/prescriptions/clinical_images/treatment_photos/consent_forms/patient_file_records/patient_past_history = 전건 0 (closure 전체 깊이).

## 3. FK closure (재귀 resolver, _legA_closure.mjs) — 19 tables / 212 rows
naive `DELETE FROM customers` 는 NO ACTION FK(package_sessions/check_ins via reservation_id 등)로 FK 위반. 재귀 closure 로 전 자식 확정.

| table | rows | 비고 |
|-------|------|------|
| customers | 6 | 6 대상(parent) |
| reservations | 7 | NO ACTION |
| packages | 5 | 빈 회차권(paid_amount0) |
| check_ins | 5 | NO ACTION · AFTER trg sync_waiting_board(benign) |
| assignment_actions | 4 | via check_in_id |
| chart_treatment_requests | 3 | |
| check_in_room_logs | 6 | |
| check_in_services | 49 | ★census 누락분(grandchild via check_in_id) |
| customer_reservation_memos | 1 | |
| customer_treatment_memos | 2 | RESTRICT |
| form_submissions | 3 | ★★ retention-guard 블로커(§4) |
| health_q_results | 2 | RESTRICT |
| health_q_tokens | 3 | |
| reservation_logs | 4 | |
| reservation_memo_history | 2 | |
| status_transitions | 20 | ★census 누락분(grandchild via check_in_id) |
| package_sessions | 1 | |
| notification_logs | 11 | SET NULL → 명시 삭제(테스트 알림) |
| phi_access_log | 78 | loose(FK 없음) → 명시 삭제 |
| **합계** | **212** | 19 tables |

- 삭제 순서: children-first topological(resolver 산출). 롤백: parents-first INSERT(역연산).
- loose-ref completeness scan: uncovered 0 (closure 완전).

## 4. ★★ 블로커 — form_submissions retention guard (census 전제 falsified)
- dry-run 에서 DB 트리거 `trg_form_submissions_published_immutable`(fn `form_submissions_published_immutable_guard`)가 hard-DELETE 전면차단:
  > "서류는 물리적으로 삭제할 수 없습니다 — 삭제는 무효화(soft-delete) 기록으로만 가능합니다" (ERRCODE 42501, 의료법 §22/§40 10년보존)
- **정당 purge = service_role 의 의도적 `ALTER TABLE ... DISABLE TRIGGER` 경유** (트리거 본문에 'DA 명시').
- 대상 3행 상태:
  | form_submission | customer | status | 비고 |
  |---|---|---|---|
  | b4a36c4e | F-4427 풋테스트1 | **printed** | **doc_serial_seq=74 (발번 발행문서)** |
  | 755ac489 | F-4692 송지현2 | voided | |
  | b0edd82a | F-4425 풋테스트3 | draft | template_id NULL |
- form_submissions_audit_log(RESTRICT child)=0 · self source_submission_id ref=0 (추가 blocker 없음).
- **critical path**: form_submissions 는 customers/check_ins 에 NO ACTION FK → 3행 미purge 시 6 customers 물리삭제 불가 = Leg A 전체 blocked.
- **census 판정 'AC-3 step1 DA CONSULT N/A(발행서류 0건)' = falsified** → DA CONSULT 재개 필요.

### 준비된 remediation (GATED)
up.sql 에 DA-sanctioned 경로를 트랜잭션 내 원자 블록으로 구현·dry-run PASS:
```
ALTER TABLE form_submissions DISABLE TRIGGER trg_form_submissions_published_immutable;
DELETE FROM form_submissions WHERE id IN (SELECT id FROM _arch_...);
ALTER TABLE form_submissions ENABLE TRIGGER trg_form_submissions_published_immutable;
```
**실행 게이트: DA CONSULT sign-off(테스트계정 서류 retention-guard 우회 purge 승인) + planner/총괄 재확인(발번문서 포함 물리삭제 vs soft-delete/void 보존) 후에만.** 미승인 시 form_submissions 3행 = soft-delete(void)로 대체하거나 해당 3계정을 Leg B(is_test)로 재분류하는 대안 존재.

## 5. 무영속 dry-run 증적 (dryrun_lib 3요소)
- 러너: `20260810220000_foot_testacct8_legA_cleanup.dryrun.mjs`
- stripped top-level txn-control: ["BEGIN;","COMMIT;"] (INV-5 기록)
- **post-probe 전건 absent=true**: 19 _arch_* 테이블 prod 부재(CREATE 롤백) + customers 6행 잔존(DELETE 롤백).
- **결과: DRY-RUN PASS** (txn-control strip · plpgsql exception-rollback · post-probe absent).

## 6. before-snapshot (no-snapshot-no-delete)
- OFF-GIT: `~/medibuilder-offgit-snapshots/foot-TESTACCT8-legA-before-snapshot-20260810.json`
- sha256: `71c1a6b9fd42f33e79c2eacb60b93831d6f2fc7e5eb78d4214e616df089a4e88` · 212 rows / 19 tables (PHI 포함 → off-git).
- in-DB archive: 마이그 §1 이 `_arch_testacct8_*_20260810` 19 테이블로 무손실 스냅샷(rollback source).

## 7. 산출물
- 마이그: `supabase/migrations/20260810220000_foot_testacct8_legA_cleanup.sql` (+`.rollback.sql`, `.dryrun.mjs`)
- READ-ONLY 스크립트: `_legA_reverify.mjs` · `_legA_closure.mjs` · `_legA_snapshot.mjs`
- 생성기: `_gen_testacct8_legA_migration.mjs`

## 8. 게이트 순서 (AC-3, 미완)
1. ~~before-snapshot~~ ✓ / ~~closure~~ ✓ / ~~dry-run PASS~~ ✓
2. **DA CONSULT** — form_submissions retention-guard purge sanctioned? (§4, census 전제 falsified) — **대기**
3. planner/총괄 재확인 — 발번문서 포함 물리삭제 vs 보존 — **대기**
4. supervisor DB-GATE GO-token → db_apply_guard.sh apply → applied_at + rows-affected POSTCHECK(212) → deployed — **대기**
- ★ GO-token 前 prod DELETE/DDL 선집행 금지(apply_before_go). dev 는 prod 미적용.
