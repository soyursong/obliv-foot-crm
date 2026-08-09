-- T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — F-4872 김정숙 풋샴푸(200ml) 42,000 단건 backfill
--
-- 근거: DA CONSULT-REPLY2 rwrj (line-only HARD NO-GO / payments 동반 atomic / field 실수금 HARD 선행게이트)
--       nph2 confirm 도달 = 김주연 총괄(U0ATDB587PV) "실결제 맞음·카드·7/18·임별"
--       (thread 1785492540.190029, MSG-20260809-072208-ndc6). F-4872 풋샴푸 42,000 실판매·실수금 확정.
--       da_consult_ref: DA-20260725 rwrj + j28n (CONDITIONAL GO, payments-grain·멱등·forward-only seller)
--       ★신규 DA CONSULT 불요 — rwrj field-gated 행별 3분기 프레임워크가 F-4872 포함 3행 스코프 이미 승인.
--
-- ★ prod 실측(census, service_role read-only, scripts/T-20260725-foot-SALESLIST-F4872-census.mjs)으로 분기 확정:
--
--   [F-4872 김정숙] 분기① atomic INSERT (payments + line)
--     - 풋샴푸 라인 부재(check_in_services 0건, price=42000 라인 0건) + 매칭 payment 부재(amount=42000 payment 0건).
--       기존 payments = 1,820/07-25 · 1,800/08-01 · 1,800/08-08 = 풋샴푸 42,000 과 금액·성격 무관 = 별거래.
--     - 앵커 check_in = f6ca21d1 (2026-07-18, therapist=7c24cd3b 임별 = seller 본인 방문 · status=payment_waiting).
--       ※ IMG_9059/field 판매일=07-18 이 앵커 방문일(임별 대면)과 일치 → accounting_date=2026-07-18 채택.
--         F-4550 처럼 divergence 없음(07-18 방문 자체가 임별 seller 방문) → shift/disclosure 불요.
--         42,000 매칭 카드거래 흔적 부재 = payment 캡처 누락(status payment_waiting 정합) = 분기① 근거.
--     - netting: seller=therapist=임별 자기정합 →
--               payment(+42,000 → ci therapist 7c24cd3b) − 화장품차감(−42,000 → 동일 ci therapist 7c24cd3b)
--               = 치료매출 순증 0, 화장품 컬럼 seller=임별 +42,000, systemTotal(payments-grain) +42,000. 급여split 오염 0.
--
-- ★ 풋샴푸(200ml)=비급여 화장품(category=풋화장품) → payments.service_charge_id=NULL (급여 브릿지 불요, 골든 정합).
--   (check_in_services 에는 service_charge_id 컬럼 없음 = 라인측 브릿지 무관.)
-- ★ seller_staff_id = 7c24cd3b (임별, role=therapist, 단일 active row = 김규리 같은 중복 admin/therapist 모호성 없음).
--
-- ★ 교차참조 — COSMETIC-CORRECTION #3 double-authoring 방지(§13.1.C):
--   T-20260804-foot-COSMETIC-CORRECTION-CRM #3 도 동일 F-4872 42,000 참조(그 티켓은 F-4872 제외 deployed).
--   본 rwrj payments 프레임워크가 실행 authoritative — 멱등 HARD(WHERE NOT EXISTS + 고정 PK)로 단일 INSERT 보장.
--   COSMETIC-CORRECTION Tier1 기대값(임별 화장품 총 99,000에 본 42,000 포함) reconcile 검산 근거.
--
-- 멱등성 HARD: 전 write 를 business-key(check_in+제품+금액) NOT EXISTS + 고정 PK ON CONFLICT DO NOTHING 이중 가드.
--             재실행 시 rows-affected=0 (기존재 재INSERT 금지).
-- ⚠ up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음(순수 DML) → dry-run txn-strip 무해(No-Persistence Protocol 정합).

-- ── (A) F-4872 김정숙 — 분기① 라인 INSERT (풋샴푸 200ml) ─────────────────────────
INSERT INTO public.check_in_services
  (id, check_in_id, service_id, service_name, price, original_price,
   is_package_session, seller_staff_id, koh_nail_sites, koh_requested, blood_test_requested)
SELECT
  '87beac3a-df9b-433b-827e-43e51a1d2107'::uuid,
  'f6ca21d1-a672-4cd4-b407-588e5940c327'::uuid,
  '89095450-223f-4863-89a9-c7f32f62809d'::uuid,
  '풋샴푸 (200ml)', 42000, 42000,
  false, '7c24cd3b-8e52-4c72-9652-e14f75151514'::uuid, '{}'::jsonb, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.check_in_services
   WHERE check_in_id = 'f6ca21d1-a672-4cd4-b407-588e5940c327'::uuid
     AND service_id  = '89095450-223f-4863-89a9-c7f32f62809d'::uuid
     AND price = 42000
)
ON CONFLICT (id) DO NOTHING;

-- ── (B) F-4872 김정숙 — 분기① payment INSERT (동일 check_in 페어링, 42,000 card) ───
INSERT INTO public.payments
  (id, check_in_id, customer_id, clinic_id, amount, method, installment,
   payment_type, accounting_date, status, is_simulation, memo)
SELECT
  '7b8b9f74-c7aa-4d23-92ad-42033ec02096'::uuid,
  'f6ca21d1-a672-4cd4-b407-588e5940c327'::uuid,
  'f98676b2-2bbe-4050-ac5b-803c41e28e55'::uuid,
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  42000, 'card', 0, 'payment', DATE '2026-07-18', 'active', false,
  '[BACKFILL T-20260725-SALESLIST] 풋샴푸(200ml) 42,000 card / seller 임별 / C1 field-confirmed 실수금 YES 2026-08-09(김주연 총괄 nph2)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payments
   WHERE check_in_id = 'f6ca21d1-a672-4cd4-b407-588e5940c327'::uuid
     AND amount = 42000 AND payment_type = 'payment'
     AND COALESCE(status,'active') <> 'deleted'
)
ON CONFLICT (id) DO NOTHING;
