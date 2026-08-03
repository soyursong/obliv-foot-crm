-- ══════════════════════════════════════════════════════════════════
-- T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
--   풋 약 외부검증 — HIRA 명칭 인덱스 코퍼스 적재 (신규 전용 참조테이블)
-- ══════════════════════════════════════════════════════════════════
-- 부모: T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2 (AC-8, gate-clean carve #2).
-- DA CONSULT-REPLY: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (MSG-20260803-202232-0a3w).
--   verdict = GO / Option A 신규 전용 테이블 hira_drug_name_index + GIN trigram(pg_trgm).
--   prescription_codes 위 보강 = REJECT(grain collision). ADDITIVE·§3.1 대표게이트 면제.
--   게이트 = supervisor MIG-GATE만.
-- SSOT: 1_Projects/201_메디빌더_AI도입/da_decision_foot_rxset_hira_name_index_ac8_20260803.md
--
-- ── 목적 ──────────────────────────────────────────────────────────
--   약 이름 검색 매칭 정확도 향상용 HIRA 공식 명칭 코퍼스(참조 유니버스)를 담는
--   전용 read-only 참조테이블. FE drugVerification 'partial'(코드 부재→상품명 대조) 판정의
--   명칭 코퍼스를 제공한다. (활성화=AC-3/AC-7 소관, 본 마이그=코퍼스 적재만 — VG-4.)
--
-- ── grain firewall (DA §1) ────────────────────────────────────────
--   prescription_codes = 병원 로컬 카탈로그(billing 권위·스태프 큐레이션·claim_code UNIQUE).
--   hira_drug_name_index = 외부 참조 유니버스(심평원 고시 명칭 코퍼스·read-only·상류 refresh).
--   → 마스터는 마스터 테이블에, 카탈로그는 카탈로그에. 절대 섞지 않는다.
--
-- ── change-class = ADDITIVE only (DA §5) ──────────────────────────
--   신규 테이블 + 인덱스 + greenfield INSERT. 기존 객체 mutate 0·타입변경 0·제약제거 0.
--   → §3.1 대표게이트(CEO) 면제. comp-gate N/A(비-금전/비-entitlement). backfill SOP N/A(greenfield).
--   PHI/거버넌스: HIRA 명칭 마스터 = 공개 참조데이터 → 비-PHI·비-금전·비-원장.
--
-- ── HARD verify-gate 해소 (frontmatter da_verify_gate VG-1~4) ──────
--   VG-1 (query-path topology): 서빙 = FE bounded trigram SELECT(RLS authenticated SELECT-only).
--       ★신규 SECDEF lookup RPC 미착지 = 의도적 결정 — RLS authenticated SELECT로 충분(DA §5),
--        SECDEF RPC 신설은 durable-baseline pin 트리거(re-CONSULT (b))라 회피. read-path 변경 0.
--       (FE는 name_normalized 위 trigram similarity 를 LIMIT-bounded 로 질의 — 코퍼스 전량 FE-load 아님.)
--   VG-2 (코드축 정렬): item_std_code = 품목기준코드9(HIRA 상품표준코드 namespace).
--       prescription_codes.claim_code 'HIRA-{품목기준코드9}' 접두를 strip 한 값 = 동일 코드축.
--       ★EDI 코드축(급여 bare) 혼용 금지 — 'HIRA-' 접두 official 만 seed(bare EDI 제외).
--   VG-3 (FK 무·decoupling): prescription_codes→index FK 신설 금지. reference-lookup only.
--       (기존 hira_mapped_to_code_id 'no FK' 최소스펙 계승 → DROP-rollback orphan 무.)
--   VG-4 (verdict 이중거버넌스 회피): 본 마이그 = 코퍼스 적재만. verify 결과 backfill/ recompute 안 함
--       (그건 AC-3 소관). AC-3 double-governance 없음.
--
-- ── 대량적재 안전 (DA §4, AC-8-2) ─────────────────────────────────
--   멱등 = INSERT ... ON CONFLICT (item_std_code) DO NOTHING (자연 unique 키). 재실행 = no-op.
--   rows-affected assert = seed 소스행 == 적재행(부분적재 abort).
--   롤백 = DROP TABLE(greenfield 전용 테이블 → clean, FK 무 → dependent 무).
--   dry-run 무영속 검증 = ..._ac8.dryrun.sql (Migration Dry-Run No-Persistence Protocol).
--
-- ── HIRA 소스 단일 재사용 (AC-8-1) ────────────────────────────────
--   소스 = T-20260617 HIRA-MAP 과 동일 상류(data.go.kr 15067462 = AC-1 source A).
--   초기 코퍼스 seed = 이미 DB 에 materialize 된 HIRA-provenance official 코드
--     (prescription_codes.claim_code LIKE 'HIRA-%' AND code_source='official')
--     = T-20260617/data.go.kr lineage. 다른 벤더/마스터 금지 → 코드 일관성 보존.
--   ★중복적재 금지 해석(DA §3) = '같은 상류에서 파생'(코드 consistency)이지 '한 번만 적재 가능' 아님.
--     ON CONFLICT DO NOTHING 로 재실행/추가적재 시 이미 있는 item_std_code 는 skip.
--   ★완전성 노트(no silent cap): 초기 seed = 병원 활성 카탈로그의 HIRA-official 서브셋.
--     더 넓은 source-A CSV(15067462) 코퍼스는 동일 멱등 loader(ON CONFLICT DO NOTHING)로
--     추가 적재하는 후속 data-provisioning 스텝(코드변경 아님). 본 마이그는 durable 스키마 +
--     멱등 loader machinery + 가용 canonical seed 를 확정한다.
--
-- risk: GO_WARN — 신규 테이블 1 + 인덱스 2(unique + GIN trgm) + greenfield INSERT. 파괴 0.
--   base-table/컬럼/제약/트리거/RLS(기존)/원장 무접촉. 롤백 = DROP TABLE.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0) trigram 확장 (멱등) ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1) 전용 참조테이블 (DA §2 Option A, 컬럼 골격 §2) ──────────────
CREATE TABLE IF NOT EXISTS public.hira_drug_name_index (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_std_code   text        NOT NULL,                 -- 품목기준코드9 (HIRA 상품표준코드 namespace, 자연 unique 키)
  name_ko         text        NOT NULL,                 -- 공식 제품명(한글)
  name_normalized text        NOT NULL,                 -- 정규화명(매칭축) — canon: 공백 축약+소문자, ★용량표기 보존(자동연결 금지)
  ingredient_code text        NULL,                     -- 성분코드(선택, source enrich)
  ingredient_name text        NULL,                     -- 성분명(선택, source enrich)
  source_ref      text        NOT NULL,                 -- provenance(상류 소스 A 계보)
  loaded_at       timestamptz NOT NULL DEFAULT now(),   -- 적재 시각(상류 refresh 추적)
  CONSTRAINT hira_drug_name_index_item_std_code_key UNIQUE (item_std_code)
);

