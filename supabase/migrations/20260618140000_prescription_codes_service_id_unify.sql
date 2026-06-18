-- T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — 처방세트(prescription_codes) ↔ 서비스관리(services) 단일 DB 통합
-- reporter: 문지은 대표원장 (C0ATE5P6JTH) — "처방세트 약 ↔ 서비스관리 약, 같은 DB에서 관리"
-- DA CONSULT-REPLY MSG-20260618-125321-41fb = ADDITIVE GO (extension-table 패턴). 물리병합 배제.
-- rollback: 20260618140000_prescription_codes_service_id_unify.rollback.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ADDITIVE ONLY — DROP·재배치·데이터유실 0. 순수 추가.
--   · ADD COLUMN prescription_codes.service_id (NULL 허용, FK→services ON DELETE SET NULL)
--   · CREATE INDEX (service_id 조회)
--   · CREATE VIEW v_foot_drug_master (통합 read 뷰 — 약 1건 + 급여/HIRA 메타 한 화면)
--   기존 컬럼/제약/검색쿼리/스냅샷/약품폴더(prescription_code_folders.prescription_code_id) 전부 무변경.
--   차트 medical_charts.diagnosis / prescription_items JSONB(schema-on-read) 무접촉(FK 손실 0).
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── 데이터 현실 (정찰 inspect 결과, 본 마이그 설계 근거) ──────────────────────────
--   prescription_codes = 518건 (HIRA 전국 약가 마스터 — 풋과 무관한 코드 다수 포함).
--   services WHERE category_label='처방약' = 21건 (풋센터 큐레이션 처방약 = reporter가 보는 '처방세트 약').
--   → FK 방향: prescription_codes.service_id → services(id). 21건 services 처방약 각각에 대응하는
--     HIRA 마스터 행(prescription_codes)에 service_id 를 set 하여 '같은 약'을 한 화면으로 연결.
--   ⚠ 백필(service_id 데이터 채움)은 본 마이그에 포함하지 않음 — name 포맷차(밀리그람↔mg 등)로
--     모호건 발생 → dry-run 매핑리스트(_backfill_dryrun.mjs) 산출 후 사람확인(planner/supervisor)
--     게이트 통과한 뒤 별도 _backfill_apply 스크립트로 적용. (티켓 AC-1 모호건 사람확인 원칙)
--   ⚠ services 미존재 HIRA 잡코드(517건)를 services 로 신설하지 않음 — 풋 카탈로그 오염 방지.
--     services 단독약(HIRA 마스터에 없는 약)도 prescription_codes 신설 안 함 → 통합뷰에서 단독행으로 표시.
--
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE VIEW.
-- 클러스터 직렬화: prescription_codes 동일 테이블 RXCODES-WRITE-RLS-CANONICAL(f22d8b1b, admin_all 정착확인 完)
--   이후 적용 — 동시 DDL 충돌 회피.
-- 적용: dev-foot 직접 pg 적용 + supervisor DDL-diff 게이트(deploy-ready 시 필수). 단일 테이블, blanket ALTER 금지.

BEGIN;

-- ── 1. ADD COLUMN: prescription_codes.service_id (extension-table 브릿지) ─────────────
--  NULL 허용 = 모든 기존 행 무영향(백필 전 전부 NULL). FK→services ON DELETE SET NULL
--  = services 약 삭제 시 link 만 끊기고 prescription_codes 행(HIRA 메타)은 보존(무손실).
ALTER TABLE prescription_codes
  ADD COLUMN IF NOT EXISTS service_id uuid NULL
  REFERENCES services(id) ON DELETE SET NULL;

COMMENT ON COLUMN prescription_codes.service_id IS
  'T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY: 서비스관리 처방약(services.id, category_label=''처방약'')과의 단일 DB 브릿지. NULL=미연결. 백필은 name 정규화 매칭+사람확인 후 _backfill_apply 로 채움. ON DELETE SET NULL(service 삭제 시 HIRA 메타 보존).';

-- ── 2. INDEX: service_id 역참조 조회(통합뷰 JOIN) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prescription_codes_service_id
  ON prescription_codes(service_id)
  WHERE service_id IS NOT NULL;

-- ── 3. 통합 read 뷰: v_foot_drug_master ──────────────────────────────────────────────
--  services 처방약(정본 카탈로그) LEFT JOIN prescription_codes ON service_id
--  → 약 1건 = services 기준 1행 + 연결된 HIRA/급여 메타(없으면 NULL). 현장 '같은 DB' 체감.
--  security_invoker=on: 뷰가 호출자 권한으로 base 테이블 RLS 적용(services·prescription_codes
--    둘 다 read_all/approved_read 공개 — 회귀 0). 무손실 read-only.
DROP VIEW IF EXISTS v_foot_drug_master;
CREATE VIEW v_foot_drug_master
  WITH (security_invoker = on) AS
SELECT
  s.id                            AS service_id,
  s.name                          AS service_name,
  s.category_label                AS service_category_label,
  s.price                         AS service_price,
  s.is_insurance_covered          AS service_is_insurance_covered,
  s.hira_code                     AS service_hira_code,
  s.hira_score                    AS service_hira_score,
  s.active                        AS service_active,
  -- 연결된 prescription_codes(HIRA 마스터 + 처방 메타). 미연결 시 전부 NULL.
  pc.id                           AS prescription_code_id,
  pc.claim_code                   AS pc_claim_code,
  pc.name_ko                      AS pc_name_ko,
  pc.code_type                    AS pc_code_type,
  pc.classification               AS pc_classification,
  pc.manufacturer                 AS pc_manufacturer,
  pc.ingredient_code              AS pc_ingredient_code,
  pc.anti_dropout                 AS pc_anti_dropout,
  pc.low_dose                     AS pc_low_dose,
  pc.relative_value               AS pc_relative_value,
  pc.price_krw                    AS pc_price_krw,
  pc.insurance_status             AS pc_insurance_status,
  pc.insurance_status_updated_at  AS pc_insurance_status_updated_at,
  pc.description                  AS pc_description,
  (pc.id IS NOT NULL)             AS has_hira_link
FROM services s
LEFT JOIN prescription_codes pc ON pc.service_id = s.id
WHERE s.category_label = '처방약';

COMMENT ON VIEW v_foot_drug_master IS
  'T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY: 처방세트 약 ↔ 서비스관리 처방약 통합 read 뷰. services 처방약(정본) LEFT JOIN prescription_codes ON service_id. 약 1건 + 급여/HIRA 메타 한 화면(현장 ''같은 DB'' 체감). has_hira_link=false=아직 미연결(백필 대상). security_invoker=on.';

GRANT SELECT ON v_foot_drug_master TO authenticated, anon;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='prescription_codes' AND column_name='service_id';   -- 1행
--   SELECT count(*) FROM v_foot_drug_master;                                -- 21 (services 처방약)
--   SELECT count(*) FROM v_foot_drug_master WHERE has_hira_link;            -- 백필 전 0, 후 ~5+
