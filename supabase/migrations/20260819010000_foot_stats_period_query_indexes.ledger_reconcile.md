# Ledger Reconcile — T-20260818-foot-STATS-PERIOD-QUERY-INDEX-AGGRPC-DBHARDEN

**표준**: Migration Ledger Reconciliation — 단일표준. REF=rxlomoozakkjesdqjtvd (foot prod), READ-ONLY.
**DA CONSULT**: DA-20260819-foot-STATS-PERIOD-INDEX-AGGRPC (MSG-20260819-004004-diu9) — 조건부 GO, ADDITIVE(index-only).

## 3자 대조 (원장 vs prod 실재 vs 파일선언)

- **파일선언**: `20260819010000_foot_stats_period_query_indexes.sql` — CREATE INDEX CONCURRENTLY 3건(index-only, ADDITIVE):
  1. `idx_foot_reservations_clinic_created_at`  ON reservations (clinic_id, created_at)
  2. `idx_foot_reservations_clinic_resv_date`   ON reservations (clinic_id, reservation_date)
  3. `idx_foot_check_ins_clinic_created_date`   ON check_ins (clinic_id, created_date) WHERE deleted_at IS NULL
  기존 객체(테이블/컬럼/제약/트리거/RLS) mutate 0 · 데이터 write 0.

- **원장(supabase_migrations.schema_migrations)**: 로컬 최신 등재 timestamp < `20260819010000`
  (레포 최신 파일 20260815000000). 신규 버전 `20260819010000` = 원장 미등재 예상(**collision 0**) → forward-only monotonic.
  supervisor DB-GATE 러너가 apply 직전 원장 재대조.

- **prod 실재(pg_indexes)**: 위 3 인덱스명 = prod ABSENT 예상(신규). apply 전 baseline = 3 축 무인덱스 순차 스캔
  (dev-foot RC 실측). apply 후 pg_indexes 에 3건 실재 + pg_index.indisvalid=true = deployed evidence.

## 판정

- **forward-doc 분기**: 신규 timestamp(20260815000000 < 20260819010000) · 원장 미등재 · prod 인덱스 부재
  → 3자 divergence 없음, 정상 forward migration.
- **change-class = index-only (ADDITIVE)** — 파괴 0 · §3.1 CEO 대표게이트 무대상(DA bless). comp-gate N/A(비-금전). backfill SOP N/A(데이터 write 0).
- **CONCURRENTLY 특이**: up/rollback 모두 outer BEGIN/COMMIT 없음(CONCURRENTLY txn-밖 제약). dry-run 은
  BEGIN..ROLLBACK 무영속(DDL 0, read-only preflight+EXPLAIN) — DA Q3 대안1.
  INVALID 인덱스 재시도 룰 = up.sql §0(동명 INVALID 선제 DROP 후 재생성).
- **db-repair/삭제-정정 불요**.
- ★ apply 는 supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지). Gate-B(DA) GO ≠ apply 허가.

## POSTCHECK (apply 후 supervisor 기입 예정)
- pg_indexes 3건 실재 + indisvalid=true.
- EXPLAIN(ANALYZE) 넓은 기간(30일+) 3 쿼리 Seq Scan → Index Scan 전환 + 실행시간 8s statement_timeout 이하 (AC-2).
- schema_migrations version=20260819010000 INSERT.