COMMENT ON TABLE  public.hira_drug_name_index IS
  'HIRA 공식 약 명칭 참조 인덱스(외부 참조 유니버스·read-only·비-PHI). drugVerification partial(명칭 대조) 코퍼스. T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 / DA-20260803. grain firewall: prescription_codes(카탈로그)와 별개 마스터.';
COMMENT ON COLUMN public.hira_drug_name_index.item_std_code   IS '품목기준코드9(HIRA 상품표준코드 namespace). prescription_codes.claim_code HIRA-{품목기준코드9} 접두 strip 값과 동일 코드축(VG-2). EDI 혼용 금지.';
COMMENT ON COLUMN public.hira_drug_name_index.name_normalized IS '정규화 제품명(매칭축). canon: trim+연속공백 1칸+소문자 fold. ★용량/함량 표기 보존(용량표기 자동연결 금지, drug_identity_rule 정합).';
COMMENT ON COLUMN public.hira_drug_name_index.source_ref      IS '상류 provenance. data.go.kr 15067462(source A) 계보. 초기 seed=prescription_codes HIRA-official(T-20260617 lineage).';

-- ── 2) 인덱스: 정규화명 위 GIN trigram (DA §2 매칭축) ──────────────
CREATE INDEX IF NOT EXISTS hira_drug_name_index_name_norm_trgm
  ON public.hira_drug_name_index USING gin (name_normalized gin_trgm_ops);

-- ── 3) RLS: authenticated SELECT-only (DA §5 · staff-facing lookup, anon 불요) ──
ALTER TABLE public.hira_drug_name_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hira_drug_name_index_approved_read ON public.hira_drug_name_index;  -- 멱등 재적용 가드
CREATE POLICY hira_drug_name_index_approved_read ON public.hira_drug_name_index
  FOR SELECT
  TO authenticated
  USING (is_approved_user());

COMMENT ON POLICY hira_drug_name_index_approved_read ON public.hira_drug_name_index IS
  'T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8: is_approved_user()(approved+active) 만 SELECT. anon 불요. WRITE 정책 무(코퍼스 적재=마이그/service_role 상류 refresh 전용). 형제 reference master(prescription_codes_approved_read) 표준 정렬.';

