-- T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI
-- 현은호(F-4717) 7/28 케어토어밴드(CTB) 15,000 결제 2e8f7aa5 의 부재 화장품 판매라인(cis) 신규 CREATE + 김규리 귀속
--
-- 근거 SSOT: agents/docs/da_replies/da_decision_foot_heo4717_2e8f7aa5_cis_create_kimgyuri_20260809.md
--   verdict = Q1 GO (조건부·verify-gated) — cis 신규 CREATE 는 매출 이중계상을 유발하지 않는다.
--   dispositive = cis 와 payments 를 동일 total 로 합산하는 뷰 0건([8] cis 참조뷰 0 / [9] 총매출·일마감·수납·명세 전부 payments-only)
--                → 총매출축(payments) ⊥ 화장품-판매자귀속축(cis) 직교. cis CREATE = 화장품 breakdown 에만 +15,000.
--
-- ★★ 이 백필은 cis 라인 1행만 INSERT 한다. payment 는 INSERT 하지 않는다 ★★
--    payment 2e8f7aa5(15,000, active, card) 는 T-20260806 에서 이미 INSERT 되어 v_daily_revenue[07-28]에 1회 계상 중.
--    payment 를 또 만들면 = 진짜 이중계상(DA re-CONSULT #2 HARD ABORT). 그래서 라인만 생성(payment-only 상태를 정상 parity 로 복원).
--    → 선례 20260805190000(SALESLIST) 는 payment 부재 건이라 line+payment atomic INSERT 였음. 본건은 구조 상이(payment 旣존재).
--
-- VG census 근거(READ-ONLY, prod write 0 — scripts/..._vg_census.mjs / db-gate/..._vg-census-evidence.md):
--   VG1 archive-first : c33dfc76 현 cis 6행(재진 물리치료4690·비가열레이저240000·손발톱백선0·발백선0·바르토벤0·터미졸크림0) = 롤백 원본. CTB 없음.
--   VG2 freeze-set    : payment 2e8f7aa5(15,000 active) + check_in c33dfc76(07-28, therapist 3a0c6774 김규리, returning, done) + service e17ba3a3(CTB 15,000 active 풋화장품). apply 직전 재-freeze DRIFT ABORT.
--   VG4(e)            : c33dfc76 하 CTB(e17ba3a3) cis = 0건 확인 (CREATE 대상·무→유).
--   검토 B(side-effect): check_in_services 에 CREATE TRIGGER 0건(code-proven) → cis INSERT 가 payment/service_charge 자동파생 없음(re-CONSULT #1/#2 부재).
--   VG5 seller        : 김규리 동명이인 2행 中 therapist 3a0c6774(방문 결속) 채택 / admin d26717cb 배제. seller_staff_id = mutable 판매귀속(§416 created_by 방화벽과 직교).
--
-- 값 provenance(창작 0): service e17ba3a3 카탈로그 price 15,000 == payment 2e8f7aa5.amount == 기존 CTB 라인(76199926) parity.
-- 표시월 = 7월 (check_ins.checked_in_at = 2026-07-28) — 08월 check_in 신설 = 데이터왜곡 HARD 금지.
--
-- 멱등성 HARD: business-key(check_in + service + price) NOT EXISTS + 고정 PK ON CONFLICT DO NOTHING 이중 가드.
--             재실행 시 rows-affected = 0.
-- ⚠ BEGIN/COMMIT/트랜잭션 제어문 없음(순수 DML) → dry-run txn-strip 무해(No-Persistence Protocol 정합).
-- ⚠ apply_before_go: 본 파일은 supervisor DB-GATE GO-token(db_apply_guard.sh lane) 발행 후에만 prod apply.

-- ── 부재 CTB 화장품 라인 신규 CREATE (라인 1행만·payment write 0) ──────────────
INSERT INTO public.check_in_services
  (id, check_in_id, service_id, service_name, price, original_price,
   is_package_session, package_session_id, seller_staff_id,
   koh_nail_sites, koh_requested, blood_test_requested)
SELECT
  '070652f3-3cb0-414a-ad80-98bf4c967e59'::uuid,
  'c33dfc76-cda5-48e6-9b34-277281b26626'::uuid,
  'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid,
  'Care Toe Band (CTB)', 15000, 15000,
  false, NULL, '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid,
  '{}'::jsonb, false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.check_in_services
   WHERE check_in_id = 'c33dfc76-cda5-48e6-9b34-277281b26626'::uuid
     AND service_id  = 'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid
     AND price = 15000
)
ON CONFLICT (id) DO NOTHING;
