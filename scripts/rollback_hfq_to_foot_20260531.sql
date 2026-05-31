-- ============================================================================
-- ROLLBACK — T-20260531-data-JONGNOFOOT-MIGRATE-HFQ-TO-FOOT (AC-5)
-- ============================================================================
-- 대상 DB : rxlomoozakkjesdqjtvd (foot) — target 만 원복. HFQ 원본은 무변경(AC-6).
-- 식별자  : batch tag  memo LIKE '%[HFQ2FOOT-20260531]%'
-- 순서    : check_ins(자식) → customers(부모)  (FK 안전)
-- ⚠️ 설계 산출물 — 미실행. 이관 실행 후 문제 발생 시에만 사용.
-- ============================================================================

BEGIN;

-- 1) dry-run: 원복 대상 건수 확인
SELECT 'check_ins' AS tbl, count(*) FROM check_ins
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND notes LIKE '%[HFQ2FOOT-20260531]%'
UNION ALL
SELECT 'customers', count(*) FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND memo LIKE '%[HFQ2FOOT-20260531]%';

-- 2) 삭제 (자식 먼저)
DELETE FROM check_ins
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND notes LIKE '%[HFQ2FOOT-20260531]%';

DELETE FROM customers
  WHERE clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
    AND memo LIKE '%[HFQ2FOOT-20260531]%';

-- 확인 후 의도대로면 COMMIT 으로 교체.
ROLLBACK;
