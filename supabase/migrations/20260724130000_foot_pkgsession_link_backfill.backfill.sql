-- BACKFILL (data lane): T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY  (J4)
-- 목적: 과거 선수금 소비행(check_in_services)에 package_session_id + is_package_session 를
--       소급 링크·마킹(F-4790 과거 오표기 해소). widened RPC(배포됨)는 신규만 마킹하므로 과거는 소급 필요.
--
-- ⚠⚠ 실행 게이트 (미충족 시 APPLY 금지 — 핑퐁 재오픈 방지) ⚠⚠
--   · FM1(prod RPC 본문 실측)  = GREEN (verify_pkgsession_rpc_prod.mjs GO, 2026-07-24)
--   · FM4(테스트 버그승인 제거) = GREEN (버그승인 spec 0건)
--   · FM6(version.json 실커밋)  = GREEN (live commit == origin/main HEAD)
--   · FM3(매출이동분 사전통지)  = CLEARED (planner 09:46)
--   · FM2(신규경로 실효 표본 T3)= ★PENDING★ — 배포후 선수금차감 수납 1건 실발행→마킹 실측 필요.
--   · DA re-crosscheck (본 SQL) + 총괄 prod-write 승인 + supervisor DB-GATE(DATA-diff) 선행.
--   → 위 全 GREEN 전까지 이 파일은 DRAFT. supervisor 가 dryrun→data-diff→GO 후에만 APPLY.
--
-- §6 4대 필수 가드:
--   ①status='used' 한정(환불/취소/삭제 제외 — 신규 마킹 동작·총괄 2026-07-14 DA PIN §3 미러)
--   ②session_type = prepaidSessionType() 규칙 정확복제(코드 우선·비가열 먼저) + '체험' 제외
--   ③type별 FIFO(created_at,id) 1:1 rn=rn 페어링 + package_session_id IS NULL 멱등
--   ④package_session_id + is_package_session 를 함께 SET (C3 재저장 보존 내구성)
BEGIN;

WITH ps AS (
  -- 가드①: 'used' 세션만. type별 FIFO 번호(session_number→created_at).
  SELECT p.id AS session_id, p.check_in_id, p.session_type,
         row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                            ORDER BY p.session_number ASC, p.created_at ASC) AS rn
  FROM public.package_sessions p
  WHERE p.status = 'used' AND p.check_in_id IS NOT NULL
),
cis_typed AS (
  -- 가드②: service_id→services→prepaidSessionType() 규칙 SQL 재현(코드 우선, 비가열을 가열보다 먼저).
  --         '체험'(isTrialService) 제외 → 신규 경로(PaymentMiniWindow settle) 정합.
  --         (CASE 를 단일 정의 → PARTITION BY 재기입 divergence 차단.)
  SELECT c.id AS cis_id, c.check_in_id, c.created_at,
         CASE
           WHEN s.service_code = 'SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
           WHEN s.service_code = 'SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
           WHEN s.service_code = 'BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
           WHEN (COALESCE(s.category_label,'') || ' ' || COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
           ELSE NULL
         END AS session_type
  FROM public.check_in_services c
  JOIN public.services s ON s.id = c.service_id
  WHERE c.package_session_id IS NULL                 -- 가드③: 멱등(이미 링크행 제외)
    AND s.name NOT LIKE '%체험%'                      -- 가드②: 체험 제외
),
cis AS (
  -- 가드③: CIS 측 rn = 신규 RPC 와 동일 (PARTITION BY check_in_id, session_type ORDER BY created_at,id).
  SELECT cis_id, check_in_id, session_type,
         row_number() OVER (PARTITION BY check_in_id, session_type
                            ORDER BY created_at ASC, cis_id ASC) AS rn
  FROM cis_typed
  WHERE session_type IS NOT NULL                      -- 매핑 실패(4종 밖)행 미마킹
)
UPDATE public.check_in_services t
   SET package_session_id = ps.session_id,            -- 가드④: FK 링크
       is_package_session = true                      -- 가드④: ⑨ 실효 스위치 (함께 SET)
  FROM cis
  JOIN ps
    ON ps.check_in_id  = cis.check_in_id
   AND ps.session_type = cis.session_type
   AND ps.rn           = cis.rn                        -- 가드③: 1:1 FIFO 페어링
 WHERE t.id = cis.cis_id;

-- 사후 불변식 assert: (c) 환불/비-used 회차 링크 0건 (WHERE status='used' 로 구조 보장이나 명시 검증).
DO $assert$
DECLARE v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.check_in_services c
  JOIN public.package_sessions p ON p.id = c.package_session_id
  WHERE p.status <> 'used';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'BACKFILL-ABORT: 비-used(환불/취소/삭제) 회차 링크 % 건 발생 — 가드① 위반', v_bad;
  END IF;
  RAISE NOTICE 'BACKFILL-OK: 비-used 링크 0건 (가드① 통과)';
END $assert$;

COMMIT;
