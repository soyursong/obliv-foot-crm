-- T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 3 ROLLBACK (net-zero 역연산)
-- apply.sql 집행 상태에서만 유효. 멱등(재실행 안전). closing_manual_payments 13건 원복 + canonical 제거 + paid_amount 재집계.
BEGIN;

-- (1) closing_manual_payments 13건 재삽입 (before-state 복원)
INSERT INTO closing_manual_payments
  (id, clinic_id, close_date, pay_time, chart_number, customer_name, lead_source, visit_type, staff_name, amount, method, memo, created_at)
VALUES
  ('804b6d72-cf9f-4827-9545-1aa126f59573','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','11:25','F-4590','전인호',NULL,NULL,'엄경은',10000,'card',NULL,'2026-07-14 02:26:38.768213+00'),
  ('4e73d913-8bf4-4c9b-ae92-f76f3ac28055','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','12:06','F-4695','이미현',NULL,NULL,'데스크',8900,'card','진찰료','2026-07-14 03:07:03.789502+00'),
  ('b674132c-b68f-4920-9b25-977527e39eb9','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','12:16','F-4644','최고',NULL,NULL,'정연주',10000,'cash',NULL,'2026-07-14 03:16:56.943364+00'),
  ('a503218f-0d0a-4393-a771-a6ddf8a02173','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','13:02','F-4646','박형규',NULL,NULL,'송지현',10000,'card',NULL,'2026-07-14 04:03:51.660439+00'),
  ('dfd30a1a-1b6c-463d-a433-2d03c486c616','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:15','F-4652','진태주',NULL,NULL,'엄경은',10000,'card',NULL,'2026-07-14 06:15:40.054863+00'),
  ('f0f16293-d146-4bb1-a430-5547623a88d0','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:16','F-4655','마서현',NULL,NULL,'엄경은',10000,'card',NULL,'2026-07-14 06:16:47.519915+00'),
  ('28e305ff-4e54-404c-b360-21336eb0508e','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:21','F-4600','최창수',NULL,NULL,'송지현',10000,'card',NULL,'2026-07-14 06:22:26.865033+00'),
  ('a41079be-81eb-4874-949d-d6636974dae8','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:45','F-4601','정종석',NULL,NULL,'정연주',10000,'card',NULL,'2026-07-14 06:46:47.180717+00'),
  ('c3f9b8fd-58fe-4a38-a8c5-68aabf81f489','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:50','F-4546','김종형',NULL,NULL,'정연주',10000,'card',NULL,'2026-07-14 06:50:29.152214+00'),
  ('a226fb72-683a-4e74-abe5-b869c87eae1f','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:51','F-4696','허유희',NULL,NULL,'송지현',3880000,'card','100만원 이체','2026-07-14 06:52:06.302173+00'),
  ('38a37a50-a9f4-44f3-b233-376345b4d3d7','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','15:52','F-4696','허유희',NULL,NULL,'송지현',1000000,'transfer',NULL,'2026-07-14 06:52:33.853338+00'),
  ('bb54e3f4-30f1-4069-8aec-c5fe238a1359','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','16:32','F-4597','윤철희',NULL,NULL,'정연주',10000,'card',NULL,'2026-07-14 07:33:12.61831+00'),
  ('832b75bc-1555-444c-8354-f3c1b5aba4df','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','16:34','F-4687','신용섭',NULL,NULL,'송지현',10000,'card',NULL,'2026-07-14 07:35:11.829311+00')
ON CONFLICT (id) DO NOTHING;

-- (2) canonical package_payments / payments 제거 (opt-A 마커로 식별)
DELETE FROM package_payments WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';
DELETE FROM payments         WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';

-- (3) 패키지 paid_amount 재집계 (0 복원)
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

COMMIT;
