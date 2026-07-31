-- ============================================================================
-- T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL — APPLY (data-correction)
--   미사용 코디네이터 계정 비활성화 (Option B, 김주연 총괄 U0ATDB587PV 2026-07-31 18:35)
--
-- ⚠⚠⚠ supervisor dry-run(data-diff) 게이트 통과 후에만 prod 집행. ⚠⚠⚠
--   dry-run(무영속): scripts/T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL_deactivate_dryrun.mjs
--   rollback      : scripts/T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL_deactivate.rollback.sql
--   before 스냅샷 : scripts/T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL_before_snapshot.json
--
-- Data-Correction Backfill SOP 봉투:
--   · id 지목 단건 정정 — WHERE = id + email 이중앵커 (단일 count 기준 blanket UPDATE 아님)
--   · 대상 유일성 가드(match=1 아니면 ABORT) + 사후상태 post-condition 가드
--   · 멱등 — active=true 술어로 재실행 시 0-row (사후 가드는 여전히 통과)
--   · 원장(schema_migrations 등) 무접점 — 순수 data UPDATE, DDL 0
--   · caller-clinic 게이트/pass_same_clinic 무접점 — 계정 active 플래그만 변경
--   · approved/role/clinic_id/name/email 등 타 컬럼 무접점 (rollback 완전가역)
--   · staff 레코드 없음(staff_row_count=0) → staff.active 동기화 불요 (no-op)
-- ============================================================================

BEGIN;

-- (1) 대상 유일성 가드: id+email 이중앵커가 정확히 1행이어야 착수.
DO $guard$
DECLARE v_match int;
BEGIN
  SELECT count(*) INTO v_match
    FROM public.user_profiles
   WHERE id = '68c50c25-8725-4e96-8a52-c47dde03a786'
     AND lower(email) = lower('sj.lee0719@medibuilder.com');
  IF v_match <> 1 THEN
    RAISE EXCEPTION 'ABORT: target anchor matched % rows (expected exactly 1)', v_match;
  END IF;
END $guard$;

-- (2) 단건 비활성화 — id+email 앵커 + active=true (멱등).
UPDATE public.user_profiles
   SET active = false
 WHERE id = '68c50c25-8725-4e96-8a52-c47dde03a786'
   AND lower(email) = lower('sj.lee0719@medibuilder.com')
   AND active = true;

-- (3) 사후상태 post-condition: 대상 row 최종상태 active=false 확정.
DO $post$
DECLARE v_active boolean;
BEGIN
  SELECT active INTO v_active
    FROM public.user_profiles
   WHERE id = '68c50c25-8725-4e96-8a52-c47dde03a786';
  IF v_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: post-state active=% (expected false)', v_active;
  END IF;
  RAISE NOTICE 'OK: user_profiles(68c50c25...) active=false 확정 (이승준 코디, 비활성화 완료)';
END $post$;

COMMIT;
