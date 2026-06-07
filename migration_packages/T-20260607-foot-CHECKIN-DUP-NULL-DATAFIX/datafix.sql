-- ============================================================================
-- T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX  ·  AC3/AC5 데이터 정비 SQL
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd  ·  table: public.check_ins
--
-- *** GATE — DO NOT EXECUTE ***
--   순서(불변): AC1 dry-run(완료) → AC2 planner 판정(완료) → 본 AC3 package
--               → supervisor 단독 GO(AC4) → 실행(AC5). dev-foot 자동 실행 금지.
--   supervisor DB 게이트 통과 전 어떤 mutation 도 금지. 본 파일은 설계 산출물.
--
-- 근거:
--   · evidence/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.{md,json} (READ-ONLY dry-run)
--   · 티켓 AC2 판정(planner, 2026-06-07 23:42 KST)
--
-- AC2 확정 분류 (planner):
--   Tier 1  실 mutation 1건 : 김민경 중복 6425a5c8 → **논리 cancel(물리삭제 금지)**.
--   Tier 2  no-op           : NULL 고아 14건 전부 테스트패밀리 → 정비 불필요(손대지 않음).
--   Tier 3  범위 밖         : 동명 customer master 중복 → spinoff 티켓
--                             T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE (대표원장 확인).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — BACKUP (역연산 자료 확보). mutation 이전 반드시 실행.
--   영향 행 원본(특히 status='done')을 백업 테이블로 복제 → rollback.sql 에서 복원.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._datafix_bk_T20260607_checkin_dup
  (LIKE public.check_ins INCLUDING ALL);

INSERT INTO public._datafix_bk_T20260607_checkin_dup
SELECT * FROM public.check_ins
 WHERE id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48'
ON CONFLICT (id) DO NOTHING;
-- 기대: 1 row 백업 (원본 status='done' 보존).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 1 — 실명 운영자오류 중복 정비 (clear GO · 논리 cancel)
--   김민경 (customer_id=83ab4fe1-0bbc-4dfc-ab3b-f01378144707), KST 2026-06-02 'new' 2건.
--     KEEP : 207bf234-8851-4a38-8c56-c0191bea96b8 (최초 생성 04:57:56Z, 정본)
--     CXL  : 6425a5c8-8fb7-46d6-a762-93d9922eeb48 (06:12:48Z 중복, 차트·결제·서비스·패키지 전무)
--   방식: planner AC2 지시 — **물리 DELETE 금지, status='cancelled' 논리 취소(역연산 가능)**.
--   가드: 현재 status='done' AND cid·name 일치 AND 연결 전무일 때만(타행 보호).
--         medical_charts 는 check_in_id 없음 → (customer_id, visit_date=KST일)로 연결.
--         package 연결은 package_sessions.check_in_id (AC1 LINK_SELECT 동일 기준).
UPDATE public.check_ins ci
   SET status = 'cancelled'
 WHERE ci.id = '6425a5c8-8fb7-46d6-a762-93d9922eeb48'
   AND ci.customer_id = '83ab4fe1-0bbc-4dfc-ab3b-f01378144707'
   AND ci.customer_name = '김민경'
   AND ci.status = 'done'
   AND NOT EXISTS (SELECT 1 FROM public.payments         p  WHERE p.check_in_id  = ci.id)
   AND NOT EXISTS (SELECT 1 FROM public.package_sessions ps WHERE ps.check_in_id = ci.id)
   AND NOT EXISTS (SELECT 1 FROM public.check_in_services cs WHERE cs.check_in_id = ci.id)
   AND NOT EXISTS (
         SELECT 1 FROM public.medical_charts mc
          WHERE mc.customer_id = ci.customer_id
            AND mc.visit_date  = (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date
       );
-- 기대: 1 row UPDATE. (가드 불일치 시 0 row → 즉시 ROLLBACK 후 재검토)

-- 검증(커밋 전 확인 권장) — KST 방문일 2026-06-02, 취소분 제외 시 1건만 남아야:
--   SELECT id, status, created_at FROM check_ins
--    WHERE customer_id='83ab4fe1-0bbc-4dfc-ab3b-f01378144707'
--      AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date = DATE '2026-06-02'
--      AND visit_type='new' AND status <> 'cancelled';   -- 기대: 207bf234 단 1건.

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 2 — NULL customer_id 고아 14건 : **NO-OP (정비 대상 아님)**
--   AC2 판정: 14건 전부 테스트/더미(명시더미 7 + 김N번 테스트패밀리·길동이 7).
--   티켓 §비범위("테스트/더미명 레코드 손대지 않음") 적용 → 실명 실데이터 0건.
--   서비스 연결 1건(6d1350e6 김이번)도 동일 테스트패밀리 → 소크 중 자연정리.
--   → 본 티켓에서 어떤 UPDATE/DELETE 도 수행하지 않음. SQL 의도적 미작성.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- Tier 3 — 동명 customer master 중복 : **범위 밖 (spinoff 분리)**
--   김규리(7fa5dff1↔7cef3be8) / 김민경(83ab4fe1↔김구번 오연결 10f10231) / 김승현(fcdcd44f↔53661ce0).
--   동일 customer_id 패턴 아님 = customer master 동명이인 중복.
--   → T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE 에서 dry-run 트리아지, 병합은 대표원장 확인 후.
--   본 datafix 에서 자동 실행 금지.
-- ============================================================================
