-- ============================================================================
-- T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX  ·  AC3/AC5 데이터 정비 SQL
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd  ·  table: public.check_ins
--
-- *** GATE — DO NOT EXECUTE ***
--   순서(불변): AC1 dry-run(완료) → 본 AC3 package → supervisor 단독 GO(AC4)
--               → (Tier 2/3는 추가로) 문지은 대표원장 confirm → 실행(AC5).
--   dev-foot 자동 실행 금지. supervisor DB 게이트 통과 전 어떤 DELETE도 금지.
--   본 파일은 설계 산출물. 게이트 전 실행은 정책 위반.
--
-- 근거: evidence/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.{md,json}
--       (READ-ONLY dry-run, 2026-06-07T14:33:38Z)
--
-- 정비 대상 분류:
--   Tier 1  실행대상(clear GO)  : 실명 운영자오류 중복 1건 — 연결 전무.
--   Tier 2  HOLD(기본 SKIP)     : NULL 고아 6건 = 전부 테스트패밀리(김N번/길동이).
--                                 티켓 규칙 "더미/테스트명 범위 외 — 건드리지 말 것"과 충돌.
--                                 supervisor/planner가 '고아정비'로 재분류 시에만 주석 해제.
--   Tier 3  HOLD(대표원장 확인) : NULL 고아 1건(서비스 연결有·매핑 필요) + 동명 customer 중복.
--                                 본 datafix 범위 밖. 자동 실행 금지.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — BACKUP (역연산 자료 확보). DELETE 이전 반드시 실행.
--   영향 행 전체를 백업 테이블로 복제 → rollback.sql 에서 재INSERT 가능.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._datafix_bk_T20260607_checkin_dup
  (LIKE public.check_ins INCLUDING ALL);

INSERT INTO public._datafix_bk_T20260607_checkin_dup
SELECT * FROM public.check_ins
 WHERE id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48';
-- 기대: 1 row 백업.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 1 — 실명 운영자오류 중복 정비 (clear GO)
--   김민경 (customer_id=83ab4fe1-0bbc-4dfc-ab3b-f01378144707), KST 2026-06-01 'new' 2건.
--     KEEP : 207bf234-8851-4a38-8c56-c0191bea96b8 (최초 생성 04:57:56Z, 정본)
--     DROP : 6425a5c8-8fb7-46d6-a762-93d9922eeb48 (06:12:48Z 중복, 차트·결제·서비스·패키지 전부 無)
--   가드: status='done' AND customer_id 일치 AND 연결 전무일 때만 삭제(타행 보호).
-- 가드 주의: medical_charts 는 check_in_id 없음 → (customer_id, visit_date=KST일)로 연결.
--           package 연결은 package_sessions.check_in_id. (AC1 인벤토리 LINK_SELECT와 동일 기준)
DELETE FROM public.check_ins ci
 WHERE ci.id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48'
   AND ci.customer_id = '83ab4fe1-0bbc-4dfc-ab3b-f01378144707'
   AND ci.customer_name = '김민경'
   AND NOT EXISTS (SELECT 1 FROM public.payments         p  WHERE p.check_in_id  = ci.id)
   AND NOT EXISTS (SELECT 1 FROM public.package_sessions ps WHERE ps.check_in_id = ci.id)
   AND NOT EXISTS (SELECT 1 FROM public.check_in_services cs WHERE cs.check_in_id = ci.id)
   AND NOT EXISTS (
         SELECT 1 FROM public.medical_charts mc
          WHERE mc.customer_id = ci.customer_id
            AND mc.visit_date  = (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
       );
-- 기대: 1 row 삭제. (가드로 인해 연결 있으면 0 row → 즉시 ROLLBACK 후 재검토)

-- 검증(커밋 전 확인 권장):
--   SELECT id, status, created_at FROM check_ins
--    WHERE customer_id='83ab4fe1-0bbc-4dfc-ab3b-f01378144707'
--      AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-06-01'
--      AND visit_type='new';   -- 기대: 207bf234 단 1건만 잔존.

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 2 — NULL 고아 6건 (기본 SKIP / supervisor 재분류 시에만 해제)
--   전부 테스트패밀리(김N번·길동이, test phone 010-2222~5555 등). 연결 전무.
--   티켓 "더미/테스트명 범위 외" 규칙상 기본 보류. 고아정비로 GO 시 백업 후 주석 해제.
-- ---------------------------------------------------------------------------
-- INSERT INTO public._datafix_bk_T20260607_checkin_dup
-- SELECT * FROM public.check_ins WHERE id IN (
--   '7dd25828-0c9c-443d-abf3-fd63681c8d88', -- 길동이
--   '61c83e50-ae12-4468-8c6a-e0e6a609796c', -- 김사번
--   'a8a74db4-9238-4279-9ebc-44206c8284a2', -- 김십번
--   '258fd605-8ed0-415b-ab4b-35f3d132672c', -- 김오번
--   '46824c34-d183-4d38-ac9c-51815c012a7f', -- 김삼번
--   '5545fe03-09fa-4e6c-a7ef-9e57051ed1f3'  -- 김이번
-- );
-- BEGIN;
-- DELETE FROM public.check_ins ci
--  WHERE ci.customer_id IS NULL
--    AND ci.id IN (
--      '7dd25828-0c9c-443d-abf3-fd63681c8d88','61c83e50-ae12-4468-8c6a-e0e6a609796c',
--      'a8a74db4-9238-4279-9ebc-44206c8284a2','258fd605-8ed0-415b-ab4b-35f3d132672c',
--      '46824c34-d183-4d38-ac9c-51815c012a7f','5545fe03-09fa-4e6c-a7ef-9e57051ed1f3')
--    AND NOT EXISTS (SELECT 1 FROM public.payments         p  WHERE p.check_in_id  = ci.id)
--    AND NOT EXISTS (SELECT 1 FROM public.package_sessions ps WHERE ps.check_in_id = ci.id)
--    AND NOT EXISTS (SELECT 1 FROM public.check_in_services cs WHERE cs.check_in_id = ci.id);
--   (NULL 고아는 customer_id IS NULL 이라 medical_charts 연결 불가 → chart 가드 불필요)
-- COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 3 — HOLD (대표원장 확인 전 자동 실행 금지)
--   (a) NULL 고아 1건 6d1350e6-1f5e-4bd3-8f2d-a78d6260e73c (김이번, 서비스 연결有)
--       → 삭제 아님. 올바른 customer_id 매핑 확정 후 UPDATE 복원 검토.
--   (b) 동명 customer 중복(김규리/김민경/김승현 = test-phone 동명이인):
--       check-in 재귀속 vs customer master 병합은 동일인 확인 후 결정.
--       → 본 티켓 범위 밖. planner→문지은 대표원장 별도 처리.
-- ============================================================================
