-- T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — ROLLBACK (v1, 멱등, before-state 정확복원)
-- 사용: Phase3 apply 후 롤백 필요 시. before-state = R2 canonical 부재 + closing_manual_payments 8건 존재.
-- 마커(T-20260714-DRIFT-R2) 기반으로만 제거 → R1(SAMEDAY-REMAP) canonical 12행 무접촉.
BEGIN;

-- (1) R2 canonical package_payments 제거 (A/B 6행)
DELETE FROM package_payments WHERE memo LIKE '%T-20260714-DRIFT-R2%';

-- (2) R2 canonical payments(진찰료 single) 제거 (C 2행)
DELETE FROM payments WHERE memo LIKE '%T-20260714-DRIFT-R2%';

-- (3) 영향 6개 패키지 paid_amount 재집계 (R2 pp 제거 후 = before 상태 0 복원)
UPDATE packages p SET paid_amount = COALESCE((
  SELECT SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END)
  FROM package_payments pp WHERE pp.package_id = p.id), 0)
WHERE p.id IN (
  '2b8a0c23-9fb0-46c0-ba05-707ac8ae84cf','a2869398-631a-4dd3-84a2-1dc43ffb082c',
  'f7f02420-966b-4ace-b076-c7c2aa80d01c','730a1e69-d5dd-420e-b4ba-e4f26e52b61a',
  'db0a17a6-7f41-48e6-b076-96b74d6e7197','8d42dbcb-a2f3-47c0-8819-a914544ac578');
-- (허유희 F-4696 24회권은 R2가 single로만 계상 → 패키지 paid 무접촉, 여기서 재집계 대상 아님)

-- (4) 원 closing_manual_payments 8건 재삽입 (before-state 정확복원, id 포함 원값)
INSERT INTO closing_manual_payments (id, clinic_id, close_date, pay_time, chart_number, customer_name, amount, method, staff_name, memo, created_at)
VALUES
  ('54f54cc3-cc54-4c66-bbb9-e4132bc5de7f','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','17:51','F-4564','허유진',10000,'card','송지현',NULL,'2026-07-14 08:51:55.892739+00'),
  ('580bda4d-d408-4090-b9a5-763de19e5a6b','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','18:50',NULL,'김성애',10000,'card','정연주',NULL,'2026-07-14 09:50:56.480505+00'),
  ('7021a5ca-ecc7-451b-93ed-eb784e5dc701','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:01',' F-4645','노수옥',10000,'card','정연주',NULL,'2026-07-14 10:02:56.290428+00'),
  ('bb0bd71c-8e03-4e4f-bc2f-c9075bef58b4','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:03','F-4642','이멋진',10000,'card','엄경은',NULL,'2026-07-14 10:04:00.755442+00'),
  ('3a713bd7-a151-40ff-a743-f31fe5af1cfe','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:05','F-4702','이재성',350000,'card','엄경은',NULL,'2026-07-14 10:05:58.73756+00'),
  ('e0280dbb-02b4-43d4-bf31-5d0dd0284ea8','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:12','F-4643','황찬식',10000,'card','송지현',NULL,'2026-07-14 10:12:54.857373+00'),
  ('78c19a4f-ec9e-4d0e-b1e8-a7a45116ebbd','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:21','4696','허유희',8900,'card','데스크',NULL,'2026-07-14 10:22:23.513342+00'),
  ('4ff33dc0-36da-40c4-8181-e87f0bc6ecf8','74967aea-a60b-4da3-a0e7-9c997a930bc8','2026-07-14','19:22','4702','이재성',8900,'card','데스크',NULL,'2026-07-14 10:22:42.832872+00')
ON CONFLICT (id) DO NOTHING;

COMMIT;
