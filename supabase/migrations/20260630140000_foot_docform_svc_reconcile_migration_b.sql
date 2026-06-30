-- ════════════════════════════════════════════════════════════════════════════
-- T-20260617-foot-DOCFORM-POPUP-OVERHAUL — Migration B (서류 SKU 행 등재/백필/가격 reconcile)
-- ★ GATES CLEARED — 적용 GO (2026-06-30)
--   ① DA 'ADDITIVE→가격reconcile' 정식 재판정 = GO 조건부 C1~C4
--      (da_replies/DA-20260630-foot-DOCFORM-PRICE-RECONCILE.md, corroborate INFO MSG-20260630-102748-ecul)
--   ② reporter(김주연 총괄) 라이브 단가 confirm = RESOLVED_CONFIRMED (MSG-20260630-095635-7oqz, 10:03)
--      → 가격 mutate = 진료의뢰서 1행만 (0→3,000). 소견서·진단서 2종 = 의사영역 → relabel-only(가격 보존).
--   ③ 대표 게이트 면제(autonomy §3.1: 단일행·forward-only·현장단가권위·SSOT 무수정) · supervisor DDL-diff 불요(데이터 UPDATE, DDL 아님 — DDL=Migration A 별도 트랙).
--   선행: Migration A(20260629210000_form_service_bridge_additive.sql) 적용 완료(form_templates.service_id / services.pricing_tiers / v_foot_form_master).
--
-- ★ 적용 전 라이브 실측 검증 (2026-06-30, Management API):
--   · C1 forward-only: service_charges = INSERT 시점 base_amount/copayment_amount INTEGER 스냅샷 보존(live services.price 역참조 아님) → 과거 매출 무손상 ✅
--   · C2 1행 scope: 진료의뢰서 = id 78dd40fb 단 1행 ✅
--   · C3 before=0: 진료의뢰서 현 price=0 실측 확인(before≠0이면 STOP 규칙 — 통과) ✅
--   · C4 비급여 강제: 진료의뢰서 is_insurance_covered=false / vat_type='none' (급여 미등재) ✅
--   · 무료 4종 name UNIQUE(clinic_id,name) 충돌 0 / relabel 6행 category_label='기본' 현존 ✅
--
-- 유일 라이브 가격 mutate = 진료의뢰서 1행(0→3,000). 나머지 = relabel-only/greenfield 0원 INSERT/메타 = 매출 0.
-- 멱등: WHERE price=0 / ON CONFLICT DO NOTHING / category_label='기본' 가드 → 재실행 안전.
-- rollback: 20260630140000_foot_docform_svc_reconcile_migration_b.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 무료 4종 0원 제증명 행 INSERT (greenfield, ADDITIVE, 매출0) ─────────────────
--  영수증/세부내역서/KOH결과지/처방전 = services 행 부재 → 0원 제증명 신규. C4: is_insurance_covered=false(비급여).
INSERT INTO services (clinic_id, name, category, category_label, price, service_code, vat_type, service_type, active, is_insurance_covered, sort_order)
VALUES
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료비영수증',       '기본', '제증명', 0, 'cert_bill_receipt', 'none', 'single', true, false, 30),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '진료비세부내역서',   '기본', '제증명', 0, 'cert_bill_detail',  'none', 'single', true, false, 31),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'KOH균검사결과지',    '기본', '제증명', 0, 'cert_koh_result',   'none', 'single', true, false, 32),
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', '처방전(제증명)',     '기본', '제증명', 0, 'cert_rx_standard',  'none', 'single', true, false, 33)
ON CONFLICT (clinic_id, name) DO NOTHING;  -- 멱등

-- ── 2. 진료의뢰서 가격 mutate (0 → 3,000) — ★유일 라이브 가격 변경 (C1~C4, reporter confirm) ──
--  C3 가드: price=0 일 때만 적용(before≠0이면 0행 → STOP 시그널). C4: is_insurance_covered 미변경(비급여 유지).
UPDATE services
   SET price = 3000, category_label = '제증명'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code = '진료의뢰서'
   AND price = 0;  -- 멱등 가드(이미 3000이면 no-op)

-- ── 3. relabel-only: category_label 기본→제증명 (가격 불변) ──────────────────────────
--  소견서·진단서(국·영) = 의사영역 가격 보존. 통원확인서·진료기록사본 = 가격 일치/메타만.
UPDATE services
   SET category_label = '제증명'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN (
     'C5900002',        -- 진단서(국문) 20,000 보존
     '진단서(영문)',     -- 30,000 보존
     '진료소견서',       -- 소견서 국문 10,000 보존 (canonical)
     '소견서(영문)',     -- 30,000 보존
     '통원확인서',       -- 3,000 (일치)
     '진료기록사본1'      -- 1,000 (계단단가 canonical)
   )
   AND category_label = '기본';  -- 멱등

-- ── 4. 진료기록사본 계단단가 pricing_tiers 인코딩 (flat price 불변) ────────────────────
UPDATE services
   SET pricing_tiers = '[{"min":1,"max":5,"unit":1000},{"min":6,"max":null,"unit":100}]'::jsonb
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code = '진료기록사본1';

-- ── 5. (DA Q2/Q3 미승인 → HOLD) 중복/레거시 deactivate = 미적용 ───────────────────────
--  소견서 C5900003(20,000 중복) / 진료기록사본2(100, tiers 흡수) deactivate = DA canonical 선택 승인 시에만.
--  현 reconcile 판정(C1~C4)은 active 플래그 변경 미포함 → 주석 유지.
-- UPDATE services SET active = false
--  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8' AND service_code IN ('C5900003','진료기록사본2');

-- ── 6. form_templates.service_id 백필 (브리지 link, 매출0) ────────────────────────────
--  form_key → canonical services.service_code 매칭. treat_confirm(진료확인서)=가격분기 reporter 재게이트 HOLD → 제외.
UPDATE form_templates ft SET service_id = s.id
  FROM services s
 WHERE ft.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND s.clinic_id = ft.clinic_id
   AND (
     (ft.form_key = 'bill_receipt'           AND s.service_code = 'cert_bill_receipt') OR
     (ft.form_key = 'bill_detail'            AND s.service_code = 'cert_bill_detail') OR
     (ft.form_key = 'koh_result'             AND s.service_code = 'cert_koh_result') OR
     (ft.form_key = 'rx_standard'            AND s.service_code = 'cert_rx_standard') OR
     (ft.form_key IN ('diag_opinion','opinion_doc') AND s.service_code = '진료소견서') OR
     (ft.form_key = 'diag_opinion_v2'        AND s.service_code = '소견서(영문)') OR
     (ft.form_key = 'diagnosis'              AND s.service_code = 'C5900002') OR
     (ft.form_key = 'referral_letter'        AND s.service_code = '진료의뢰서') OR
     (ft.form_key = 'visit_confirm'          AND s.service_code = '통원확인서') OR
     (ft.form_key = 'medical_record_request' AND s.service_code = '진료기록사본1')
     -- treat_confirm(진료확인서) = HOLD(reporter 가격 분기 재게이트) → 백필 제외
   );

COMMIT;
