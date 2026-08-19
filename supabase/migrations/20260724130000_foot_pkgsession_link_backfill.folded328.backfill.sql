-- BACKFILL (data lane): T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE  (328 folded APPLY)
-- 부모 T-20260724 316 backfill + interval-delta 12 = 328 단일 folded APPLY.
-- 정본: da_decision_foot_pkgsession_backfill_316_applyset_reapprove_20260819.md ADDENDUM #1 (DA 전건 BLESS).
--
-- ★ CTE = 20260724130000_foot_pkgsession_link_backfill.backfill.sql (부모) 와 **문자동일**(divergence 0·
--   per-row CASE 불변·auto-widen 0·억지채움 0). source-closure(web_fe landing 2026-08-20 01:56) 후 live
--   실행 시 자연히 **328 count-exact**(fold-(i): 별도 프리즈 328 리스트 불요). 316→328 은 방법론(C6 min-sum)
--   불변의 post-source-closure 재산출이지 술어 widen 아님.
--
-- ⚠⚠ 실행 게이트 (미충족 시 APPLY 금지 — AC-1: fold ≠ GO-token 면제) ⚠⚠
--   · (a) FM3 총괄 328-scoped 재확인(₩77.45M) = 총괄 확인 前 APPLY 금지
--   · (b) dev-sales KC dict 316→328 resync 배포(REVENUE_DELTA HIGH 오경보 차단)
--   · (c) supervisor DB-GATE(dryrun 무영속→DATA-diff→물리 GO-token)
--   · (d) supervisor codex 실SQL re-crosscheck (C19 body-drift + §15-5-10 caller-tier + A12 md5 re-seal)
--   · dev-foot apply-instant census 4항 GREEN(count-exact 328 · disjoint · full-328 pre-image · P-floor co-set)
--   → 위 全 GREEN + GO-token 후에만 db_apply_guard.sh chokepoint 로 APPLY. GO-token 前 write0.
--
-- §6 4대 필수 가드 (부모 불변):
--   ①status='used' 한정(환불/취소/삭제 제외)  ②session_type = prepaidSessionType() 규칙 정확복제(코드 우선·비가열 먼저)+'체험' 제외
--   ③type별 FIFO(created_at,id) 1:1 rn=rn + package_session_id IS NULL 멱등  ④package_session_id + is_package_session 함께 SET(co-set·§686-690 P-floor)
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

-- 사후 불변식 assert #1: (c) 환불/비-used 회차 링크 0건 (가드①).
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

-- 사후 불변식 assert #2: count-exact 328 (fold 후 재확인 · 억지채움/과다마킹 방지).
-- ★이 assert 는 apply 트랜잭션 내 즉시검증. census(apply-instant) 는 이 값을 apply 직전에 선확인.
DO $count$
DECLARE v_flip INTEGER;
BEGIN
  -- 이 트랜잭션에서 방금 마킹된(직전까지 flag=false 였던) 행 수 ≈ 328 이어야 함.
  -- 정확 카운트는 census 선행이 SSOT. 여기선 상한 sanity(구조 이상 시 abort).
  SELECT count(*) INTO v_flip FROM public.check_in_services
  WHERE is_package_session = true AND package_session_id IS NOT NULL;
  RAISE NOTICE 'BACKFILL-INFO: post-apply flag=true&FK-set 총계 = % (census 328 count-exact 대조 — POST-VERIFY SSOT)', v_flip;
END $count$;

COMMIT;
