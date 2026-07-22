# T-20260715-foot-MASKPII-CONTAM-BACKFILL — MIG-GATE / mutation dry-run 증거

- author: dev-foot / 2026-07-23
- 권위: DA CONDITIONAL GO **MSG-20260723-055448-9j4x** (재자문#2). decision SSOT `da_decision_foot_maskpii_contam_backfill_execution_reconsult2_20260723.md`
- change-class: **DDL 0 (순수 데이터 정정)** — schema_migrations 원장 무접점(SOP §4). 백업=네임스페이스 스키마.
- mutation: **아직 미영속** — 본 단계 = dev dry-run PASS. 실 apply = supervisor DB-GATE.

## 결정 = 전 8행 sentinel disposition

- 트랙 B(`67ea1793`) relink 게이트 실측: masked행 phone(digits 22) ≠ clean twin `a83a5a9e` phone(digits 12), **full E.164 exact match = false** → DA 게이트 "tail4만이면 병합 금지 → sentinel" 발동. CEO가 현장 confirm waive → 데이터측 full-phone bar 미충족 → **relink 보류, 67ea1793도 sentinel**.
- ∴ 트랙 A 7 + 트랙 B 1 = **전 8행 sentinel** (archive-first/FK 열거 불요 — dedup-merge 안 함).
- un-mask 소스 CRM 내부 부재(customers·check_ins 양측 마스킹 전파, raw 복원 불가) → sentinel terminal(DA Q2-i).

## sentinel = `[재수집필요]`

요건 충족: ⓐ `*` 미포함 = reject 트리거 비트립 / ⓑ 대괄호 토큰 = 정당이름과 machine-detectable 구분 / ⓒ worklist 조회가능 `name LIKE '[재수집필요]%'`. NOT NULL 충족. phone 미접촉.

## dual-axis = customers.name UPDATE 만으로 자동 충족 (cascade)

`customers` 트리거 `trg_sync_customer_name`(AFTER UPDATE OF name, WHEN name changed) → `fn_sync_customer_name` 이 NEW.name 을 **check_ins.customer_name + reservations.customer_name 에 자동 전파**. ∴ customers 8행 UPDATE → check_ins 11행 + reservations 0행 동기(§게이트6 양축 동시정정 자동). 명시 check_ins UPDATE = 멱등 잔여 스윕(방어, 정상 0행).

## §2-S 파생 동기필드 완전열거

customer_name denorm 보유 테이블 = check_ins / reservations / closing_manual_payments 3개. 대상 8인 masked copy: reservations **0**, closing_manual_payments **0**(원장 무접점), check_ins **11**(cascade 처리). 외부 미열거 denorm **0**.

## check_ins UPDATE 트리거 안전성 (실측 근거)

- INSERT-only(미발화): `enqueue_dopamine_callback`·`enqueue_dopamine_visited_stage`·`fn_checkin_sync_reservation`·`check_reservation_status` → **dopamine 재-enqueue 없음**.
- UPDATE 발화·무해: `set_completed_at`(status='done' 전이시만) / `fn_checkin_cancel_restore_reservation`(status='cancelled' 전이시만) / `fn_name_nfc_writeguard`(NFC 정규화) / `sync_waiting_board`(mask_display_name 재투영, 예외격리). 이름-only UPDATE = 전부 no-op 또는 무해.
- → 트리거 억제(session_replication_role) **불요**(권한도 불가). 전 트리거 발화 상태로 dry-run PASS.

## no-persist dry-run 결과 (`_mutation_dryrun.mjs`, migration_dryrun_no_persistence_standard 정합)

```
[G0] has_trigger(reject_masked_pii, enabled=O)          ✅ true (실행시점 자체 실측)
[G1] freeze 재검증 (PK8 지문 교집합)                     ✅ live 8 == frozen 8, drift 0
[G2] §2-S denorm 완전열거                                ✅ resv_masked=0 cmp_masked=0 ci_masked=11
[G3a] sentinel _fn_is_masked_pii 평가                    ✅ trips 0/8 (비트립)
[G3c] 현 phone customers_phone_e164_chk verbatim 평가    ✅ 8/8 통과 (name-only UPDATE 재평가 대비)
[G4] no-persist mutation (DO 블록 UPDATE→RAISE rollback) ✅ customers=8 → cascade check_ins sentinel=11·masked잔여=0·잔여스윕=0·reservations=0
[G5] post-probe (영속 0 확인)                            ✅ masked 8/11 불변
결과: PASS
```

- 방식: DO 블록 내 실 UPDATE(양축) 수행 → GET DIAGNOSTICS 카운트 → RAISE EXCEPTION 으로 강제 rollback = 무영속. 사후 post-probe 로 영속 0 재확인. txn-control 내장 없음(DDL 0), sentinel-bypass hazard 무관.
- §3-5 제약 프리플라이트: 술어를 `pg_get_constraintdef` verbatim pull → Postgres 자신이 평가(손 regex 아님). phone CHECK(NOT VALID) 는 name-only UPDATE 시 new-row 재평가되므로 현 phone 전건 통과 사전확인.

## MIG-GATE 4필드

- **mig_files**: `scripts/T-20260715-foot-MASKPII-CONTAM-BACKFILL_mutation.sql` (forward, DDL 0 + 네임스페이스 백업) / `scripts/T-20260715-foot-MASKPII-CONTAM-BACKFILL_mutation_dryrun.mjs` (no-persist dry-run 러너)
- **mig_dryrun**: PASS — 본 문서 G0~G5 (`/tmp/maskpii_dryrun.out` 재현). 실 영속 0.
- **mig_ledger_check**: N/A — DDL 0 데이터 정정, schema_migrations 무접점(SOP §4). 백업=네임스페이스 스키마 `maskpii_bk_20260715`(보존 후 drop), tracked schema 무접점.
- **mig_rollback**: `scripts/T-20260715-foot-MASKPII-CONTAM-BACKFILL_rollback.sql` — pre-image 스키마에서 복원(⚠ 마스킹 원값 복원이라 reject 트리거 LOCAL 억제 필요 = supervisor 권한).

## 잔여 관문 (supervisor DB-GATE — CEO override로도 waive 아님)

1. apply 직전 **freeze 재검증 ABORT** 재실행(G1 동형) — confirm↔apply drift 차단.
2. **has_trigger 실행시점 재확인**(G0 동형, migration_dryrun INV-3).
3. apply = supervisor DB-GATE(DDL-diff = 실질 DDL 0, dry-run PASS 재확인). session_replication_role/DISABLE TRIGGER 는 apply(억제 불요)·rollback(원값복원 시 필요)에서 supervisor 권한.

⚠ 본 단계 실 영속 0. deploy-ready = "dev dry-run PASS, supervisor DB-GATE 대기" 의미. apply 아님.
