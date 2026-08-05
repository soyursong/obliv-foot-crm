-- T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — 김규리 CTB 3건 field-gated 행별 3분기 backfill
--
-- 근거: DA CONSULT-REPLY2 rwrj (line-only HARD NO-GO / payments 동반 atomic / field 실수금 HARD 선행게이트)
--       C1 실수금 게이트 CLEARED = 김주연 총괄(U0ATDB587PV) "웅 맞음"(reply_ts 1785919227.259839, C0ATE5P6JTH)
--       결제수단 = 카드 (reply_ts 1785920773.694879) — F-4550·F-5016·F-4906 CTB 15,000×3 실판매·실수금 확정.
--       da_consult_ref: DA-20260725 rwrj + j28n (CONDITIONAL GO, payments-grain·멱등·forward-only seller)
--
-- ★ prod 실측(AC-1 census, service_role read-only)으로 행별 분기 확정 — blanket 3-INSERT 아님:
--
--   [F-4550 이영수] 분기① atomic INSERT (payments + line)
--     - CTB 라인 부재(price=15000 라인 0건) + 매칭 CTB payment 부재
--       (기존 payment 280,000/07-25 card 는 CTB 15,000 과 금액·성격 무관 = 별거래 → ②링크정합 대상 아님)
--     - 앵커 check_in = cba142a6 (2026-07-25, therapist=3a0c6774 김규리 = seller 본인 방문 · 동일자 카드거래 실재)
--       ※ IMG_9059 판매리스트 표기일=07-18 이나, 07-18 방문(ci=85766c3b)은 therapist 상이(5c17e4bc)·카드활동 전무.
--         실수금일 증거(김규리 대면 + 카드 트랜잭션)가 07-25 에 집중 → accounting_date=2026-07-25 채택(FOLLOWUP 명시).
--     - netting: payment(+15,000 → ci therapist 3a0c6774) − 화장품차감(−15,000 → 동일 ci therapist 3a0c6774) = 치료매출 순증 0,
--               화장품 컬럼 seller=김규리 +15,000, systemTotal(payments-grain) +15,000. 급여split 오염 0.
--
--   [F-5016 김미성] 분기① atomic INSERT (payments + line)
--     - CTB 라인 부재 + 매칭 CTB payment 부재(기존 8,810/07-22, 1,400×n = 무관)
--     - 앵커 check_in = 39a3361f (2026-07-22, therapist=3a0c6774 김규리 · IMG일=07-22 일치 · 동일자 카드거래 실재)
--     - netting: seller=therapist=김규리 자기정합 → 치료매출 순증 0, 화장품 +15,000, systemTotal +15,000.
--
--   [F-4906 백연재] 분기② 라인↔payment 링크정합 (신규 INSERT 금지 = 이중계상 방지)
--     - CTB 라인 기존재(f519496a, price=15000, seller=NULL) + payment 기존재(853cbcec, 15,000 card, 07-22, 동일 ci=6cf773c3)
--       = 라인·payment 이미 존재·동일 check_in 링크 정합 완료. 수금근거(payment 15,000) 실재.
--     - 유일 결손 = seller_staff_id NULL → 김규리(3a0c6774) 귀속만 (단일셀 UPDATE, 매출이동 0).
--       현행 버킷=COALESCE(NULL, ci.therapist_id=3a0c6774)=김규리 이므로 집계 SUM 불변, 귀속을 명시화(therapist 변경 견고).
--
-- ★ CTB=비급여 화장품(category_label=풋화장품) → service_charge_id=NULL (급여 브릿지 불요, 골든 853cbcec 정합).
-- ★ seller_staff_id = 3a0c6774 (therapist role) — 기존 CTB seller 관례(라인 76199926·f30b5680) 정합. admin d26717cb 아님.
--
-- 멱등성 HARD: 전 write 를 business-key(check_in+제품+금액) NOT EXISTS + 고정 PK ON CONFLICT DO NOTHING 이중 가드.
--             재실행 시 rows-affected=0 (기존재 재INSERT 금지 = F-4906 라인 이중계상 방지 포함).
-- ⚠ up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음(순수 DML) → dry-run txn-strip 무해(No-Persistence Protocol 정합).

