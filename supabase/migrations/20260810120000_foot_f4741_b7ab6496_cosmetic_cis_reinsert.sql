-- T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI — up (freeze-set reinsert)
--
-- 김병완(F-4741) 8/1 재결제 b7ab6496(73,000, active)에 딸린 화장품 3종 check_in_services 라인이
-- 08-03 차트 재저장(cis delete-all→reinsert, RC=PaymentMiniWindow load 재구성 silent drop)으로 소멸.
-- 결제행 alive · line-item 부재 = 결제-서비스라인 unlink → SalesStaffTab 김규리 8월 매출 누락.
-- 본 마이그레이션은 소멸 3라인을 부모 check_in dec7e6c4 에 reinsert + seller_staff_id=김규리(치료사) 귀속.
--
-- SOP: Cross-CRM Data-Correction Backfill SOP + Migration Ledger/No-Persistence Protocol.
-- DA GO: da_decision_foot_f4741_cis_reinsert_kimgyuri_20260809.md (HEAD e16841f2f36) 조건부 GO.
-- seller attestation: 김주연 총괄 직접 확정 2026-08-10 08:07 (reply_ts 1786316619.427329) →
--   seller_staff_id = 3a0c6774 (치료사 김규리). 동명이인 admin d26717cb 는 NON-target.
-- 값 provenance: Tier2 (cis archive 부재 — payment-line 지문 + KIMBB-REMOVE closed SSOT + 카탈로그 정확가
--   폐합 Σ(42,000+15,000+16,000)=73,000==b7ab6496.amount). 임의 값 창작 없음.
--
-- change_class = DATA_CORRECTION_BACKFILL (DDL 0 · 순수 DML · BEGIN/COMMIT/txn-control 없음).
-- 멱등: 고정 PK + (check_in_id,service_id,price,voided_at IS NULL) NOT EXISTS 가드 + ON CONFLICT (id) DO NOTHING.
-- freeze-set: 부모 check_in dec7e6c4 + payment b7ab6496(73,000) + 3 활성 풋화장품 service_id + seller 3a0c6774.
-- payments/service_charges 무접촉 (VG-add-1 화장품 is_insurance_covered=false → sc 자동파생 0 · payment write 0).

INSERT INTO public.check_in_services
  (id, check_in_id, service_id, service_name, price, original_price,
   is_package_session, package_session_id, seller_staff_id,
   koh_nail_sites, koh_requested, blood_test_requested)
SELECT
  v.id, v.check_in_id, v.service_id, v.service_name, v.price, v.original_price,
  false, NULL, v.seller_staff_id, '[]'::jsonb, false, false
FROM (VALUES
  -- 풋샴푸 (200ml) — 42,000
  ('ab3c1841-3557-419c-9d0d-1acbfa961c1d'::uuid, 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,
   '89095450-223f-4863-89a9-c7f32f62809d'::uuid, '풋샴푸 (200ml)', 42000, 42000,
   '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid),
  -- Care Toe Band (CTB) — 15,000
  ('47eb9b88-b595-46af-a183-c32c720b6845'::uuid, 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,
   'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid, 'Care Toe Band (CTB)', 15000, 15000,
   '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid),
  -- 리페어 핸드크림 (30ml) — 16,000
  ('515a6214-b038-4f45-8869-5dfd1db151da'::uuid, 'dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf'::uuid,
   'cb6443a3-fe53-40e7-bd51-a4444d8a8966'::uuid, '리페어 핸드크림 (30ml)', 16000, 16000,
   '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid)
) AS v(id, check_in_id, service_id, service_name, price, original_price, seller_staff_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.check_in_services c
   WHERE c.check_in_id = v.check_in_id
     AND c.service_id  = v.service_id
     AND c.price       = v.price
     AND c.voided_at IS NULL
)
ON CONFLICT (id) DO NOTHING;
