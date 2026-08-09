-- DRY-RUN (무영속): T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT (§24 고유식별정보)
--   Migration Dry-Run No-Persistence Protocol 준수.
--   단일 DO 블록 안에서 forward(ADD COLUMN) 실행 후 RAISE EXCEPTION 으로 전체 롤백 → 영속 0.
--   (INV-1 txn-control strip: top-level BEGIN;/COMMIT; 미사용, DO 단일-statement → 조기 COMMIT sentinel-bypass 부재.)
--   in-txn 관측값(nullable/default/기존행 NOT NULL 수)은 예외 메시지로 회수.
--
--   ⚠ 범위: 본 dryrun 은 컬럼-레벨 ADDITIVE 불변식(VG5 backfill0/nullable, 기존행 mutation0)만 무영속 검증.
--     함수-레벨 VG1(끝-append·오버로드0)/VG2(3-튜플 원자성)/VG3(sensitive-only 무회귀)은 supervisor DDL-diff +
--     up.sql 전체를 rolled-back txn 으로 적용하는 db-gate 러너가 검증(함수 본문은 DO EXECUTE 부적합 → up.sql 직접).
--
-- 검증 시나리오:
--   A (VG5). ADD COLUMN 후 is_nullable=YES · column_default IS NULL (forward-only, no DEFAULT).
--   B (VG5/backfill0). 기존 customers 전건 consent_unique_id IS NULL (mutation0 — ADD 만으로 값 안 씀).
--   C (VG4). 본 마이그 텍스트가 RRN 원문 컬럼(encrypted_rrn/rrn_encrypt) 무접촉 = 정적 census(러너 grep, 여기선 註記).
--   D. schema_migrations 원장에 20260809160000 부재(미적용 상태 유지, 러너 post-probe).

DO $$
DECLARE
  v_is_nullable text;
  v_default     text;
  v_notnull_cnt int;
BEGIN
  -- forward 적용(in-txn)
  ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS consent_unique_id BOOLEAN;

  -- (TEST A) nullable + no default
  SELECT is_nullable, column_default
    INTO v_is_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='consent_unique_id';

  -- (TEST B) 기존행 mutation0 — ADD COLUMN 직후 값 있는 행 수(0 이어야 함)
  SELECT count(*) INTO v_notnull_cnt
    FROM public.customers WHERE consent_unique_id IS NOT NULL;

  -- 강제 롤백 → 무영속. 관측값 예외로 회수.
  RAISE EXCEPTION 'DRYRUN_NOPERSIST is_nullable=% (expect YES) default=% (expect <NULL>) existing_notnull=% (expect 0)',
    v_is_nullable, COALESCE(v_default,'<NULL>'), v_notnull_cnt;
END $$;
