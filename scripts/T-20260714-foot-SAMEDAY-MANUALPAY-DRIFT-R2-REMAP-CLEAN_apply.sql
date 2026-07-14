-- T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — Phase 3 APPLY (opt-A canonicalize)
-- ⚠⚠ DRAFT — 아직 실행 금지. 현장(김주연 총괄) confirm 수신 후에만 실행. (thread 1784012237.932789)
-- 대상셋 = 당일 전체 수기수납 − R1 canonical 12행 = 잔여 8건(frozen, 일마감 종료).
-- 로직 = R1(SAMEDAY-REMAP) 재사용. 마커 = T-20260714-DRIFT-R2 (R1 SAMEDAY-REMAP 마커와 구분).
-- net-zero: canonical(417,800) == 삭제 closing_manual_payments 8건 SUM(417,800). 이중계상 0.
-- 멱등 가드: 동일 memo 마커 기존행 있으면 재INSERT 안 함(WHERE NOT EXISTS). R2 마커 사전존재 0건 확인.
BEGIN;

-- ── Group A/B: package 잔금 정본화 → package_payments (A 5건@10,000 + B 이재성 350,000) ──
INSERT INTO package_payments
  (clinic_id, package_id, customer_id, amount, method, installment, payment_type, fee_kind, memo, created_at)
SELECT v.clinic_id, v.package_id, v.customer_id, v.amount, v.method, 0, 'payment', 'package', v.memo, v.created_at
FROM (VALUES
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'2b8a0c23-9fb0-46c0-ba05-707ac8ae84cf'::uuid,'ed91fabd-490d-49af-9fc4-94a3a218418b'::uuid,10000,'card','일마감 수기결제 정본화(F-4564 허유진 무좀체험권, opt-A/pkg) T-20260714-DRIFT-R2','2026-07-14T17:51:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'a2869398-631a-4dd3-84a2-1dc43ffb082c'::uuid,'c68b7056-3c1c-4476-a21a-9b5f6e1f9f56'::uuid,10000,'card','일마감 수기결제 정본화(F-4589 김성애 체험, opt-A/pkg; 원 수기행 chart_no 미기재→F-4589 특정) T-20260714-DRIFT-R2','2026-07-14T18:50:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'f7f02420-966b-4ace-b076-c7c2aa80d01c'::uuid,'d7814e4b-588e-4197-8d55-7a7930a379c1'::uuid,10000,'card','일마감 수기결제 정본화(F-4645 노수옥 체험, opt-A/pkg) T-20260714-DRIFT-R2','2026-07-14T19:01:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'730a1e69-d5dd-420e-b4ba-e4f26e52b61a'::uuid,'8c525a72-0254-4d43-bb8d-d4d7388f3e3a'::uuid,10000,'card','일마감 수기결제 정본화(F-4642 이멋진 무좀체험권, opt-A/pkg) T-20260714-DRIFT-R2','2026-07-14T19:03:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'db0a17a6-7f41-48e6-b076-96b74d6e7197'::uuid,'db243c4d-86d8-4d9d-abe9-048d83c34b18'::uuid,10000,'card','일마감 수기결제 정본화(F-4643 황찬식 무좀체험권, opt-A/pkg) T-20260714-DRIFT-R2','2026-07-14T19:12:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'8d42dbcb-a2f3-47c0-8819-a914544ac578'::uuid,'cbd71b52-6be8-432b-984e-1ee7599a4b0f'::uuid,350000,'card','일마감 수기결제 정본화(F-4702 이재성 가열 잔금, opt-A/pkg; balance 350,000 정확일치) T-20260714-DRIFT-R2','2026-07-14T19:05:00+09:00'::timestamptz)
) AS v(clinic_id, package_id, customer_id, amount, method, memo, created_at)
WHERE NOT EXISTS (SELECT 1 FROM package_payments pp WHERE pp.memo = v.memo);

-- 패키지 paid_amount 재집계 (영향 6개 패키지) — 미수 파생값 정합
UPDATE packages p SET paid_amount = COALESCE((
  SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
  FROM package_payments pp WHERE pp.package_id = p.id), 0)
WHERE p.id IN (
  '2b8a0c23-9fb0-46c0-ba05-707ac8ae84cf','a2869398-631a-4dd3-84a2-1dc43ffb082c',
  'f7f02420-966b-4ace-b076-c7c2aa80d01c','730a1e69-d5dd-420e-b4ba-e4f26e52b61a',
  'db0a17a6-7f41-48e6-b076-96b74d6e7197','8d42dbcb-a2f3-47c0-8819-a914544ac578');

-- ── Group C: 진찰료 8,900 → single (payments, check_in_id NULL) — 허유희 / 이재성 ──
-- ★ 데스크 진찰료 = 패키지 무관 별개 청구. 패키지에 붙이면 이중계상 → single로 계상해 이중계상 0.
INSERT INTO payments
  (clinic_id, check_in_id, customer_id, amount, method, installment, payment_type, memo, created_at)
SELECT '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid, NULL, '4e051559-a7bf-4eee-9819-d626a26b6220'::uuid,
       8900, 'card', 0, 'payment', '일마감 수기결제 정본화(F-4696 허유희 진찰료, opt-A/single; 24회권과 무관 별개청구·패키지 balance0 무접촉) T-20260714-DRIFT-R2', '2026-07-14T19:21:00+09:00'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.memo LIKE '일마감 수기결제 정본화(F-4696 허유희 진찰료, opt-A/single%');

INSERT INTO payments
  (clinic_id, check_in_id, customer_id, amount, method, installment, payment_type, memo, created_at)
SELECT '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid, NULL, 'cbd71b52-6be8-432b-984e-1ee7599a4b0f'::uuid,
       8900, 'card', 0, 'payment', '일마감 수기결제 정본화(F-4702 이재성 진찰료, opt-A/single; 가열 350k와 별개청구) T-20260714-DRIFT-R2', '2026-07-14T19:22:00+09:00'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.memo LIKE '일마감 수기결제 정본화(F-4702 이재성 진찰료, opt-A/single%');

-- ── 원 closing_manual_payments 8건 DELETE (canonical로 대체, net-zero rollup) ──
DELETE FROM closing_manual_payments WHERE id IN (
  '54f54cc3-cc54-4c66-bbb9-e4132bc5de7f','580bda4d-d408-4090-b9a5-763de19e5a6b',
  '7021a5ca-ecc7-451b-93ed-eb784e5dc701','bb0bd71c-8e03-4e4f-bc2f-c9075bef58b4',
  '3a713bd7-a151-40ff-a743-f31fe5af1cfe','e0280dbb-02b4-43d4-bf31-5d0dd0284ea8',
  '78c19a4f-ec9e-4d0e-b1e8-a7a45116ebbd','4ff33dc0-36da-40c4-8181-e87f0bc6ecf8');

COMMIT;
