-- ════════════════════════════════════════════════════════════════════════════
-- T-20260617-foot-DOCFORM-POPUP-OVERHAUL — Migration B Phase3 (Q2/Q3 레거시/중복 soft deactivate)
-- ★ GATE CLEARED — data-architect 정식 재판정 = GO (2026-06-30)
--   da_replies/DA-20260630-foot-DOCFORM-RELABEL-RECONCILE.md (MSG-20260630-104253-l5zq)
--     · Q2 GO: 소견서 국문 중복 canonical=진료소견서(10000) → 레거시 소견서 C5900003(20000) soft deactivate. ★D1 구속.
--     · Q3 GO: 진료기록사본 단일 SKU(진료기록사본1, pricing_tiers) → 진료기록사본2(100) soft deactivate. ★D2/D1 구속.
--   · Migration B(20260630140000) §5에서 'DA Q2/Q3 미승인 → HOLD'로 주석 보류했던 2행을 본 재판정 GO로 해제.
--
-- ★ D1 가드 준수 (롤업 조인 금지조항):
--   soft deactivate(active=false)만. DELETE 금지 → 기적재 service_charges/payments 무손상.
--   매출 fact grain = 캡처된 charge 스냅샷(service_charges)이지 services 마스터 행 아님(Revenue Insurance Split §0/§2-1).
--   코드 검증: 매출 롤업(Closing.tsx / stats.ts)은 services.active 로 inner-join/filter 하지 않음
--     (active 필터는 staff/user_profiles 한정 + PaymentDialog/PaymentMiniWindow 신규발행 picker 한정) → 과거매출 탈락 0.
--   ★ canonical 행 머지 금지: 소견서(C5900003,20000)·진료기록사본2(100)는 별개 SKU. 과거 charge 재가격/머지 안 함(forward-only).
--
-- ★ 적용 전 라이브 실측 검증 (2026-06-30, Management API):
--   · C5900003 소견서 price=20000 active=true category_label=기본 실재 ✅ (canonical 진료소견서 10000 별도 존재)
--   · 진료기록사본2 price=100 active=true 실재 ✅ (canonical 진료기록사본1 pricing_tiers 인코딩 완료)
--   · 두 행 모두 form_templates.service_id 링크 0 / service_charges 참조 0 → 발행경로·과거매출 무영향 ✅
--   · 레거시 C59000xx inactive 4종(C5900005/6/7/8)은 무접촉(resurrect/DELETE 금지) ✅
--
-- 매출 영향 0(soft 플래그만, 과거 charge 0). 멱등: active=true 가드 → 재실행 no-op.
-- rollback: 20260630180000_foot_docform_q2q3_deactivate.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Q2/Q3. 레거시/중복 SKU soft deactivate (active=false, DELETE 금지) ─────────────
--  · 소견서 C5900003(20,000) → canonical 진료소견서(10,000)로 신규발행 통일, 레거시는 picker 숨김.
--  · 진료기록사본2(100)       → canonical 진료기록사본1 pricing_tiers에 6매↑ 흡수, 레거시는 picker 숨김.
--  D1: active 플래그는 신규발행 UI에만 작용. 과거 charge 스냅샷 무손상. 행 머지 없음.
UPDATE services
   SET active = false
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('C5900003', '진료기록사본2')
   AND active = true;  -- 멱등 가드(이미 false면 0행 no-op)

COMMIT;
