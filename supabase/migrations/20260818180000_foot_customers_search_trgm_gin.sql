-- ══════════════════════════════════════════════════════════════════
-- T-20260818-foot-CUSTMGMT-SEARCH-FAIL
--   고객관리 검색 57014 statement timeout RC 해소 — customers 4-컬럼 OR 검색술어
--   전 branch trigram GIN 인덱스 cover (name/phone/birth_date/chart_number)
-- ══════════════════════════════════════════════════════════════════
-- DA CONSULT: DA-20260818-foot-CUSTMGMT-SEARCH-TRGM-GIN = CONDITIONAL-GO (ADDITIVE·비파괴·가역)
-- SSOT: agents/docs/da_replies/da_decision_foot_custmgmt_search_trgm_gin_20260818.md
-- planner: MSG-20260818-142901-uvsx (approved, dependency 해소)
--
-- ⚠⚠ 본 파일은 트랜잭션 블록 밖에서 실행해야 함 (CREATE INDEX CONCURRENTLY 제약). ⚠⚠
--    · BEGIN/COMMIT 으로 감싸지 말 것 (암묵 트랜잭션 래핑 시 CONCURRENTLY 실패).
--    · supabase db push(암묵 트랜잭션) 금지 → statement 단위 분리 실행하는 apply 스크립트로만:
--      node scripts/apply_20260818180000_foot_customers_search_trgm_gin.mjs
--    · ★apply 순서: Gate-B(DA) GO ≠ apply 허가. supervisor DB-GATE 물리 GO-token 발행 후에만 prod apply.
--      GO-token 前 prod DDL 선집행 금지(apply_before_go 클래스).
--
-- ─── RC / dispositive census (DA §3-A, dev-foot 확정) ────────────────────────
--   고객관리 검색술어(src/pages/Customers.tsx applyCustomerSearchFilters, line 139~147) =
--     req.or('name.ilike.%term%, phone.ilike.%term%, birth_date.ilike.%term%, chart_number.ilike.%term%')
--   = 4-컬럼 top-level OR (+ 조건부 phone/birth_date 재-branch, 동일 컬럼).
--   PostgreSQL top-level OR 는 seq-scan 회피 위해 **모든 branch 가 index-satisfiable(BitmapOr)** 해야 함.
--   현 상태: customers 4컬럼 모두 btree 인덱스뿐(idx_customers_phone/birth_date/chart_number) →
--     btree 는 `ilike '%...%'`(leading-wildcard) 를 서비스 못함 → 4-branch 전부 seq-scan →
--     2,371행 × ilike 4회 → 57014 timeout.
--   fix: 4컬럼 전부 gin_trgm_ops(trigram) 인덱스 = OR 全 branch index-backed → BitmapOr → seq-scan 소거.
--   ★DA census-gate 옵션 (a) 채택: birth_date(TEXT YYMMDD) 포함 4번째 GIN 도 cover(최소변경 대칭).
--     미인덱스 OR-branch 잔존 = HARD 지양(H2). birth_date 3컬럼-only fix = fix 미실효 → REJECT.
--
-- ─── change-class = ADDITIVE (DA §2) ────────────────────────────────────────
--   CREATE EXTENSION IF NOT EXISTS + CREATE INDEX CONCURRENTLY ×4. 신규컬럼 0·mutation 0·backfill 0·
--   DROP/타입변경 0·기존행 무영향·완전가역(DROP INDEX IF EXISTS). RLS authz-neutral(인덱스는 후보행
--   탐색만 가속, 행 가시성은 실행시점 RLS 술어로 여전히 게이트 — DA §1). net-new 노출 0(intra-tenant).
--   §3.1 CEO 파괴게이트 N/A. 단 실 DDL 실재 → supervisor DDL-diff + MIG-GATE REQUIRED(DA AC-1).
--
-- ─── 멱등 가드 (DA §2 CONCURRENTLY caveat / H4) ──────────────────────────────
--   CONCURRENTLY 중도실패 시 INVALID 인덱스 잔존 → `CREATE INDEX CONCURRENTLY IF NOT EXISTS` 가
--   그 INVALID 이름을 "존재"로 보고 skip → 영구 미완성. 방어: 각 인덱스마다 생성 전
--   indisvalid=false(INVALID) leftover 만 선-DROP → 그 뒤 IF NOT EXISTS 재생성.
--   healthy 재실행(valid 존재): 선-DROP no-op + IF NOT EXISTS no-op → churn 0.
--
-- 롤백: 20260818180000_foot_customers_search_trgm_gin.rollback.sql (DROP INDEX IF EXISTS ×4)
-- dry-run(무영속): 20260818180000_foot_customers_search_trgm_gin.dryrun.sql
-- 원장대조: 20260818180000_foot_customers_search_trgm_gin.ledger_reconcile.md
-- ticket: T-20260818-foot-CUSTMGMT-SEARCH-FAIL / author: dev-foot / 2026-08-18
-- observability companion 07f0970d = 본 인덱스 fix 와 co-deploy 권장.

