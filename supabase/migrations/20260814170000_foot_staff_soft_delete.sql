-- ============================================================
-- T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT — staff soft-delete(deleted_at) single-axis
-- ============================================================
-- DA CONSULT-REPLY(정본): CONDITIONAL-GO (coherence-extension)
--   DA-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT / MSG-20260814-221208-dpnm
--   · 삭제 = soft-delete(deleted_at) canonical. client .delete() hard-delete = REJECT-as-mechanism.
--     staff 행 물리 삭제 금지 — '삭제' 의미 = 목록에서 제거(deleted_at 스탬프), 물리 purge 아님.
--   · zero-ref 테스트계정도 uniform soft-delete(참조 유무로 hard/soft 분기 금지).
--   · 비활성 = active(가역 일시중단) / 삭제 = deleted_at(목록제거). 둘 다 비파괴 · NEITHER hard-delete.
--   · status='deleted' enum split 금지 — single-axis deleted_at(timestamp NULL/NOT NULL)만.
--   · created_by(§416 provenance) SET-NULL trigger 는 staff soft-delete 로 by-construction moot
--     (부모행 물리보존 → FK 유효) → child(notices/reservations/staff_attendance/staff_capabilities/
--     check_ins.created_by) archive-first 불요. archive 대상 = staff 행 자체(deleted_at).
--
-- change-class = ADDITIVE (신규 nullable 컬럼 3 + partial index. DROP/타입변경/기존행 mutation/backfill 0).
--   §3.1 CEO 파괴게이트 N/A(데이터파괴0·가역)이나 DDL-0 carve 아님 →
--   supervisor DDL-diff + MIG-GATE + DB-GATE 물리 GO-token 선행 REQUIRED(apply_before_go 금지).
--
-- 미러 canon: scalp2 deleted_at single-axis + foot form_submissions soft-delete
--   (20260802150000_foot_form_submissions_softdelete_audit.sql — deleted_at/deleted_by 3컬럼 패턴).
--   ※ staff 는 config/staff-scoped(비-PHI 법적 의무기록 아님) → audit_log·immutable-guard·RESTRICTIVE
--     RLS 는 도입하지 않음(DA reply 범위 밖 scope creep 회피). 순수 ADDITIVE 3컬럼 + 활성행 partial index.
--
-- ⚠️ ADDITIVE ONLY. 기존 staff 행 = deleted_at NULL default(전량 활성). 무손실·무 rewrite.
-- 롤백:  20260814170000_foot_staff_soft_delete.rollback.sql
-- dry-run: 20260814170000_foot_staff_soft_delete.dryrun.mjs (canonical no-persistence runner)
-- ============================================================

BEGIN;

-- ── staff soft-delete 컬럼 (ADDITIVE, single-axis authority = deleted_at) ──
--   deleted_at 단일 authority atom(NULL=활성 / NOT NULL=목록제거). mutable bool 미도입(divergence 구조불가).
--   3컬럼 전량 nullable default NULL → rewrite 없이 즉시 반영(기존 행 전량 활성 유지).
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ NULL,   -- soft-delete 단일 authority(NULL=활성). '삭제'=목록제거 스탬프. hard-DELETE 대체.
  ADD COLUMN IF NOT EXISTS deleted_by      UUID        NULL,   -- 삭제 수행자 auth.uid()(감사)
  ADD COLUMN IF NOT EXISTS deleted_reason  TEXT        NULL;   -- 삭제 사유/맥락(보존, UI 기본 마커)

COMMENT ON COLUMN staff.deleted_at     IS 'soft-delete 단일 authority(NULL=활성). ''삭제''=목록/드롭다운에서 제거(deleted_at 스탬프). 물리 삭제 금지. active(비활성/가역)와 직교 축. T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT';
COMMENT ON COLUMN staff.deleted_by     IS '삭제 수행자 auth.uid()(감사). T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT';
COMMENT ON COLUMN staff.deleted_reason IS '삭제 사유/맥락(보존). T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT';

-- 활성행(deleted_at IS NULL) 목록 조회 최적화 partial index (술어 = deleted_at IS NULL 통일).
--   staff 소테이블 → 트랜잭션 내 CREATE INDEX(비-CONCURRENTLY) 락 무해.
CREATE INDEX IF NOT EXISTS idx_staff_active_not_deleted
  ON staff (clinic_id, role)
  WHERE deleted_at IS NULL;

-- ── 검증(마이그레이션 자체 유효성, supervisor DDL-diff self-check) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'staff.deleted_at 컬럼 추가 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff' AND column_name='deleted_by') THEN
    RAISE EXCEPTION 'staff.deleted_by 컬럼 추가 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff' AND column_name='deleted_reason') THEN
    RAISE EXCEPTION 'staff.deleted_reason 컬럼 추가 실패'; END IF;
  -- deleted_at 은 nullable 이어야 함(default NULL, 기존행 전량 활성 유지)
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff' AND column_name='deleted_at' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'staff.deleted_at 이 NOT NULL — nullable(default NULL) 이어야 함(기존행 무손실)'; END IF;
  -- 활성행 partial index 술어 = deleted_at IS NULL
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='staff'
      AND indexname='idx_staff_active_not_deleted' AND indexdef ILIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION 'idx_staff_active_not_deleted 술어가 deleted_at IS NULL 아님'; END IF;
  RAISE NOTICE 'T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT: staff soft-delete 3컬럼 + 활성행 partial index ADDITIVE 검증 통과';
END $$;

COMMIT;
