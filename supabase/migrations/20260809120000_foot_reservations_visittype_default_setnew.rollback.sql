-- ROLLBACK (VG5 대칭): 20260809120000_foot_reservations_visittype_default_setnew
--
-- 본 마이그레이션 = reservations.visit_type 컬럼 DEFAULT 를 'returning' → 'new' 로 교정(metadata-only DDL).
-- 롤백 = 상속 상태(DEFAULT 'returning')로 원복.
--
-- ⚠ VG5 대칭 원복 = 2단:
--   (a) DDL down (본 파일): SET DEFAULT 'returning'.
--   (b) EF revert: reservation-ingest-from-dopamine index.ts:776 을
--       `...(slotType ? { visit_type: slotType==='new_consult'?'new':'returning' } : {})` (spread-omit)로 되돌림
--       = git revert of the (b) diff. (본 SQL 파일 범위 밖 — 코드 롤백.)
--
-- ⚠ 원복 시 = bare INSERT(foot LIVE path) 발생 시 재진(returning)을 무근거 선착지시키는
--   fail-open outlier 로 회귀 = latent-hazard 재개통. LIVE fork 이므로 (b) revert 없이 (a)만 원복하면
--   EF 명시 착지가 유지되어 여전히 안전(belt-and-suspenders). 완전 원복은 (a)+(b) 동시.
--
-- 멱등: 현재 default 확인 후 'returning' 아닐 때만 SET(재실행 안전).

BEGIN;

DO $$
DECLARE
  v_cur text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_cur
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname = 'reservations' AND a.attname = 'visit_type';

  IF v_cur IS NULL OR v_cur !~ '^''returning''' THEN
    ALTER TABLE public.reservations ALTER COLUMN visit_type SET DEFAULT 'returning';
    RAISE NOTICE 'VISITTYPE_DEFAULT_ROLLBACK: reservations.visit_type DEFAULT % -> ''returning''::text 원복', COALESCE(v_cur, 'NULL');
  ELSE
    RAISE NOTICE 'VISITTYPE_DEFAULT_ROLLBACK: reservations.visit_type DEFAULT 이미 % (멱등 no-op)', v_cur;
  END IF;
END $$;

COMMIT;