-- ── 0) trigram 확장 (멱등, prod 이미 설치됨 → no-op) ────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1) name trigram GIN ────────────────────────────────────────────
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
             WHERE c.relname = 'idx_customers_name_trgm' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_customers_name_trgm';
    RAISE NOTICE 'dropped INVALID leftover: idx_customers_name_trgm';
  END IF;
END $guard$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name_trgm
  ON public.customers USING gin (name gin_trgm_ops);

-- ── 2) phone trigram GIN ───────────────────────────────────────────
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
             WHERE c.relname = 'idx_customers_phone_trgm' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_customers_phone_trgm';
    RAISE NOTICE 'dropped INVALID leftover: idx_customers_phone_trgm';
  END IF;
END $guard$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone_trgm
  ON public.customers USING gin (phone gin_trgm_ops);

-- ── 3) birth_date trigram GIN (DA §3-A census-gate 옵션(a): 4번째 GIN, TEXT YYMMDD) ──
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
             WHERE c.relname = 'idx_customers_birth_date_trgm' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_customers_birth_date_trgm';
    RAISE NOTICE 'dropped INVALID leftover: idx_customers_birth_date_trgm';
  END IF;
END $guard$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_birth_date_trgm
  ON public.customers USING gin (birth_date gin_trgm_ops);

-- ── 4) chart_number trigram GIN ────────────────────────────────────
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
             WHERE c.relname = 'idx_customers_chart_number_trgm' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_customers_chart_number_trgm';
    RAISE NOTICE 'dropped INVALID leftover: idx_customers_chart_number_trgm';
  END IF;
END $guard$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_chart_number_trgm
  ON public.customers USING gin (chart_number gin_trgm_ops);

COMMENT ON INDEX public.idx_customers_name_trgm         IS 'T-20260818-foot-CUSTMGMT-SEARCH-FAIL: 고객관리 4-컬럼 OR 검색 name ilike branch cover (trigram). DA-20260818-CONDITIONAL-GO.';
COMMENT ON INDEX public.idx_customers_phone_trgm        IS 'T-20260818-foot-CUSTMGMT-SEARCH-FAIL: phone ilike branch cover (trigram). 검색어 010… vs 저장 E.164 포맷불일치는 별 축(후속 flag).';
COMMENT ON INDEX public.idx_customers_birth_date_trgm   IS 'T-20260818-foot-CUSTMGMT-SEARCH-FAIL: birth_date(YYMMDD TEXT) ilike branch cover (trigram). DA census-gate 옵션(a) — 미인덱스 OR-branch 잔존 방지.';
COMMENT ON INDEX public.idx_customers_chart_number_trgm IS 'T-20260818-foot-CUSTMGMT-SEARCH-FAIL: chart_number ilike branch cover (trigram).';

-- 검증 쿼리 (apply 후 supervisor POSTCHECK):
--   SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
--     WHERE c.relname LIKE 'idx_customers_%_trgm';               -- 4행 · indisvalid=true
--   EXPLAIN ANALYZE SELECT * FROM customers
--     WHERE name ilike '%김%' OR phone ilike '%김%' OR birth_date ilike '%김%' OR chart_number ilike '%김%';
--     -- expect: BitmapOr(4 Bitmap Index Scan) · Seq Scan 소거 · sub-100ms
