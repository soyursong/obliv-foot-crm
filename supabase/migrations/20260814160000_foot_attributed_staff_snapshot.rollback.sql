-- T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE — rollback (attributed_staff_id 스냅샷)
--
-- ADDITIVE 되돌림: 트리거×2 → 함수 → 인덱스×2 → 컬럼×2 (의존 역순).
-- ⚠️ 데이터 손실 주의 — 컬럼 DROP 시 baseline-freeze/각인된 결제시점 담당 스냅샷 값이 소실된다.
--    read 는 COALESCE live-join belt 로 자동 폴백하므로 리포트 숫자는 즉시 복구되나(report-neutral),
--    미래 재배정에 대한 "과거 귀속 못박음"은 함께 소실된다. prod 값 존재 후 되돌림 = archive-first 권고.
--    (신규 배포 직후 값 0 상태에서의 abort-rollback = 무손실.)

DROP TRIGGER IF EXISTS trg_payments_attributed_staff_stamp ON public.payments;
DROP TRIGGER IF EXISTS trg_package_payments_attributed_staff_stamp ON public.package_payments;

DROP FUNCTION IF EXISTS public.stamp_attributed_staff_from_customer();

DROP INDEX IF EXISTS public.idx_payments_attributed_staff;
DROP INDEX IF EXISTS public.idx_package_payments_attributed_staff;

ALTER TABLE public.payments          DROP COLUMN IF EXISTS attributed_staff_id;
ALTER TABLE public.package_payments  DROP COLUMN IF EXISTS attributed_staff_id;
