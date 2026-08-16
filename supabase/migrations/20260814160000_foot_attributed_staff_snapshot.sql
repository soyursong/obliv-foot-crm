-- ════════════════════════════════════════════════════════════════════════════
-- T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE
-- 결제시점 담당 실장 스냅샷(attributed_staff_id) — payments + package_payments — ADDITIVE
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 왜 (Branch A · reporter 김주연 총괄 확정)
-- ─────────────────────────────────────────────────────────────────────────────
--   "A실장 기존 매출은 유지하고 변경된 B실장한테 이후부터 매출 귀속" (informed money-answer).
--   현행 매출→담당 귀속 = 조회시점 live-join(customers.assigned_staff_id 단일축, 결제행에 staff
--   스냅샷 부재) → 담당자 재배정 시 그 고객 과거 매출이 담당실장별 리포트에서 소급 재귀속(=돈 영향).
--   ⇒ DA Option A: 결제행에 결제시점 담당 스냅샷(attributed_staff_id)을 각인해 과거 귀속을 못박는다.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DA CONSULT②/③ 승인 (CONDITIONAL-GO)
--   · DA-20260814-foot-ASSIGN-UPSYNC-ATTRIBUTED-STAFF-ADDITIVE-DDL (kp7w/u76c)
--   · DA-20260814-foot-ATTRIBUTED-STAFF-DDL-TARGET-RECONCILE (zkwh/3mvv)
-- ─────────────────────────────────────────────────────────────────────────────
--   [table-set] {payments + package_payments} MANDATORY. dev-foot firsthand census(grain 완전성)가
--     DA named 예시(payments+service_charges)를 override — GOVERNING rule=grain 완전성(census-gated·
--     dispositive). service_charges = staff roll-up 0건(staffRevenue/mtmSales/stats/SalesDoctorTab
--     전부 grep 0) = dead column → DROP. package_payments(선수금·1급) = SSOT fetchAttributedPayments
--     가 net roll-up → 누락 시 SalesDoctorTab 패키지매출 partial-attribution leak → MANDATORY.
--     closing_manual_payments = clinic-level(assigned_staff 조인 없음) → EXCLUDED.
--   [write-path stamp 기제] BEFORE INSERT 트리거 chokepoint(dev 권고·DA bless Option A "INSERT 시
--     then-current assigned_staff_id stamp"의 물리 실현). 24 call-site(payments 17 + package 7) FE
--     개별 stamp 대신 트리거 1점 = money-adjacent silent-NULL 방어 + read SSOT(fetchAttributedPayments)
--     COALESCE belt 미러. 선례 = trg_*_sim_stamp_insert(stamp_is_simulation_from_customer, 동형).
--   [FK durability] on-delete SET NULL 금지(DA H·planner). SET NULL 은 read-side NULL-fallback belt 와
--     상호작용해 소급재귀속 재유입 → NO ACTION(staff soft-delete only 확증, hard-delete lifecycle 부재).
--     source customers.assigned_staff_id 는 SET NULL 이나, attributed_staff_id 는 의도적으로 NO ACTION.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- change_class = ADDITIVE (신규 nullable 컬럼×2 + FK + partial index×2 + fn + 트리거×2 ·
--   기존행 무변경 · DROP 0 · 금액/split 컬럼 무접점 · txn-control(BEGIN/COMMIT) 없음).
--   §3.1 CEO 파괴게이트 N/A(exposure-neutral) — BUT 'ADDITIVE/nullable ≠ GO-token/MIG-GATE 면제'(AC-1):
--   DDL 실재 + attributed_staff_id=담당별 매출 staff-split 축(인센티브 분모 인접·money-reporting-adjacent)
--   → supervisor DDL-diff + MIG-GATE + code-gate + 물리 DB-GATE GO-token 선행 REQUIRED.
--
-- ⚠️ 본 파일은 PROD 미적용으로 스테이징된다. supervisor 물리 GO-token 발행 前 prod DDL apply 금지
--    (apply_before_go 클래스 · DA H6). baseline-freeze 백필 = 별 파일(20260814160100 ...baseline_freeze).
--
-- ⚠️ 원장 무접점(DA 판정③ REAFFIRM): amount·insurance_covered_amount·tax_type·payment_type·매출총합·
--    AC-3 split 절대 byte-불변. attributed_staff_id(WHO 축) 만 write — WHAT split 축과 직교.
--
-- dry-run  : 20260814160000_foot_attributed_staff_snapshot.dryrun.mjs (No-Persistence Protocol)
-- rollback : 20260814160000_foot_attributed_staff_snapshot.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────
-- 1) DDL — attributed_staff_id 컬럼 (ADDITIVE · nullable · FK NO ACTION · 멱등)
--    source shape 미러: customers.assigned_staff_id UUID REFERENCES staff(id)
--    ★차이 = on-delete: source=SET NULL / 여기=NO ACTION(명시 절 없음=NO ACTION, 소급재귀속 재유입 방지).
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS attributed_staff_id UUID REFERENCES public.staff(id);
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS attributed_staff_id UUID REFERENCES public.staff(id);

