-- ROLLBACK — T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST) 교부번호 당일 발번 인프라
-- 20260718170000_foot_rx_issue_no_daily_counter.sql 역연산.
--
-- ⚠ FE 롤백 순서: 본 DB 롤백 전에 FE(issue_foot_rx_issue_no 호출 경로)를 이전 커밋으로 되돌린다.
--   FE 가 RPC 를 호출하는데 함수가 없으면 발번 실패 → 교부번호 공란/폴백. 단 buildIssueNo(seq=1 폴백)로
--   14자리(8+N) 유효값은 항상 보장되므로 약국 반려는 재발하지 않음(fail-safe). 그래도 FE 우선 롤백 권장.
--
-- 무손실: foot_rx_issue_counter = 발번 카운터(메타)만 — 처방기록/발행문서(form_submissions.field_data.issue_no)
--   원본 무접촉. rx_issue_seq 컬럼 DROP = 순번 권위 소스만 제거(교부번호 문자열은 field_data 에 이미 persist → 표시 무영향).
--   기존 발행분 교부번호(field_data.issue_no) 손실 0.
-- 멱등: DROP ... IF EXISTS.

BEGIN;

DROP FUNCTION IF EXISTS public.issue_foot_rx_issue_no(uuid, date, uuid);

ALTER TABLE public.form_submissions
  DROP COLUMN IF EXISTS rx_issue_seq;

DROP TABLE IF EXISTS public.foot_rx_issue_counter;

COMMIT;

-- 검증:
--   SELECT to_regclass('public.foot_rx_issue_counter');                                  -- NULL
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='form_submissions' AND column_name='rx_issue_seq';                -- 0행
--   SELECT proname FROM pg_proc WHERE proname='issue_foot_rx_issue_no';                  -- 0행
