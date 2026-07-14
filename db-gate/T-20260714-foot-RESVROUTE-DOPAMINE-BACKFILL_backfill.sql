-- ═══════════════════════════════════════════════════════════════════════════════
-- T-20260714-foot-RESVROUTE-DOPAMINE-BACKFILL — customers.visit_route historical backfill
--   TM/도파민 '최초접점' 고객의 과거 NULL visit_route 소급 seed (forward EF b128c2ee 이전 생성분)
--   DB: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ★★ GATE_HOLD — PROD 실행 금지 (2026-07-14 16:02 기준 미충족 게이트) ★★
--   (P1) 부모 forward EF(T-20260714-foot-RESVROUTE-DOPAMINE-SEED, b128c2ee) field-soak confirm
--        = 2026-07-15 15:04 이후에만 착수. 라이브 EF와 번들 금지 (ticket 실행전제 #1).
--   (P5) supervisor DDL/DML-diff 게이트 통과 전 실행 금지.
--   dev-foot 는 본 SQL을 *준비*만 함(SOP 선행). 실행 = supervisor(diff + rowcount-verify 후).
--
-- ── SOP 준거: Cross-CRM Data-Correction 백필 SOP v1.4 ──────────────────────────
--   §0  필드분류 = mutable(auto-derived default + 스태프 수동변경 가능) → §1~§2 발동.
--       단, 본 건은 IS NULL 가드 only-fill 이므로 정당 수동값(non-NULL) 을 물리적으로 clobber 불가
--       → 역오염 위험 = 구조적으로 0 (mutable 백필 중 가장 안전한 fill-on-NULL 클래스).
--   §0-2 소스차단 선행: forward EF(b128c2ee)가 신규분 seed 중 = 소스 닫힘. 닫힘 증거 =
--       EF live 이후 dopamine-최초접점 & visit_route NULL 신규 row 0건(STEP 0-C 포렌식, field-soak).
--   §1  단일 count UPDATE 금지 — count 는 필요조건일 뿐. 아래 §2 지문 교집합으로 대상 좁힘.
--   §2  버그경로 지문: (visit_route IS NULL) ∩ (최초예약.source_system='dopamine')
--                     ∩ (버그윈도우: 최초예약.created_at ≤ 소스닫힘시각, tz-aware)
--                     ∩ (override 없음: IS NULL 이면 정의상 수동지정 없음).
--   §2  ⚠ 오분류 방지(ticket #2): '아무 dopamine 예약 1건' 이 아니라 '고객의 生成(최초) 예약'이
--       dopamine 인 행만. 오가닉 최초접점 + 이후 dopamine 재예약 고객은 TM 오라벨 금지.
--   §2-S select 컬럼 실존 검증 완료: customers.visit_route / reservations.{customer_id,source_system,
--       visit_route,created_at,id} 모두 prod 스키마 실존(마이그 20260610110000 등). 파생동기필드 없음
--       (visit_route 는 단일 소유, reservations.visit_route 는 별도 축 — 미접촉).
--   §3  안전 4종: freeze by id(STEP 1 스냅샷=id VALUES 확정) / 판정근거 스냅샷(STEP 1) /
--       멱등 WHERE(visit_route IS NULL, STEP 3) / abort 임계(STEP 2).
--   §4  DDL 0(순수 UPDATE) → schema_migrations 무접점. 스냅샷은 _backup_* 네임스페이스(보존 후 drop).
--   §4  PHI 위생: 본 .sql 은 리터럴 환자식별자 0건(로직 only). freeze id 집합은 실행시 DB _backup
--       테이블(off-git)에만 영속. 운영 dump/리스트는 git-tracked 파일에 평문 금지(phi_redaction §1).
--
-- ── 불변식 (ticket 실행전제 + DA GO 조건) ──────────────────────────────────────
--   G0(no-clobber): visit_route IS NULL 인 행만 변경. non-NULL(스태프 수동값 포함) 순소실 0.
--   G1(단일컬럼): visit_route 만 착지. lead_source/customer_memo/source_system 등 타 컬럼 미접촉.
--   G3(split 불변): reservations.source_system 무접촉 → 매출 오가닉/광고 split 불변.
--   가역: STEP 1 스냅샷 근거로 RB 섹션이 건드린 행만 NULL 원복.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ⚙ 실행시 확정 파라미터 (supervisor / dev-foot 가 실행 직전 치환)
--   :source_closed_at = forward EF b128c2ee 소스닫힘 확정 시각(=field-soak confirm).
--                       윈도우 상한(§0-2). tz-aware timestamptz 로 반드시 '+09' 명시.
--                       현재 플랜 기본값 = '2026-07-15 15:04:00+09' (field-soak confirm 예정시각).
--   :expected_max     = STEP 2 abort 임계 = STEP 0-A dry-run count.
-- ══════════════════════════════════════════════════════════════════════════════
\set source_closed_at '2026-07-15 15:04:00+09'


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-A: dry-run count (§1 필요조건 — supervisor 검증 기준값 = expected_max)
--   최종 대상 지문 전체를 임베드한 count(§3-4: WHERE 에 §2 지문 전체, count 단독 금지).
-- ═══════════════════════════════════════════════════════════════════════════════
WITH first_rsv AS (
  -- 각 고객의 '생성(최초)' 예약 1건 (결정적 tiebreak: created_at ASC, id ASC)
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id,
         r.source_system   AS first_source_system,
         r.visit_route     AS first_visit_route,
         r.created_at      AS first_rsv_created_at
  FROM reservations r
  WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT count(*) AS target_rows
FROM customers c
JOIN first_rsv fr ON fr.customer_id = c.id
WHERE c.visit_route IS NULL                                        -- G0 no-clobber / §3-3 멱등
  AND fr.first_source_system = 'dopamine'                          -- §2 최초접점 = 도파민
  AND fr.first_visit_route IN ('TM','워크인','인바운드','지인소개')  -- EF visitRouteLanded 미러(enum 검증)
  AND fr.first_rsv_created_at <= :'source_closed_at'::timestamptz; -- §0-2 버그윈도우 상한(tz-aware)


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-B: 오분류 방지 반증 (§2 ticket #2) — '오가닉 최초접점 + 이후 dopamine' 고객은 대상 제외 확인.
--   이 count = visit_route NULL & (dopamine 예약 1건이상 보유) 이지만 & (최초접점≠dopamine) 인 고객 수.
--   STEP 0-A + 이 값 = "dopamine 예약 보유 & visit_route NULL" 전체. 이 값만큼이 '오라벨 방지분'.
-- ═══════════════════════════════════════════════════════════════════════════════
WITH first_rsv AS (
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id, r.source_system AS first_source_system
  FROM reservations r
  WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT count(*) AS organic_firsttouch_excluded
FROM customers c
JOIN first_rsv fr ON fr.customer_id = c.id
WHERE c.visit_route IS NULL
  AND fr.first_source_system <> 'dopamine'                         -- 최초접점 오가닉
  AND EXISTS (SELECT 1 FROM reservations r2                         -- 그러나 dopamine 예약은 존재
              WHERE r2.customer_id = c.id AND r2.source_system = 'dopamine');


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-C: 소스닫힘 포렌식 (§0-2 착수 선결 게이트) — MUST BE 0.
--   forward EF(b128c2ee) live 이후에 생성된 'dopamine 최초접점 & visit_route NULL' 신규 row 수.
--   > 0 이면 소스 미차단(EF 무영속 or 미가드 write 벡터) → 백필 BLOCK, planner 재-CONSULT.
--   :source_closed_at 을 하한으로(그 이후 신규분).
-- ═══════════════════════════════════════════════════════════════════════════════
WITH first_rsv AS (
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id, r.source_system AS first_source_system, r.first_rsv_created_at
  FROM (SELECT customer_id, source_system, created_at AS first_rsv_created_at, id
        FROM reservations WHERE customer_id IS NOT NULL) r
  ORDER BY r.customer_id, r.first_rsv_created_at ASC, r.id ASC
)
SELECT count(*) AS new_contam_after_source_closed_MUST_BE_0
FROM customers c
JOIN first_rsv fr ON fr.customer_id = c.id
WHERE c.visit_route IS NULL
  AND fr.first_source_system = 'dopamine'
  AND fr.first_rsv_created_at > :'source_closed_at'::timestamptz;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 1: ★ FREEZE + 판정근거 스냅샷 (§3-1 freeze by id VALUES / §3-2 근거 / §4 _backup 네임스페이스)
--   UPDATE 가 건드릴 정확한 id 집합 + 변경 전 값(정의상 NULL) + 판정에 쓴 신호 전체를 영속.
--   이 테이블이 곧 freeze 집합 — STEP 3 UPDATE 는 조건 재-SELECT 가 아니라 이 id 집합에만 JOIN.
--   멱등: DROP 후 재생성. off-git(DB only). PHI = customer_id(UUID)만, phone/name/RRN 미포함.
-- ══════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _backup_t20260714_resvroute_dopamine;
CREATE TABLE _backup_t20260714_resvroute_dopamine AS
WITH first_rsv AS (
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id,
         r.source_system AS first_source_system,
         r.visit_route   AS first_visit_route,
         r.created_at    AS first_rsv_created_at,
         r.id            AS first_rsv_id
  FROM reservations r
  WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT
  c.id                       AS customer_id,        -- freeze PK
  c.visit_route              AS old_visit_route,     -- 변경 전 값 (정의상 NULL)
  fr.first_visit_route       AS proposed_visit_route,-- 착지 예정값 (EF visitRouteLanded 미러)
  fr.first_source_system     AS first_rsv_source,    -- 판정근거: 최초접점
  fr.first_visit_route       AS first_rsv_visit_route,
  fr.first_rsv_created_at     AS first_rsv_created_at,-- 판정근거: 버그윈도우
  fr.first_rsv_id            AS first_rsv_id,
  c.created_at               AS customer_created_at,  -- 판정근거: override 판정
  c.updated_at               AS customer_updated_at
FROM customers c
JOIN first_rsv fr ON fr.customer_id = c.id
WHERE c.visit_route IS NULL
  AND fr.first_source_system = 'dopamine'
  AND fr.first_visit_route IN ('TM','워크인','인바운드','지인소개')
  AND fr.first_rsv_created_at <= :'source_closed_at'::timestamptz;

-- freeze 집합 확인 (STEP 0-A target_rows 와 일치해야 함)
SELECT count(*) AS frozen_rows FROM _backup_t20260714_resvroute_dopamine;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2: abort 임계 assert (§3-4) — freeze 집합 ≠ dry-run 기대치면 중단.
--   frozen_rows 가 STEP 0-A(:expected_max) 를 초과하면 잘못된 WHERE → 즉시 ROLLBACK.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_frozen  int;
BEGIN
  SELECT count(*) INTO v_frozen FROM _backup_t20260714_resvroute_dopamine;
  -- assert 1: proposed 값은 반드시 enum 4값 내 (EF 미러) — 비enum 발견 시 abort
  IF EXISTS (SELECT 1 FROM _backup_t20260714_resvroute_dopamine
             WHERE proposed_visit_route NOT IN ('TM','워크인','인바운드','지인소개')) THEN
    RAISE EXCEPTION 'ABORT: proposed_visit_route 비-enum 값 존재 (EF 미러 위반)';
  END IF;
  -- assert 2: old 값은 반드시 NULL (no-clobber 대상만)
  IF EXISTS (SELECT 1 FROM _backup_t20260714_resvroute_dopamine
             WHERE old_visit_route IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: old_visit_route non-NULL 혼입 (no-clobber 위반)';
  END IF;
  RAISE NOTICE 'STEP2 PASS: frozen_rows=% (enum·no-clobber 불변식 OK). expected_max 대조는 supervisor 수동 확인.', v_frozen;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 3: ★ 백필 UPDATE (freeze by id JOIN + 멱등 IS NULL 가드)
--   조건 재-SELECT 금지 — STEP 1 freeze 집합(_backup)에만 JOIN(§3-1 drift 차단).
--   G0/멱등: AND customers.visit_route IS NULL → 이미 값 있으면 no-op(재실행 안전).
--   G1: SET 절 = visit_route 단일 컬럼.  G3: reservations 무접촉.
-- ══════════════════════════════════════════════════════════════════════════════
UPDATE customers c
SET visit_route = b.proposed_visit_route
FROM _backup_t20260714_resvroute_dopamine b
WHERE c.id = b.customer_id
  AND c.visit_route IS NULL;                 -- 멱등·no-clobber (freeze 후 drift 로 값 생겼으면 skip)


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 4: 사후 검증 (rowcount assert)
-- ══════════════════════════════════════════════════════════════════════════════
-- 4-a: freeze 집합 중 실제 착지된 행 수 (= frozen_rows, drift 없으면 일치)
SELECT count(*) AS applied_rows
FROM customers c
JOIN _backup_t20260714_resvroute_dopamine b ON b.customer_id = c.id
WHERE c.visit_route = b.proposed_visit_route;

-- 4-b: no-clobber 사후 입증 — freeze 밖 non-NULL 스태프값은 불변(전수 sanity: 표본 없음이 정상)
--   freeze 집합의 customer 중 proposed 와 다른 값이 들어간 행 = 0 이어야 함(drift/오염 탐지).
SELECT count(*) AS unexpected_value_rows_MUST_BE_0
FROM customers c
JOIN _backup_t20260714_resvroute_dopamine b ON b.customer_id = c.id
WHERE c.visit_route IS NOT NULL
  AND c.visit_route <> b.proposed_visit_route;


-- ══════════════════════════════════════════════════════════════════════════════
-- RB: ★ ROLLBACK (post-COMMIT 복원) — STEP 1 스냅샷 근거, 건드린 행만 NULL 원복.
--   가드: visit_route = proposed_visit_route 인 행만 되돌림 → 백필 후 스태프가 다시 손댄 값은 미터치.
-- ══════════════════════════════════════════════════════════════════════════════
-- UPDATE customers c
-- SET visit_route = b.old_visit_route          -- 정의상 NULL
-- FROM _backup_t20260714_resvroute_dopamine b
-- WHERE c.id = b.customer_id
--   AND c.visit_route = b.proposed_visit_route; -- 백필값 그대로인 행만 원복(사후 수동변경 보존)
--
-- 롤백 검증:
-- SELECT count(*) AS reverted_still_backfilled_MUST_BE_0
-- FROM customers c JOIN _backup_t20260714_resvroute_dopamine b ON b.customer_id = c.id
-- WHERE c.visit_route = b.proposed_visit_route AND b.old_visit_route IS NULL;

-- 스냅샷 보존(retention) 후 정리(선택): DROP TABLE _backup_t20260714_resvroute_dopamine;
