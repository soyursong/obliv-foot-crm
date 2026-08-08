-- DRY-RUN (무영속): T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE (a)
--   Migration Dry-Run No-Persistence Protocol 준수.
--   foot 는 Management API PAT 보유 → 무영속 검증 = plpgsql DO 블록 안에서 forward(SET DEFAULT) 실행 후
--     RAISE EXCEPTION 으로 전체 롤백(DO 블록 트랜잭션 abort) → 영속 0. in-txn 관측값은 예외 메시지로 회수.
--   그 후 post-probe 로 prod default 가 여전히 'returning'(비영속) 임을 fresh 쿼리로 실측(INV-3).
--   (INV-1 txn-control strip: 본 검증은 forward 파일의 top-level BEGIN;/COMMIT; 를 사용하지 않고
--    DO 블록 단일-statement 로 실행 → 조기 COMMIT sentinel-bypass 원천 부재.)
--   실 러너: db-gate/T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE_dryrun.mjs
--
-- 검증 시나리오:
--   A. 적용 중(in-txn, DO 블록 내): reservations.visit_type default = 'new'::text (예외 메시지로 회수).
--   B. RAISE EXCEPTION 롤백 후(post-probe): default = 'returning'::text (비영속 실증).
--   C. CHECK 제약 3-type[new,returning,experience] 'new' 포함 → SET DEFAULT 'new' 무파손(VG2).
--   D. schema_migrations 원장에 20260809120000 부재(미적용 상태 유지).
--
-- ▼ 무영속 재현 SQL(단일 statement, RAISE EXCEPTION 자동 롤백). 실 PASS 판정은 러너가 수행.

DO $$
DECLARE
  v_in text;
BEGIN
  ALTER TABLE public.reservations ALTER COLUMN visit_type SET DEFAULT 'new';
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_in
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname = 'reservations' AND a.attname = 'visit_type';
  -- (TEST A) in-txn default 회수 후 강제 롤백 → 무영속 보장
  RAISE EXCEPTION 'DRYRUN_NOPERSIST in_txn_default=%', v_in;
END $$;

-- (TEST B) 위 예외로 ALTER 롤백됨. 아래 fresh 쿼리로 default 여전히 'returning'::text 실측(러너 post-probe).
-- SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
--   JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
--   WHERE n.nspname='public' AND c.relname='reservations' AND a.attname='visit_type';   -- expect 'returning'::text

-- (TEST C) CHECK 제약에 'new' 포함 확인
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.reservations'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%visit_type%';

-- (TEST D) SELECT ... FROM supabase_migrations.schema_migrations WHERE version='20260809120000' → 0행(미적용).
