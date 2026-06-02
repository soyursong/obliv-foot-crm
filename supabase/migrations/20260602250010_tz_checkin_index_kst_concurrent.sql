-- T-20260602-foot-TZ-AUDIT-FIX (P2) — idx_check_ins_clinic_date KST 정합 재구성 (CONCURRENTLY)
--
-- ⚠⚠ 본 파일은 트랜잭션 블록 밖에서 실행해야 함 (CREATE INDEX CONCURRENTLY 제약). ⚠⚠
--    · BEGIN/COMMIT 으로 감싸지 말 것.
--    · psql -f 또는 statement 단위 분리 실행만(apply_*.mjs 가 statement 별 분리 실행).
--    · supabase db push(암묵 트랜잭션 래핑)로 적용 금지 → apply 스크립트로만.
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- idx_check_ins_clinic_date (20260419000000:157) = (clinic_id, (checked_in_at::date)) — UTC date 표현식.
-- 20260602250000 에서 일일경계 쿼리를 kst_date(checked_in_at) 로 통일 → 기존 UTC-date 인덱스는
-- 표현식 불일치로 planner 가 사용 못 함(인덱스 무용). KST 표현식으로 재구성해 plan 커버 회복.
--   * IMMUTABLE 한 kst_date(ts) 표현식이라 함수 인덱스 가능(idx_checkins_clinic_date_queue 가 이미 사용).
--   * non-unique 헬퍼 인덱스 → 중복/제약 위험 없음(UNIQUE 인덱스 GO_WARN 게이트와 무관).
--   * CONCURRENTLY 로 check_ins 쓰기 락 회피(라이브 CRM 무중단).
--
-- 이름 보존: 임시 *_kst 생성(CONCURRENTLY) → 구 인덱스 drop → RENAME 으로 canonical 명 복귀.
-- 롤백: 20260602250010_tz_checkin_index_kst_concurrent.rollback.sql
-- 적용: node scripts/apply_20260602250010_tz_checkin_index_kst_concurrent.mjs
-- ticket: T-20260602-foot-TZ-AUDIT-FIX
-- author: dev-foot / 2026-06-02

-- (1) 잔존 임시 인덱스 정리 (이전 실패 CONCURRENTLY 가 INVALID 로 남았을 수 있음)
DROP INDEX IF EXISTS idx_check_ins_clinic_date_kst;

-- (2) KST 표현식 인덱스 동시 생성 (쓰기 락 없음)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_check_ins_clinic_date_kst
  ON check_ins (clinic_id, kst_date(checked_in_at));

-- (3) 구 UTC-date 인덱스 제거
DROP INDEX IF EXISTS idx_check_ins_clinic_date;

-- (4) canonical 이름 복귀
ALTER INDEX idx_check_ins_clinic_date_kst RENAME TO idx_check_ins_clinic_date;

COMMENT ON INDEX idx_check_ins_clinic_date IS
  'T-20260602-foot-TZ-AUDIT-FIX: (clinic_id, kst_date(checked_in_at)) — KST 일일경계 쿼리 커버.'
  ' 구 (checked_in_at::date)(UTC) 표현식에서 교체.';  -- tz-exempt: COMMENT 문자열 내 구 표현식 언급(문서), 실행 인덱스는 kst_date()
