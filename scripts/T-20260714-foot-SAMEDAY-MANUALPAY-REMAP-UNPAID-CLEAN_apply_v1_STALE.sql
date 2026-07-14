-- T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 3 APPLY (opt-A canonicalize)
-- ⚠ 현장(김주연 총괄) confirm 후에만 실행. freeze set = snapshot §4 (13건).
-- 로직 = manualPaymentWritePath.recordManualPayment 재현(package: package_payments INSERT + paid_amount 재집계 / single: payments INSERT).
-- net-zero: canonical 생성 후 원 closing_manual_payments 행 DELETE(Part1 opt-A와 동일). 매출 이중계상 없음.
-- 멱등 가드: 동일 memo 마커 기존행 있으면 재INSERT 안 함(WHERE NOT EXISTS).
BEGIN;

-- ── Group A + B: 패키지 잔금 결제 → package_payments (12건) ──────────────────
INSERT INTO package_payments
  (clinic_id, package_id, customer_id, amount, method, installment, payment_type, fee_kind, memo, created_at)
SELECT v.clinic_id, v.package_id, v.customer_id, v.amount, v.method, 0, 'payment', 'package', v.memo, v.created_at
FROM (VALUES
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'f84a95cd-ab07-4f83-8760-d941c46ed079'::uuid,'5bd0e924-c701-4b16-8865-a03c5a6edae1'::uuid,10000,'card','일마감 수기결제 정본화(F-4590 전인호, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T11:25:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'04feb879-afbf-4158-ba29-3dfaa39c0c3c'::uuid,'d2c91749-c6c3-498b-a3d4-12d5d26a67e8'::uuid,10000,'cash','일마감 수기결제 정본화(F-4644 최고, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T12:16:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'3ba632cd-82ec-4abc-89ca-7ac2ca710286'::uuid,'4c7fcad8-115d-4e80-a88d-65e2e24e81d4'::uuid,10000,'card','일마감 수기결제 정본화(F-4646 박형규, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T13:02:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'1f7a61f1-f7d0-438b-adb6-620d203969db'::uuid,'3210644b-04a5-4f24-b425-c3d10ae87dc9'::uuid,10000,'card','일마감 수기결제 정본화(F-4652 진태주, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:15:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'84808f19-c6c4-45d6-bf85-8e242b01bee4'::uuid,'23d923ed-7cd9-4cbb-a169-bb64450ec3f2'::uuid,10000,'card','일마감 수기결제 정본화(F-4655 마서현, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:16:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'a8d402ba-7763-4dd8-8f63-5fca23dc484c'::uuid,'14889376-6f68-4222-8b76-14a22b16dd1d'::uuid,10000,'card','일마감 수기결제 정본화(F-4600 최창수, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:21:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'387c8f6a-f151-426d-ac56-96366188a2f4'::uuid,'7d177461-cd0c-478b-b322-7c8498798ef5'::uuid,10000,'card','일마감 수기결제 정본화(F-4601 정종석, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:45:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'24e02b64-84b0-4e44-82cd-670768340927'::uuid,'d0a9a495-e068-4dba-a96e-b0366ab6c596'::uuid,10000,'card','일마감 수기결제 정본화(F-4546 김종형, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:50:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'692fb8d5-ce16-48c0-a25b-19c885757483'::uuid,'476038ed-5ed1-44c0-8a2b-2cfb2d7011b9'::uuid,10000,'card','일마감 수기결제 정본화(F-4597 윤철희, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T16:32:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'1637a08f-5d5a-4eab-bcb8-aea9b84253e1'::uuid,'6b3f8373-3841-49af-b308-1f128d4b00cc'::uuid,10000,'card','일마감 수기결제 정본화(F-4687 신용섭, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T16:34:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'876e1a55-0545-4c5f-8591-75609be0bd06'::uuid,'4e051559-a7bf-4eee-9819-d626a26b6220'::uuid,3880000,'card','일마감 수기결제 정본화(F-4696 허유희, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:51:00+09:00'::timestamptz),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,'876e1a55-0545-4c5f-8591-75609be0bd06'::uuid,'4e051559-a7bf-4eee-9819-d626a26b6220'::uuid,1000000,'transfer','일마감 수기결제 정본화(F-4696 허유희, opt-A/pkg) T-20260714-SAMEDAY-REMAP','2026-07-14T15:52:00+09:00'::timestamptz)
) AS v(clinic_id, package_id, customer_id, amount, method, memo, created_at)
WHERE NOT EXISTS (SELECT 1 FROM package_payments pp WHERE pp.memo = v.memo);

-- 패키지 paid_amount 재집계(미수 파생값 정합) — 영향 11개 패키지
UPDATE packages p SET paid_amount = COALESCE((
  SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
  FROM package_payments pp WHERE pp.package_id = p.id), 0)
WHERE p.id IN (
  'f84a95cd-ab07-4f83-8760-d941c46ed079','04feb879-afbf-4158-ba29-3dfaa39c0c3c',
  '3ba632cd-82ec-4abc-89ca-7ac2ca710286','1f7a61f1-f7d0-438b-adb6-620d203969db',
  '84808f19-c6c4-45d6-bf85-8e242b01bee4','a8d402ba-7763-4dd8-8f63-5fca23dc484c',
  '387c8f6a-f151-426d-ac56-96366188a2f4','24e02b64-84b0-4e44-82cd-670768340927',
  '692fb8d5-ce16-48c0-a25b-19c885757483','1637a08f-5d5a-4eab-bcb8-aea9b84253e1',
  '876e1a55-0545-4c5f-8591-75609be0bd06');

-- ── Group C: 이미현 F-4695 진찰료 8,900 → single (payments, check_in_id NULL) ──
-- ⚠ 현장 confirm 'single' 시에만. 'checkin'(12211472 귀속+칸반해소) 택 시 이 블록 대체.
INSERT INTO payments
  (clinic_id, check_in_id, customer_id, amount, method, installment, payment_type, memo, created_at)
SELECT '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid, NULL, 'a07a3079-69ba-415a-a0f8-61e8d0921168'::uuid,
       8900, 'card', 0, 'payment', '일마감 수기결제 정본화(F-4695 이미현 진찰료, opt-A/single) T-20260714-SAMEDAY-REMAP', '2026-07-14T12:06:00+09:00'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.memo = '일마감 수기결제 정본화(F-4695 이미현 진찰료, opt-A/single) T-20260714-SAMEDAY-REMAP');

-- ── 원 closing_manual_payments 13건 DELETE (canonical로 대체, net-zero) ──────
DELETE FROM closing_manual_payments WHERE id IN (
  '804b6d72-cf9f-4827-9545-1aa126f59573','b674132c-b68f-4920-9b25-977527e39eb9',
  'a503218f-0d0a-4393-a771-a6ddf8a02173','dfd30a1a-1b6c-463d-a433-2d03c486c616',
  'f0f16293-d146-4bb1-a430-5547623a88d0','28e305ff-4e54-404c-b360-21336eb0508e',
  'a41079be-81eb-4874-949d-d6636974dae8','c3f9b8fd-58fe-4a38-a8c5-68aabf81f489',
  'bb54e3f4-30f1-4069-8aec-c5fe238a1359','832b75bc-1555-444c-8354-f3c1b5aba4df',
  'a226fb72-683a-4e74-abe5-b869c87eae1f','38a37a50-a9f4-44f3-b233-376345b4d3d7',
  '4e73d913-8bf4-4c9b-ae92-f76f3ac28055');

COMMIT;