-- ── (A) F-4550 이영수 — 분기① 라인 INSERT ──────────────────────────────────────
INSERT INTO public.check_in_services
  (id, check_in_id, service_id, service_name, price, original_price,
   is_package_session, seller_staff_id, koh_nail_sites, koh_requested, blood_test_requested)
SELECT
  'bee88b6d-002c-4149-8c99-67d832b0e930'::uuid,
  'cba142a6-918b-4c71-95df-1cb6b64b3ed5'::uuid,
  'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid,
  'Care Toe Band (CTB)', 15000, 15000,
  false, '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid, '{}'::jsonb, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.check_in_services
   WHERE check_in_id = 'cba142a6-918b-4c71-95df-1cb6b64b3ed5'::uuid
     AND service_id  = 'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid
     AND price = 15000
)
ON CONFLICT (id) DO NOTHING;

-- ── (B) F-4550 이영수 — 분기① payment INSERT (동일 check_in 페어링) ──────────────
INSERT INTO public.payments
  (id, check_in_id, customer_id, clinic_id, amount, method, installment,
   payment_type, accounting_date, status, is_simulation, memo)
SELECT
  '7a0935ed-f4ac-491d-86c0-8d09d0d9440f'::uuid,
  'cba142a6-918b-4c71-95df-1cb6b64b3ed5'::uuid,
  'b3b7eac9-5974-4056-9fa5-1f174be3c31a'::uuid,
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  15000, 'card', 0, 'payment', DATE '2026-07-25', 'active', false,
  '[BACKFILL T-20260725-SALESLIST] CTB 15,000 card / seller 김규리 / C1 field-confirmed 실수금 YES 2026-08-05(김주연 총괄)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payments
   WHERE check_in_id = 'cba142a6-918b-4c71-95df-1cb6b64b3ed5'::uuid
     AND amount = 15000 AND payment_type = 'payment'
     AND COALESCE(status,'active') <> 'deleted'
)
ON CONFLICT (id) DO NOTHING;

-- ── (C) F-5016 김미성 — 분기① 라인 INSERT ──────────────────────────────────────
INSERT INTO public.check_in_services
  (id, check_in_id, service_id, service_name, price, original_price,
   is_package_session, seller_staff_id, koh_nail_sites, koh_requested, blood_test_requested)
SELECT
  '81c754c8-8cd8-4477-83fd-30fcbfe9bc19'::uuid,
  '39a3361f-7887-4d04-8032-ed041e8169da'::uuid,
  'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid,
  'Care Toe Band (CTB)', 15000, 15000,
  false, '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid, '{}'::jsonb, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.check_in_services
   WHERE check_in_id = '39a3361f-7887-4d04-8032-ed041e8169da'::uuid
     AND service_id  = 'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid
     AND price = 15000
)
ON CONFLICT (id) DO NOTHING;

-- ── (D) F-5016 김미성 — 분기① payment INSERT (동일 check_in 페어링) ──────────────
INSERT INTO public.payments
  (id, check_in_id, customer_id, clinic_id, amount, method, installment,
   payment_type, accounting_date, status, is_simulation, memo)
SELECT
  '16729866-5bc8-40d6-9fc9-dc1286f692b8'::uuid,
  '39a3361f-7887-4d04-8032-ed041e8169da'::uuid,
  'e4abf027-9e67-4af8-962b-502d80ad5ca1'::uuid,
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  15000, 'card', 0, 'payment', DATE '2026-07-22', 'active', false,
  '[BACKFILL T-20260725-SALESLIST] CTB 15,000 card / seller 김규리 / C1 field-confirmed 실수금 YES 2026-08-05(김주연 총괄)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payments
   WHERE check_in_id = '39a3361f-7887-4d04-8032-ed041e8169da'::uuid
     AND amount = 15000 AND payment_type = 'payment'
     AND COALESCE(status,'active') <> 'deleted'
)
ON CONFLICT (id) DO NOTHING;

-- ── (E) F-4906 백연재 — 분기② seller 귀속만 (라인·payment 기존재, 링크정합 완료) ──
UPDATE public.check_in_services
   SET seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid
 WHERE id = 'f519496a-e90f-4961-bed6-087e882ee18d'::uuid
   AND seller_staff_id IS NULL;   -- 멱등: 이미 귀속됐으면 no-op