COMMENT ON COLUMN public.payments.attributed_staff_id IS
  'T-ASSIGN-UPSYNC-REVENUE-REATTRIB(Branch A·Option A): 결제시점 담당 실장 스냅샷(staff.id). '
  'BEFORE INSERT trg_payments_attributed_staff_stamp 가 각인(then-current customers.assigned_staff_id). '
  '매출→담당 귀속 = 이 컬럼 우선(재배정 소급이동 방지), NULL=레거시/워크인/미배정→read COALESCE live-join belt. '
  'FK on-delete=NO ACTION(SET NULL 금지). 금액/split 무접점(WHO 축 ⊥ WHAT split 축).';
COMMENT ON COLUMN public.package_payments.attributed_staff_id IS
  'T-ASSIGN-UPSYNC-REVENUE-REATTRIB(Branch A·Option A): 패키지결제(선수금) 결제시점 담당 스냅샷(staff.id). '
  'grain 완전성 MANDATORY — 누락 시 SalesDoctorTab 패키지매출 partial-attribution leak. payments 와 동형.';

-- 담당별 매출 그룹핑/조인 최적화용 부분 인덱스(created_by 선례 준용, NULL 소량 제외).
CREATE INDEX IF NOT EXISTS idx_payments_attributed_staff
  ON public.payments(attributed_staff_id) WHERE attributed_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_package_payments_attributed_staff
  ON public.package_payments(attributed_staff_id) WHERE attributed_staff_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2) write-path stamp — 결제/패키지결제 INSERT 시 then-current 담당 각인
--    driver = customers.assigned_staff_id(2번차트 담당 실장·live 포인터).
--    coalesce 각인: 이미 명시값이 들어온 경우 보존(멱등·미래 명시귀속 여지), 그 외 customer 현재 담당 각인.
--    워크인(customer_id NULL) → 조회 생략 → NULL 유지 → read 에서 STAFF_UNASSIGNED 버킷(정합).
--    SECURITY DEFINER: 호출자 RLS 무관 customers 조회. search_path 고정. 선례=stamp_is_simulation_from_customer.
--    ★then-current stamp = DA-bless Option A 물리 실현. 환불행도 동일(그 시점 담당)로 각인 — refund→원귀속
--     승계(linked_payment_id 상속)는 blessed 범위 밖 refinement → 별 티켓(재-adjudication 금지·H7).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_attributed_staff_from_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 이미 명시 각인됐거나 워크인(customer_id NULL)이면 조회 생략 → 명시값/NULL 보존.
  IF NEW.attributed_staff_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT c.assigned_staff_id INTO NEW.attributed_staff_id
    FROM public.customers c
    WHERE c.id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_attributed_staff_from_customer() IS
  'T-ASSIGN-UPSYNC-REVENUE-REATTRIB: BEFORE INSERT — 연결 고객의 then-current customers.assigned_staff_id 를 '
  'attributed_staff_id 로 각인(결제시점 담당 스냅샷). 명시값/워크인 보존(fail-safe). payments/package_payments 공용.';

-- 기존 BEFORE INSERT 트리거(accounting_date·sim_stamp 계열)와 독립 — attributed_staff_id 는 그들과 무관, 순서 무영향.
DROP TRIGGER IF EXISTS trg_payments_attributed_staff_stamp ON public.payments;
CREATE TRIGGER trg_payments_attributed_staff_stamp
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_attributed_staff_from_customer();

DROP TRIGGER IF EXISTS trg_package_payments_attributed_staff_stamp ON public.package_payments;
CREATE TRIGGER trg_package_payments_attributed_staff_stamp
  BEFORE INSERT ON public.package_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_attributed_staff_from_customer();
