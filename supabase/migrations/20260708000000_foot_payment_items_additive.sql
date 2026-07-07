-- ════════════════════════════════════════════════════════════════════════════
-- T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
-- 결제 항목별 명세(payment_items) 신규 테이블 — ADDITIVE
--
-- 근거: DA CONSULT-REPLY MSG-20260707-232108-u1zh (DA-20260707-foot-PAYMENT-ITEMS)
--   판정: GO + ADDITIVE 확정. payments 무변경(신규 테이블만) → autonomy §3.1 대표게이트 면제,
--         supervisor DDL-diff만. 계약 codify = cross_crm_data_contract.md payment_items canonical shape.
--
-- 스코프: (C) 풀 명세 — 항목명 + 수가코드 + 급여/비급여 + 금액 + 횟수 각 행 분리
--        (김주연 총괄 SCOPE-CONFIRMED ts=1783433265.563119, MSG-3wia)
--
-- 정련 3건(판정1) 반영:
--   ① 수가코드 = service_code text NULL 스냅샷 (hira_code 컬럼 신설 금지 — 급여 authority 오인 방지).
--      service_id 있으면 insert-time 복사, 없으면 수기입력. 표시/영수 스냅샷일 뿐 권위 아님.
--   ② service_id FK nullable ON DELETE SET NULL + service_name NOT NULL 스냅샷(마스터 rename/삭제 시 라인 보존).
--   ③ check_in_id FK nullable ON DELETE SET NULL (cascade 아님 — 돈 grain ⊥ is_deleted, 실수납 라인은
--      check_in 삭제와 무관 잔존: 현금대사 무결성, revenue_insurance_split §2-4). created_by audit actor(권고).
--
-- charge_class(판정2): 자유 text 금지 / enum type·system_codes row 신설 불요 → per-CRM CHECK 제약.
--   2값('급여','비급여') 고정 — 공단부담 등 확장 금지(3rd authority 방지). 보험축 display 라벨.
--   payments.tax_type(VAT축)과 직교 — 매핑/혼용 금지.
--
-- 급여 split SSOT 정합(판정3): charge_class = 분류 표시축만. 공단/본인부담 금액 authority =
--   service_charges(DA 소유 매출 split SSOT) 유지. payment_items는 split 금액 재선언 안 함(3중권위 방지).
--   payment_items ⊥ 매출집계/EDI/마감/인센티브 경로 (SUM 금지 — read/display 전용).
--   reconcile(Σ급여라인 ↔ service_charges.copayment) = advisory 모니터(CHECK/트리거 강제 금지).
--
-- RLS(§16-1 canonical join-via-parent): denorm clinic_id 컬럼 금지. clinic 격리는 부모 payments.clinic_id
--   조인으로. service_name=시술명 → PHI 인접 → canonical RLS 필수(daily_room·derm-TASKTAB 선례 동형).
--
-- 하위호환: payments 스키마 무변경. payment_items 0행 = 레거시 lump-sum → 결제상세/미수금/매출집계/EDI 등
--   payments.amount 만 보던 read 경로 전부 그대로 동작(회귀 0).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid        NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  check_in_id  uuid        REFERENCES public.check_ins(id) ON DELETE SET NULL,   -- 정련③: cascade 아님
  service_id   uuid        REFERENCES public.services(id) ON DELETE SET NULL,    -- 정련②
  service_name text        NOT NULL,                                             -- 정련②: 스냅샷(PHI 인접)
  service_code text,                                                             -- 정련①: 수가코드 스냅샷(권위 아님)
  quantity     integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),              -- 횟수
  unit_price   integer,                                                          -- 단가
  line_amount  integer     NOT NULL,                                             -- 라인 금액(qty×unit or 수기)
  charge_class text        CHECK (charge_class IN ('급여','비급여')),            -- 판정2: 보험축 2값 display 라벨
  created_by   uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,  -- 정련③: audit actor(권고)
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.payment_items IS
  '결제 항목별 명세(라인아이템). payments(수납) 하위 grain. 급여 split 금액 authority 아님(service_charges 유지). 매출집계/EDI/마감/인센티브 경로 SUM 금지 — display/read 전용. DA-20260707-foot-PAYMENT-ITEMS.';
COMMENT ON COLUMN public.payment_items.service_code IS
  '수가/서비스 코드 스냅샷(표시·영수 전용). 급여 수가 authority = service_charges/hira_score(재선언 아님).';
COMMENT ON COLUMN public.payment_items.charge_class IS
  '보험축 분류 표시 라벨(급여/비급여). 공단/본인부담 금액 authority 아님. tax_type(VAT축)과 직교 — 매핑 금지.';

CREATE INDEX IF NOT EXISTS idx_payment_items_payment_id  ON public.payment_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_check_in_id ON public.payment_items(check_in_id);

ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;

-- §16-1 canonical join-via-parent: clinic 격리 = 부모 payments.clinic_id 조인.
-- 술어 = is_approved_user() AND (부모 payment.clinic_id = current_user_clinic_id()).
-- payment_items = 결제 display 세부(돈 authority 아님) → read/write 동일 술어(FOR ALL).
DROP POLICY IF EXISTS payment_items_clinic_isolation ON public.payment_items;
CREATE POLICY payment_items_clinic_isolation ON public.payment_items
  FOR ALL TO authenticated
  USING (
    is_approved_user() AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.clinic_id = current_user_clinic_id()
    )
  )
  WITH CHECK (
    is_approved_user() AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.clinic_id = current_user_clinic_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_items TO authenticated;

COMMIT;
