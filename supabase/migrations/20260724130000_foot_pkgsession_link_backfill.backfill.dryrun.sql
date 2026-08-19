-- DRY-RUN (No-Persistence): T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY  (J4)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · apply(.backfill.sql) 의 txn-control(COMMIT) STRIP → 단일 BEGIN..ROLLBACK 로 감싸 무영속.
--   · 동일 UPDATE 를 실행하되 ROLLBACK → 마킹 예정 행수 / 매칭 정합 / 환불 0건 을 사전 검증.
--   · 사후 무영속(post-probe): 별 트랜잭션에서 linked=0 재확인은 supervisor 가 수행.
-- ⚠ supervisor 실행 절차: 아래 dryrun → 3항목 GREEN 확인 → data-diff 대조 → GO 후 .backfill.sql APPLY.
--
-- 3항목 GREEN 기준 (2026-07-24 read-only 실측 baseline, prod=rxlomoozakkjesdqjtvd):
--   (a) 마킹 예정 행수(to_mark)         = 42
--   (b) used(4종) 81 / matched 42       — ★gap 39: DA reconcile 필요(§FOLLOWUP anomaly-1)
--   (c) 환불/비-used 회차 매칭          = 0  ✓
--   (참고) 기존 flag_true & FK NULL     = 49 (pre-FK 마킹 — anomaly-2)
--
-- ★★ J4 APPLY 재시퀀싱 재실측 (2026-08-19 13:20 KST, read-only mutation 0, prod=rxlomoozakkjesdqjtvd) ★★
--   증적 = scripts/T-20260724-foot-PKGSESSION-BACKFILL_resequence_prep_20260819.mjs
--        + db-gate/T-20260724-foot-PKGSESSION_remeasure_20260819.json
--   check_in_services 성장(936→4183행, 07-24→08-19)으로 count-exact set 재산출:
--   (a) 마킹 예정 행수(to_mark)         = 316   (07-24=42 → C6 min(unpaired·mappable CIS, active used) 재적용, 억지채움 0)
--        · C6 min-sum per-(check_in,type) 합산 = 316 == a_to_mark → 정합 PASS (81쪽 억지채움 아님)
--        · 타입분포: unheated_laser 273 / podologue 27 / heated_laser 16
--   (b) used(4종) 535 / matched 316     — gap 219 = A2(35) + B1_LEAKY(184) + X(0). used == matched+gap 정합 PASS
--   (c) 환불/비-used 회차 매칭          = 0  ✓ (사후 assert 유지)
--   (참고) G-B 스냅샷 316행 = prev_flag 전건 false / prev_psid 전건 NULL / target_ps 이미링크 0 (double-link 위험 0)
--   (참고) 잔존 legacy flag_true&FK-null = 30 (전건 4-type 매핑O, backfill matched=0 → DA A2 Pop-C EXCLUDE·flag=true 유지=⑨ 정상)
--   ⚠ 이상수치(스코프 42→316·7.5x, flip 매출이동 ₩4.3M→₩74.63M, B1_LEAKY 16→184, 316중 303 post-fix created)
--     = FM3 총괄 재통지 + DA '42 count-exact' verdict 재확인 트리거. APPLY 前 planner/DA/총괄 재확인 필요(dev-foot FOLLOWUP 발행).
BEGIN;

WITH ps AS (
  SELECT p.id AS session_id, p.check_in_id, p.session_type,
         row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                            ORDER BY p.session_number ASC, p.created_at ASC) AS rn
  FROM public.package_sessions p
  WHERE p.status = 'used' AND p.check_in_id IS NOT NULL
),
cis_typed AS (
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
  WHERE c.package_session_id IS NULL
    AND s.name NOT LIKE '%체험%'
),
cis AS (
  SELECT cis_id, check_in_id, session_type,
         row_number() OVER (PARTITION BY check_in_id, session_type
                            ORDER BY created_at ASC, cis_id ASC) AS rn
  FROM cis_typed
  WHERE session_type IS NOT NULL
),
matched AS (
  SELECT cis.cis_id, ps.session_id, cis.session_type
  FROM cis JOIN ps
    ON ps.check_in_id = cis.check_in_id AND ps.session_type = cis.session_type AND ps.rn = cis.rn
)
-- (a)(b)(c) 3항목 사전 리포트
SELECT
  (SELECT count(*) FROM matched)                                                         AS a_to_mark,
  (SELECT count(*) FROM ps WHERE session_type IN ('heated_laser','unheated_laser','iv','podologue')) AS b_used_4type,
  (SELECT count(*) FROM cis)                                                             AS b_unmarked_typed_cis,
  (SELECT count(*) FROM matched m JOIN public.package_sessions p ON p.id=m.session_id
     WHERE p.status <> 'used')                                                           AS c_nonused_matched;

-- 실제 UPDATE 를 무영속 실행(ROLLBACK 예정) — rows-affected 확인용.
WITH ps AS (
  SELECT p.id AS session_id, p.check_in_id, p.session_type,
         row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                            ORDER BY p.session_number ASC, p.created_at ASC) AS rn
  FROM public.package_sessions p
  WHERE p.status = 'used' AND p.check_in_id IS NOT NULL
),
cis_typed AS (
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
  WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'
),
cis AS (
  SELECT cis_id, check_in_id, session_type,
         row_number() OVER (PARTITION BY check_in_id, session_type
                            ORDER BY created_at ASC, cis_id ASC) AS rn
  FROM cis_typed WHERE session_type IS NOT NULL
)
UPDATE public.check_in_services t
   SET package_session_id = ps.session_id, is_package_session = true
  FROM cis JOIN ps
    ON ps.check_in_id = cis.check_in_id AND ps.session_type = cis.session_type AND ps.rn = cis.rn
 WHERE t.id = cis.cis_id;

ROLLBACK;
