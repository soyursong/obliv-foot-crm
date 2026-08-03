-- DRYRUN (no-persistence): T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
--   목적: up.sql 전제(pg_trgm 가용 · prescription_codes/claim_code/code_source/name_ko 실재 ·
--         is_approved_user() 실재 · schema_migrations 원장 실재) + 신규 테이블 CREATE + GIN trgm 인덱스
--         + RLS 정책 + greenfield seed INSERT + rows-affected assert 를 prod 무영속 검증.
--   Migration Dry-Run No-Persistence Protocol 준수: 전 구간 단일 txn BEGIN..ROLLBACK, COMMIT 문 0
--     → sentinel-bypass hazard 없음(영속 0). 성공 경로도 마지막 ROLLBACK 으로 무영속 보장.
--     ★up.sql 내부 COMMIT 은 본 dryrun 에서 제거됨(txn-control strip) → BEGIN..ROLLBACK 단일 txn 유지.
--   실행: psql -f 이 파일 (prod). 'DRYRUN OK' NOTICE 뜬 뒤 ROLLBACK → 영속 0.
--   사후 무영속 introspection(post-probe): 러너가 ROLLBACK 후 별 세션에서
--     SELECT to_regclass('public.hira_drug_name_index') IS NULL  → true (테이블 미영속) 확인.

BEGIN;

-- ── 1) 전제: 의존객체/컬럼/확장/헬퍼 실재 ──
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF to_regclass('public.prescription_codes') IS NULL THEN
    v_missing := v_missing || ' public.prescription_codes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='prescription_codes' AND column_name='claim_code') THEN
    v_missing := v_missing || ' prescription_codes.claim_code'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='prescription_codes' AND column_name='code_source') THEN
    v_missing := v_missing || ' prescription_codes.code_source'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='prescription_codes' AND column_name='name_ko') THEN
    v_missing := v_missing || ' prescription_codes.name_ko'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE p.proname='is_approved_user') THEN
    v_missing := v_missing || ' is_approved_user()'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_missing := v_missing || ' supabase_migrations.schema_migrations(ledger)'; END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing;
  END IF;
  RAISE NOTICE 'DRYRUN OK — 전제 충족(의존객체/컬럼/헬퍼/원장 실재)';
END $$;

-- ── 2) trigram 확장 (멱등, up.sql §0 동일) ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 3) 신규 테이블 (up.sql §1 동일) ──
CREATE TABLE IF NOT EXISTS public.hira_drug_name_index (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_std_code   text        NOT NULL,
  name_ko         text        NOT NULL,
  name_normalized text        NOT NULL,
  ingredient_code text        NULL,
  ingredient_name text        NULL,
  source_ref      text        NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hira_drug_name_index_item_std_code_key UNIQUE (item_std_code)
);

-- ── 4) GIN trigram 인덱스 (up.sql §2 동일) ──
CREATE INDEX IF NOT EXISTS hira_drug_name_index_name_norm_trgm
  ON public.hira_drug_name_index USING gin (name_normalized gin_trgm_ops);

-- ── 5) RLS (up.sql §3 동일) ──
ALTER TABLE public.hira_drug_name_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hira_drug_name_index_approved_read ON public.hira_drug_name_index;
CREATE POLICY hira_drug_name_index_approved_read ON public.hira_drug_name_index
  FOR SELECT TO authenticated USING (is_approved_user());

-- ── 6) greenfield seed (up.sql §4 동일) ──
INSERT INTO public.hira_drug_name_index (item_std_code, name_ko, name_normalized, source_ref)
SELECT DISTINCT ON (regexp_replace(pc.claim_code, '^HIRA-', ''))
  regexp_replace(pc.claim_code, '^HIRA-', ''),
  pc.name_ko,
  lower(regexp_replace(btrim(pc.name_ko), '\s+', ' ', 'g')),
  'prescription_codes:' || pc.id::text || ' | src=data.go.kr/15067462(A) | lineage=T-20260617-HIRA-MAP'
FROM public.prescription_codes pc
WHERE pc.claim_code LIKE 'HIRA-%'
  AND pc.code_source = 'official'
  AND pc.name_ko IS NOT NULL
  AND btrim(pc.name_ko) <> ''
ORDER BY regexp_replace(pc.claim_code, '^HIRA-', ''), pc.id
ON CONFLICT (item_std_code) DO NOTHING;

-- ── 7) rows-affected assert + 스모크(trigram 질의 컴파일/실행) ──
DO $$
DECLARE v_eligible int; v_loaded int; v_probe int;
BEGIN
  SELECT count(DISTINCT regexp_replace(pc.claim_code, '^HIRA-', ''))
    INTO v_eligible
  FROM public.prescription_codes pc
  WHERE pc.claim_code LIKE 'HIRA-%' AND pc.code_source='official'
    AND pc.name_ko IS NOT NULL AND btrim(pc.name_ko) <> '';
  SELECT count(*) INTO v_loaded FROM public.hira_drug_name_index;
  IF v_loaded < v_eligible THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 부분적재: eligible(distinct)=% > loaded=%', v_eligible, v_loaded;
  END IF;
  -- trigram similarity 질의(서빙 topology VG-1: FE bounded SELECT) 컴파일/실행 스모크
  SELECT count(*) INTO v_probe
  FROM public.hira_drug_name_index
  WHERE name_normalized % '테스트대조명';
  RAISE NOTICE 'DRYRUN OK — 테이블/인덱스/RLS/seed 검증 통과. eligible=%, loaded=%, trgm-probe=% (무영속).', v_eligible, v_loaded, v_probe;
END $$;

-- 무영속 보장: COMMIT 없음 → 명시 ROLLBACK 으로 전량 폐기.
ROLLBACK;

-- 사후 무영속 확인(러너, 별 세션):
--   SELECT to_regclass('public.hira_drug_name_index') IS NULL;  -- expect true (미영속)
