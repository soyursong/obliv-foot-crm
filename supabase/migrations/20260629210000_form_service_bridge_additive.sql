-- T-20260617-foot-DOCFORM-POPUP-OVERHAUL — 서류 가격 SSOT 스키마 슬라이스 (Phase 2, 구조 DDL 절반)
-- DA CONSULT-REPLY MSG-20260629-231513-1uwa (DA-20260629-foot-DOCFORM-PRICE-SSOT.md) = GO / ADDITIVE 전부.
--   가격 SSOT = services 마스터(category_label='제증명'). form_templates.service_id FK 브리지로 양식↔SKU 연결.
--   진료기록사본 계단단가 = services.pricing_tiers JSONB(별도 tier 테이블 신설 금지 — 1종뿐, 과설계).
-- 게이트: autonomy §3.1 ADDITIVE + DA GO = 대표 게이트 면제, supervisor DDL-diff 게이트만.
-- 선례 동형: T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY (prescription_codes.service_id + v_foot_drug_master, rev12).
-- rollback: 20260629210000_form_service_bridge_additive.rollback.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ 본 마이그 = "구조 DDL 절반"만 (라이브 행 0 변경 / 순수 additive / 결정 무관).
--   ① ADD COLUMN form_templates.service_id (NULL, FK→services ON DELETE SET NULL)
--   ② CREATE INDEX (service_id 역참조 조회)
--   ③ ADD COLUMN services.pricing_tiers jsonb (NULL — 계단단가 전용, flat 가격 9종=NULL)
--   ④ CREATE VIEW v_foot_form_master (form_templates LEFT JOIN services — 양식+가격 한 화면)
--   기존 컬럼/제약/RLS/검색쿼리/published 트리거/L-006 bindHtmlTemplate 4경로 전부 무접촉.
--
-- ⛔ 본 마이그에 포함 안 함 (별도 Migration B, planner 결정 게이트 대기 — FOLLOWUP 발행함):
--   · services 서류 SKU 행 등재(INSERT/relabel) + service_id 백필 + pricing_tiers 값 set.
--   사유: catalog_reset 시드(2026-05-11)에 서류 SKU 행들이 이미 category_label='기본'으로 존재하고
--     (진단서·진료소견서·진료의뢰서·진료확인서1/2·통원확인서·진단서(영문)·소견서(영문)·진료기록사본1/2),
--     그 가격이 §6 reporter 확정 스펙과 불일치(진단서 10000→2만 / 소견서영문 30000→2만 / 진료의뢰서 0→3000 등)
--     + UNIQUE(clinic_id,name) 제약 → DA의 greenfield INSERT 전제와 데이터 현실이 어긋남.
--     "기존 행 relabel(라이브 가격 mutate)" vs "신규 제증명 행 병행(카탈로그 중복표시)" = reporter 결정 필요.
--     라이브 가격 데이터를 추정으로 변경하지 않는다(§S2.4) → 구조 DDL만 선행 적용.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE VIEW.
-- 적용: dev-foot 직접 pg 적용 + supervisor DDL-diff 게이트. 단일 컬럼 ADD, blanket ALTER 금지.

BEGIN;

-- ── 1. ADD COLUMN: form_templates.service_id (양식↔SKU 브리지) ─────────────────────────
--  NULL 허용 = 기존 모든 양식 행 무영향(백필 전 전부 NULL). FK→services ON DELETE SET NULL
--  = services 서류 SKU 삭제 시 link 만 끊기고 form_templates 행(양식 정체성)은 보존(무손실).
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS service_id uuid NULL
  REFERENCES services(id) ON DELETE SET NULL;

COMMENT ON COLUMN form_templates.service_id IS
  'T-20260617-foot-DOCFORM-POPUP-OVERHAUL: 서류 양식 ↔ 서비스관리 SKU(services.id, category_label=''제증명'') 가격 브리지. NULL=미연결. 가격 SSOT=services(DA MSG-20260629-231513-1uwa). 국/영 별도 service_code → 언어별 양식/필드가 매칭 SKU 지정. ON DELETE SET NULL(SKU 삭제 시 양식 보존). 백필은 Migration B(planner 결정 후).';

