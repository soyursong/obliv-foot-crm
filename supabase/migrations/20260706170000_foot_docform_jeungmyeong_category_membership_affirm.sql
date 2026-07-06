-- ════════════════════════════════════════════════════════════════════════════
-- T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK — '제증명' 카테고리 membership 재확인(surgical forward)
-- ★ GATES CLEARED — 적용 GO (2026-07-06)
--   ① DA CONSULT-REPLY = GO + ADDITIVE (da_replies/DA-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK.md)
--      · shape = services.category_label 값 그룹(=membership 이동). 별도 category 엔티티/enum/테이블 없음.
--      · 미러 INSERT = REJECT(UNIQUE(clinic_id,name) 충돌/phantom SKU) → 미러 금지 재확인.
--      · ADDITIVE 확정: 멱등 SET·행삭제0·name/price 불변·과거 service_charges/payments 소급0.
--   ② 대표 게이트 면제(autonomy §3.1: ADDITIVE+DA GO → supervisor DML-diff → dev-foot 착수).
--
-- ★ 총괄(김주연) 최종 정정(MSG-c9j1, ts 1783324189.542159) 반영:
--   ① 기본 6행 → '기본' 원복 = ✖ 취소. 6행은 category_label='제증명' 그대로 유지. (원복 UPDATE 없음)
--   ② 제증명 6종 → 신설 '제증명' 카테고리로 이동(이름 변경 없이 membership 재귀속). 미러/복사 아님.
--   ③ 무료 4종(영수증·세부내역서·KOH결과지·처방전) → '제증명' 아래 배치.
--   ④ 진료의뢰서 3,000원 → 그대로 유지(무변경) → 본 마이그 category_label 미변경(EXCLUDE).
--
-- ★ 배경: 대상 10종(제증명 6 + 무료 4)은 이미 Migration B(20260630140000, 2026-06-30 deployed)로
--   category_label='제증명' 귀속 완료. 본 마이그 = 그 membership의 **선언적 forward 재확인 + drift-repair 가드**.
--   라이브에서는 대체로 no-op(이미 '제증명'). category_label = 표시용 라벨(무 CHECK·무 FK·무 UNIQUE, nullable TEXT).
--
-- ★ 가드/원칙:
--   · surgical: 대상 service_code 10개만 정밀 지정(통짜 rollback SQL·전체 relabel 금지).
--   · 멱등: category_label IS DISTINCT FROM '제증명' 인 행만 SET(재실행 안전, drift만 보정).
--   · 미러 INSERT 없음(대상 행 이미 존재), '기본' 원복 UPDATE 없음, 진료의뢰서 무변경(EXCLUDE).
--   · forward-only: 과거 service_charges/payments(INSERT 시점 정수 스냅샷) 소급 mutate 0.
--   · D1 승계(RELABEL-RECONCILE): category_label은 표시 전용 속성 → 매출 롤업/팩트뷰 조인·필터 키 사용 금지.
--   · FE 그룹핑 노출(WARN-1)은 Services.tsx CATEGORY_LABEL_OPTIONS에 '제증명' 추가로 별도 처리(코드).
-- rollback: 20260706170000_foot_docform_jeungmyeong_category_membership_affirm.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── '제증명' 카테고리 membership 재확인 (제증명 6종 + 무료 4종 = 10종) ──────────────────
--  대상 service_code 10개만 정밀 지정. 멱등 가드(IS DISTINCT FROM '제증명')로 drift 행만 보정.
--  진료의뢰서('진료의뢰서') = AC4 무변경 → 목록에서 의도적 EXCLUDE (귀속은 Migration B 상태 그대로 유지).
UPDATE services
   SET category_label = '제증명'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN (
     -- 제증명 6종 (Migration B §3 relabel, 이름/가격 불변 — 이동만)
     'C5900002',           -- 진단서(국문) 20,000
     '진단서(영문)',        -- 30,000
     '진료소견서',          -- 소견서 국문 10,000 (canonical)
     '소견서(영문)',        -- 30,000
     '통원확인서',          -- 3,000
     '진료기록사본1',        -- 계단단가 canonical
     -- 무료 4종 (Migration B §1, 0원 ADDITIVE 등재)
     'cert_bill_receipt',  -- 진료비영수증 0
     'cert_bill_detail',   -- 진료비세부내역서 0
     'cert_koh_result',    -- KOH균검사결과지 0
     'cert_rx_standard'    -- 처방전(제증명) 0
   )
   AND category_label IS DISTINCT FROM '제증명';  -- 멱등: 이미 '제증명'이면 no-op(drift만 보정)

COMMIT;
