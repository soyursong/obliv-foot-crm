-- ROLLBACK: T-20260818-foot-STATS-PERIOD-QUERY-INDEX-AGGRPC-DBHARDEN
--   up.sql(20260819010000_foot_stats_period_query_indexes.sql) 완전 가역 되돌림.
--   change-class = index-only → 롤백 = DROP INDEX. 데이터 0·컬럼/제약/트리거/RLS 무접촉 → 무손실.
--
-- ★ CONCURRENTLY 로 생성했으므로 DROP 도 CONCURRENTLY(무중단 · 명시 txn 밖 필수).
--   본 파일도 outer BEGIN/COMMIT 없음(각 statement autocommit).
-- ★ IF EXISTS — 부분적용/미적용 상태에서도 안전 재실행(멱등).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_foot_reservations_clinic_created_at;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_foot_reservations_clinic_resv_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_foot_check_ins_clinic_created_date;

-- 검증 (롤백 후):
--   SELECT count(*) FROM pg_indexes
--     WHERE schemaname='public'
--       AND indexname IN ('idx_foot_reservations_clinic_created_at',
--                         'idx_foot_reservations_clinic_resv_date',
--                         'idx_foot_check_ins_clinic_created_date');  -- expect 0