-- ── 4) 초기 코퍼스 seed (AC-8-1 단일 소스 · 멱등 · greenfield) ─────
--   소스 = prescription_codes HIRA-official (T-20260617/data.go.kr 15067462 lineage).
--   item_std_code = claim_code 의 'HIRA-' 접두 strip(품목기준코드9 namespace, VG-2).
--   name_normalized = trim + 연속공백 1칸 + 소문자 fold (용량표기 보존, AC-8-4 canon).
--   'HIRA-' 접두 official 만(bare EDI 급여코드 제외 = EDI 축 혼용 금지, VG-2).
INSERT INTO public.hira_drug_name_index (item_std_code, name_ko, name_normalized, source_ref)
SELECT DISTINCT ON (regexp_replace(pc.claim_code, '^HIRA-', ''))   -- 배치 내 동일 코드 중복 제거(멱등 안전)
  regexp_replace(pc.claim_code, '^HIRA-', '')                       AS item_std_code,
  pc.name_ko                                                        AS name_ko,
  lower(regexp_replace(btrim(pc.name_ko), '\s+', ' ', 'g'))         AS name_normalized,
  'prescription_codes:' || pc.id::text
    || ' | src=data.go.kr/15067462(A) | lineage=T-20260617-HIRA-MAP' AS source_ref
FROM public.prescription_codes pc
WHERE pc.claim_code LIKE 'HIRA-%'
  AND pc.code_source = 'official'
  AND pc.name_ko IS NOT NULL
  AND btrim(pc.name_ko) <> ''
ORDER BY regexp_replace(pc.claim_code, '^HIRA-', ''), pc.id  -- DISTINCT ON tie-break 결정적
ON CONFLICT (item_std_code) DO NOTHING;

-- ── 5) rows-affected assert + 완전성 로그 (AC-8-2 부분적재 abort) ──
DO $$
DECLARE
  v_eligible int;   -- seed 대상 소스행(중복 item_std_code 접합 후 distinct)
  v_loaded   int;   -- 적재된 인덱스행(해당 코드축)
BEGIN
  SELECT count(DISTINCT regexp_replace(pc.claim_code, '^HIRA-', ''))
    INTO v_eligible
  FROM public.prescription_codes pc
  WHERE pc.claim_code LIKE 'HIRA-%'
    AND pc.code_source = 'official'
    AND pc.name_ko IS NOT NULL
    AND btrim(pc.name_ko) <> '';

  SELECT count(*) INTO v_loaded FROM public.hira_drug_name_index;

  IF v_loaded < v_eligible THEN
    RAISE EXCEPTION 'HIRA-NAME-INDEX seed ABORT — 부분적재: eligible(distinct)=% > loaded=%', v_eligible, v_loaded;
  END IF;

  RAISE NOTICE 'HIRA-NAME-INDEX seed OK — eligible(distinct)=%, loaded=% (멱등 ON CONFLICT DO NOTHING).', v_eligible, v_loaded;
  RAISE NOTICE 'HIRA-NAME-INDEX 완전성 노트 — 초기 seed=병원 HIRA-official 서브셋(source A lineage). 더 넓은 15067462 CSV 코퍼스는 동일 멱등 loader 로 후속 추가적재(코드변경 아님).';
END $$;

-- ── 6) 구조 검증 (테이블·인덱스·RLS 실재) ─────────────────────────
DO $$
BEGIN
  IF to_regclass('public.hira_drug_name_index') IS NULL THEN
    RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED — 테이블 부재'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname='public' AND indexname='hira_drug_name_index_name_norm_trgm') THEN
    RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED — GIN trigram 인덱스 부재'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='hira_drug_name_index'
                   AND policyname='hira_drug_name_index_approved_read') THEN
    RAISE EXCEPTION 'HIRA-NAME-INDEX verify FAILED — RLS SELECT 정책 부재'; END IF;
  RAISE NOTICE 'HIRA-NAME-INDEX verify OK — 테이블 + GIN trgm 인덱스 + RLS SELECT 정책 실재.';
END $$;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT count(*) FROM public.hira_drug_name_index;
--   SELECT policyname, cmd, roles, qual FROM pg_policies
--     WHERE schemaname='public' AND tablename='hira_drug_name_index';
--   SELECT indexname, indexdef FROM pg_indexes
--     WHERE schemaname='public' AND tablename='hira_drug_name_index';
