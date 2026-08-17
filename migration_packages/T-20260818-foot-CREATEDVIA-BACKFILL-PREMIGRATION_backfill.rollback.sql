-- ROLLBACK — T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION
-- backfill 로 채운 188행(FS1 dopamine 1 + FS2 manual 187)만 정확히 NULL 로 되돌림.
-- before-image: 대상 188행 전부 created_via=NULL 였음(dryrun.json before_image_purity FS1/FS2 nonnull_pre=0).
-- ★ 정밀 rollback: id 화이트리스트로 제한 → 정상 운영 중 신규로 채워진 값 오손 방지.
--   (FS1 1 id + FS2 187 ids = dryrun.json before_image_fs1[].id + before_image_fs2_ids[])
-- 단순형(아래)은 "이 backfill 이 채운 값만" 되돌리는 근사: predicate 로 대상 재식별.
-- apply 직후 즉시 롤백용. 시간 경과 후에는 id 화이트리스트 버전 사용 권장.

BEGIN;

-- FS1 dopamine 되돌림 (created_at >= mig 인 dopamine-marker 행만; 이 backfill 이 유일 fill 원천)
UPDATE public.reservations
   SET created_via = NULL
 WHERE created_via = 'dopamine'
   AND source_system = 'dopamine'
   AND external_id IS NOT NULL
   AND created_at >= '2026-06-29 11:09:35.494874+00'
   AND id = '2fb4885d-7a96-4881-8859-c0645724ea75';

-- FS2 manual 되돌림 (pre-mig manual 187 — 이 backfill 대상 predicate 와 동일)
UPDATE public.reservations
   SET created_via = NULL
 WHERE created_via = 'manual'
   AND created_at < '2026-06-29 11:09:35.494874+00'
   AND source_system IS NULL
   AND external_id IS NULL;

COMMIT;
-- rollback 후: created_via IS NULL 총량 == 200 (원상). POSTCHECK 로 확인.
