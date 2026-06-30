-- ════════════════════════════════════════════════════════════════════════════
-- T-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL — 진료확인서 2 SKU relabel(+bridge) 슬라이스
-- ★ B안 확정 (reporter 김주연 총괄, MSG-20260630-110054-unrn): 두 종류 그대로 유지·가격 변경 0.
--    · 진료확인서(코드·진단명 포함)   = 진료확인서1 / 10,000원 유지
--    · 진료확인서(코드·진단명 불포함) = 진료확인서2 /  3,000원 유지
--    · 가격 mutate 0 → relabel(+bridge)만. deactivate/DELETE/머지/resurrect 무.
--    · 부모: T-20260617-foot-DOCFORM-POPUP-OVERHAUL qb_price_branch_gate (Migration B 동형 슬라이스).
--    · DA RELABEL-RECONCILE §5 가 본 행을 "별도 슬라이스(별 CONSULT)"로 명시 카브아웃 → HOLD→GO = DA 1차 게이트 경로 필수.
--
-- ✅✅ 적용 GO — DA CONSULT-REPLY 수령 (relabel=GO) ✅✅
--    게이트: data-architect MSG-20260630-123516-vsyz (DA-…-DOCCONFIRM-PRICEBRANCH-RELABEL)
--      · relabel = GO. 대표 게이트 면제 동의 + supervisor DDL-diff 불요 동의 (UPDATE-only·DDL0).
--      · D1(forward-only/행머지금지) + D3(tax=비급여) 승계. before 실측 1행 대조 가드(§4-2) 하 적용.
--      · bridge = (α) defer → 별도 슬라이스 T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT 으로 이관 (본 슬라이스 미포함).
--      · C5900004(out-of-scope 진료확인서 3000) = 무접촉 동의 (후속 dedup→reporter 회부).
--    적용: node scripts/apply_20260630150000_foot_docconfirm_pricebranch_relabel.mjs (preflight 실측대조 내장).
--
-- ★ 라이브 실측 (2026-06-30, Management API · read-only) ───────────────────────────────
--   [services — relabel 대상 = 모호 0, GO-ready]
--     · 진료확인서1  id=b590d457  price=10000  category_label='기본'  active=t  is_insurance_covered=f  vat='none'
--     · 진료확인서2  id=67ce0da3  price= 3000  category_label='기본'  active=t  is_insurance_covered=f  vat='none'
--     · (out-of-scope) C5900004 '진료확인서' price=3000 category_label='기본' = 레거시 3번째 행. B안 scope(2 SKU)에 미포함 → 무접촉(머지/deactivate 금지 준수). DA/planner 통보.
--   [form_templates — ★ 티켓 가정과 불일치: bridge 대상 부재]
--     · 라이브 foot-service 폼 20행 中 진료확인서 폼 = 'treat_confirm'(레거시 단일, html, service_id=NULL) 1행뿐.
--     · 티켓이 지정한 'treat_confirm_code' / 'treat_confirm_nocode' = DB 행 0 (formTemplates.ts FALLBACK 전용, id='fallback-…').
--     · FE 머지 = ALL-OR-NOTHING (footDbTpls.length>0 ? footDbTpls : FALLBACK) → DB행 존재 ∴ FALLBACK 휴면 = code/nocode 현재 미렌더.
--     ⇒ "treat_confirm_code→10,000 / treat_confirm_nocode→3,000 백필" 은 적용할 대상 행이 없음. → DA/planner 게이트 필요(아래 §2 HOLD).
--
-- 멱등: category_label='기본' 가드 → 재실행 안전. forward-only(service_charges INTEGER 스냅샷, 과거 매출 무손상).
-- rollback: 20260630150000_foot_docconfirm_pricebranch_relabel.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. relabel-only: 진료확인서 2 SKU category_label 기본→제증명 (가격·name 불변, UNIQUE 무관, 매출0) ──
--  reporter B안 = 두 SKU 가격 보존(10,000 / 3,000). 본 UPDATE 는 분류 라벨만 이동(서비스관리 '제증명' 그룹 노출).
--  C-가드: category_label='기본' 일 때만(멱등 — 이미 '제증명'이면 0행 no-op). 가격 컬럼 미접촉.
UPDATE services
   SET category_label = '제증명'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('진료확인서1', '진료확인서2')
   AND category_label = '기본';

-- ── 2. service_id bridge ─ ✅ (α) defer 확정 (DA CONSULT-REPLY MSG-20260630-123516-vsyz §2) ──────
--  판정: (α) relabel-only + bridge defer 채택. (β)(γ) 반려.
--    · (β) 반려 = seed 후 패널 3중표시 회피 위해 레거시 deactivate 필요 → B안 'deactivate 무' 제약 위반.
--    · (γ) 반려 = 레거시 단일행→한 SKU bridge 가 10,000/3,000 택1 추정(§S2.4 위반). DA는 분기값 미발명.
--  근거: 티켓 백필 대상('treat_confirm_code/nocode')=DB행 0(FALLBACK 휴면)·레거시 'treat_confirm' 단일행 service_id=NULL.
--        백필할 행 부재 = 사실 → row mutate/merge/deactivate 0 → D1 forward-only 완전 보존, 회귀 0(status quo).
--  ⇒ bridge 는 '백필'이 아니라 폼 아키텍처(code/nocode 분리) 결정 → 별도 슬라이스 T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT 으로 이관.
--    본 슬라이스에서 service_id 미변경(레거시 NULL 현상태 불변).

COMMIT;
