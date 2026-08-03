-- DRYRUN (no-persistence): T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
--   목적: up.sql 전제(pg_trgm 설치 가능) + greenfield 안전성(테이블 미충돌·FK 무) 무영속 확인.
--   Migration Dry-Run No-Persistence Protocol 준수: COMMIT 없음 · DDL 미영속 · plpgsql exception-handler
--   내에서 실제 CREATE 를 시도했다가 예외로 롤백(무영속) → 진짜 실행 가능성 검증(sentinel-bypass 회피).
--   실행: psql -f 이 파일. 전제 위반 시 EXCEPTION. 영속 0(사후 introspection 으로 무영속 확인 권장).

DO $$
DECLARE
  v_fail TEXT := '';
BEGIN
  -- ── 1) pg_trgm 설치 가능 여부(이미 설치돼 있으면 통과) ──
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_trgm') THEN
      v_fail := v_fail || ' pg_trgm(미설치+설치불가)';
    ELSE
      RAISE NOTICE 'INFO: pg_trgm 미설치이나 설치 가능 — up.sql 이 CREATE EXTENSION IF NOT EXISTS 로 설치.';
    END IF;
  END IF;

  -- ── 2) greenfield: 대상 테이블은 아직 없어야(멱등 재실행이면 존재 허용, IF NOT EXISTS 무해) ──
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='hira_drug_name_index') THEN
    RAISE NOTICE 'INFO: hira_drug_name_index 이미 존재 — 멱등 재실행(CREATE TABLE/INDEX IF NOT EXISTS 무해).';
  END IF;

  -- ── 3) prescription_codes 실재(cross-ref 대상 카탈로그, FK는 신설 안 하나 코드축 정렬 sanity) ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='prescription_codes') THEN
    RAISE NOTICE 'WARN: prescription_codes 부재 — cross-ref 대상 카탈로그 없음(코퍼스 적재 자체는 무관·FK 무).';
  END IF;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — up.sql 전제 불충족:%', v_fail;
  END IF;
END $$;

-- ── 4) 실제 DDL 무영속 실행 검증(exception-handler 로 강제 롤백 → 영속 0) ──
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE TABLE public._dryrun_hira_drug_name_index (
      item_std_code   text PRIMARY KEY,
      name_ko         text NOT NULL,
      name_normalized text NOT NULL,
      source_ref      text NOT NULL,
      loaded_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX _dryrun_hira_trgm
      ON public._dryrun_hira_drug_name_index USING gin (name_normalized gin_trgm_ops);
    ALTER TABLE public._dryrun_hira_drug_name_index ENABLE ROW LEVEL SECURITY;
    -- 여기까지 성공 = up.sql DDL 실행 가능. 강제 예외로 무영속 롤백.
    RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'DRYRUN_ROLLBACK_SENTINEL' THEN RAISE; END IF;
      RAISE NOTICE 'DRYRUN OK — CREATE TABLE+trigram GIN+RLS DDL 실행 가능(무영속 롤백). up 적용 가능.';
    WHEN OTHERS THEN
      RAISE EXCEPTION 'DRYRUN FAIL — DDL 실행 실패: % (%)', SQLERRM, SQLSTATE;
  END;
END $$;

-- 사후 무영속 확인(introspection): 임시 테이블이 남지 않았는지.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='_dryrun_hira_drug_name_index') THEN
    RAISE EXCEPTION 'DRYRUN POST-PROBE FAIL — 임시 테이블 영속됨(무영속 위반)';
  END IF;
  RAISE NOTICE 'DRYRUN POST-PROBE OK — 영속 0 확인.';
END $$;