-- ── 2. INDEX: service_id 역참조 조회(통합뷰 JOIN) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_form_templates_service_id
  ON form_templates(service_id)
  WHERE service_id IS NOT NULL;

-- ── 3. ADD COLUMN: services.pricing_tiers (계단단가 — 진료기록사본 전용) ─────────────────
--  nullable. flat 가격 서류 9종 = NULL(기존 price 필드 사용). 계단단가 1종(진료기록사본)만 채움.
--  형태 예: [{"min":1,"max":5,"unit":1000},{"min":6,"max":null,"unit":100}]
--  산식(unit×구간 합산)은 app/Silver 강제 — DB CHECK 아님(DA §Q2 계약 명문, 유한·종속 구조체=JSONB).
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS pricing_tiers jsonb NULL;

COMMENT ON COLUMN services.pricing_tiers IS
  'T-20260617-foot-DOCFORM-POPUP-OVERHAUL: 수량 계단단가(진료기록사본 1~5매 1,000원/매·6매~ 100원/매 등). nullable=flat 가격(price 필드) 사용. 형태 [{min,max,unit}] (max=null=무제한). 산식=app/Silver 강제(DB CHECK 아님). 별도 tier 테이블 미신설(DA §Q2: 1종뿐, 과설계 회피).';

-- ── 4. 통합 read 뷰: v_foot_form_master ──────────────────────────────────────────────
--  form_templates(양식 정본) LEFT JOIN services ON service_id
--  → 양식 1건 = form_templates 기준 1행 + 연결된 가격 SKU 메타(없으면 NULL). 현장 '같은 DB' 체감.
--  security_invoker=on: 뷰가 호출자 권한으로 base 테이블 RLS 적용. 무손실 read-only.
DROP VIEW IF EXISTS v_foot_form_master;
CREATE VIEW v_foot_form_master
  WITH (security_invoker = on) AS
SELECT
  ft.id                  AS form_template_id,
  ft.clinic_id           AS clinic_id,
  ft.form_key            AS form_key,
  ft.name_ko             AS form_name_ko,
  ft.category            AS form_category,
  ft.required_role       AS form_required_role,
  ft.active              AS form_active,
  ft.sort_order          AS form_sort_order,
  ft.service_id          AS service_id,
  -- 연결된 services 서류 SKU(가격 SSOT). 미연결 시 전부 NULL.
  s.service_code         AS service_code,
  s.name                 AS service_name,
  s.category_label       AS service_category_label,
  s.price                AS service_price,
  s.discount_price       AS service_discount_price,
  s.pricing_tiers        AS service_pricing_tiers,
  s.is_insurance_covered AS service_is_insurance_covered,
  s.vat_type             AS service_vat_type,
  s.active               AS service_active,
  (s.id IS NOT NULL)     AS has_price_link
FROM form_templates ft
LEFT JOIN services s ON s.id = ft.service_id;

COMMENT ON VIEW v_foot_form_master IS
  'T-20260617-foot-DOCFORM-POPUP-OVERHAUL: 서류 양식 ↔ 가격 SKU 통합 read 뷰. form_templates(양식 정본) LEFT JOIN services ON service_id. 양식 1건 + 가격/SKU 메타 한 화면. has_price_link=false=아직 미연결(Migration B 백필 대상). security_invoker=on. 선례 v_foot_drug_master 동형.';

GRANT SELECT ON v_foot_form_master TO authenticated, anon;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='form_templates' AND column_name='service_id';        -- 1행
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='services' AND column_name='pricing_tiers';           -- 1행
--   SELECT count(*) FROM v_foot_form_master;                                 -- = form_templates 행수
--   SELECT count(*) FROM v_foot_form_master WHERE has_price_link;            -- 백필(Migration B) 전 0
