-- ============================================================
-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — CARVE-B staff_attendance soft-delete envelope (ADDITIVE)
-- ============================================================
-- planner NEW-TASK: MSG-20260814-012502-4px8 (CARVE-B authoring 병렬 착수 GO · a안)
--   설계 SSOT: DA-20260813-meta-SOFTDELETE-ARCHIVEFIRST-REACTIVATION-LOCK §2-1
--   Q3 canonical flag = domain-uniform `deleted_at` BINDING (DA REPLY MSG-20260814-002921-lb8f §ADDENDUM #1).
--   Q6 deleted_by = foot incumbent plain UUID(FK 미설정).
-- census      : db-gate/T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK_carve-census.md §Q2 (Tier-1)
--
-- ⚠️⚠️ APPLY 게이트 (apply_before_go 금지 · AC-1) ⚠️⚠️
--   본 파일은 **staged ADDITIVE DDL** 이다. prod 적용은 supervisor DDL-diff + code-gate + 물리 GO-token 선행 후에만.
--   EF(attendance-sync) 의 hard-DELETE→soft-UPDATE 라우팅 배포는 **본 DDL apply 와 원자적**으로(선-apply/후-deploy)
--   supervisor 게이트에서 순서 집행. 컬럼 부재 상태로 EF 만 배포 시 런타임 실패 → EF deploy 금지(본 authoring 은 코드 커밋까지만).
--
-- ★canonical envelope (envelope REWORK 와 동일 dialect · Q3 domain-uniform deleted_at BINDING):
--   deleted_at     TIMESTAMPTZ NULL   ← ★단일 canonical 술어. 술어 = `deleted_at IS NULL`(=활성/출근유효).
--   deleted_by     UUID        NULL   ← 삭제 수행자 auth.uid(). EF(service_role) 경로는 NULL(시스템 actor).
--                                        foot incumbent plain UUID(FK 미설정) = actor 삭제 후에도 이력 생존.
--   deleted_reason TEXT        NULL   ← 삭제(시트제거) 사유 보존. 철자 = DA canonical `deleted_reason`.
--
--   ▸▸ is_deleted BOOLEAN stored 컬럼 = HARD REJECT(추가/신설 금지). envelope REWORK 와 동일 이유
--      (foot 지배 라이브 패턴 = deleted_at IS NULL · two-dialect 제조 금지).
--
-- ▸ Tier-1 preserve 정합(근로기준법§42 임금대장 3년 보존):
--   attendance-sync:412 의 물리 hard-DELETE(시트에서 빠진 출근행 제거)를 soft-delete(deleted_at UPDATE)로 전환.
--   → "출근으로 마킹됐다가 시트에서 제거된" 진성 근태 이력을 물리 파기하지 않고 감사 보존.
--   hard-DELETE BLOCKED 유지 · exact-dup 구조불가(UNIQUE(clinic_id,date,staff_id) 旣존) → toDelete=distinct stale 만.
--
-- ▸ FOR DELETE grant: staff_attendance RLS 는 SELECT/INSERT/UPDATE 정책만·FOR DELETE 정책 부재(census C8).
--   실 removal surface = EF service_role `.delete()`(RLS bypass) → REVOKE 로는 못 막음.
--   ∴ 집행은 grant층 아닌 **EF 코드층**(hard-DELETE→soft UPDATE 리팩터). 본 마이그는 순수 envelope 컬럼만(REVOKE 미포함).
--
-- backfill 0 · DROP 0 · IF NOT EXISTS(멱등) · 기존 행 mutation 0(신규 컬럼 전량 NULL default).
-- rollback: 20260814010000_foot_staff_attendance_softdelete_envelope.rollback.sql
-- dryrun  : 20260814010000_foot_staff_attendance_softdelete_envelope.dryrun.sql
-- ============================================================

BEGIN;

-- ── staff_attendance (Tier-1 근태 감사 보존 · deleted_at soft-delete 축) ──
--   기존: attendance-sync reconcile 이 시트제거 출근행을 hard-DELETE. 축 신설 후 EF 가 soft UPDATE 로 전환.
--   재활성화(deleted_at → NULL): 시트에 다시 출근으로 나타난 직원은 UPDATE 로 in-place 복원(UNIQUE 무충돌).
ALTER TABLE staff_attendance
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;

COMMENT ON COLUMN staff_attendance.deleted_at     IS 'soft-delete 술어(deleted_at IS NULL=활성/출근유효). 시트제거 근태행을 물리파기 대신 비활성 마킹(근로기준법§42 3년 보존). 재활성화=deleted_at→NULL in-place UPDATE. T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK(CARVE-B)';
COMMENT ON COLUMN staff_attendance.deleted_by     IS '삭제 수행자 auth.uid(). EF(attendance-sync·service_role) 경로는 NULL(시스템 actor). foot incumbent plain UUID · FK 미설정(이력 생존).';
COMMENT ON COLUMN staff_attendance.deleted_reason IS '삭제(시트제거) 사유 보존. EF reconcile 은 정형 사유 마커 기록.';

COMMIT;
