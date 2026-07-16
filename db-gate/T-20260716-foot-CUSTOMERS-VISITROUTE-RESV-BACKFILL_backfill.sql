-- ═══════════════════════════════════════════════════════════════════════════════
-- T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL
--   기존 예약 잔존건 → customers.visit_route(2번차트 방문경로) 일괄 백필
--   대상: customers.visit_route IS NULL ∩ 그 고객의 '최초(created_at ASC) 예약'이 route 실값 보유
--   fill값: 그 고객의 가장 이른(created_at ASC, id ASC) reservations.visit_route  ← ★ first-touch(획득경로)
--   DB: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD, clinic slug=jongno-foot)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ★ fill 규칙 확정 = first-touch (DA CONSULT-REPLY MSG-20260716-142052-zip4 Q4 수정본)
--   customers.visit_route = 획득경로(acquisition) = 정의상 first-touch(최초 예약 route).
--   most-recent(created_at DESC)는 반려됨 — SSOT 를 most-recent 로 박제하면 오가닉-최초가
--   후행 dopamine 로 'TM' 오라벨되는 잠복버그(DOPAMINE 시나리오2 회귀). first-touch = lead
--   attribution / Revenue Source Split SSOT 정합.
--   ▸ forward-fill 금지: 최초(절대 첫) 예약의 route 가 NULL 이면 out-of-scope(방치). 후행 예약
--     route 로 소급 채움 금지. (dry-run E=1건 = 최초 route NULL·후행 'TM' → 미대상, NULL 유지)
--
-- ★ fold (Q1): DOPAMINE-BACKFILL 은 본 백필에 subsume. dry-run 실측 divergence(first-touch vs
--   most-recent)=0 이고 dopamine-first 고객 전원이 "resv route 존재" 셋(first-touch route='TM')에
--   포함 + Q2 sliver=0 → 값 동일. 단 fold 전제 = fill 규칙 first-touch(본 SQL 준수). planner 는
--   조건충족(apply 잔차0 재검증) 시 DOPAMINE-BACKFILL 을 superseded_by 로 close.
--
-- ★★ GATE_HOLD — PROD 실행 금지 (게이트 순서 엄수) ★★
--   G1 DA CONSULT-REPLY GO  (zip4: CONDITIONAL-GO / fill=first-touch / fold / 잔차0 abort)  ✔
--   G2 dry-run evidence      (scripts/T-20260716-…_dryrun.mjs = first-touch/freeze/BEFORE-AFTER/
--                             no-clobber/divergence0/sliver0 실증 → _DRYRUN_REPORT.md 착지)     ✔
--   G3 supervisor 백필 승인   (DML-diff + archive-first 스냅샷 + dry-run 검수 + 원장 무접점 확인) ← 대기
--   → STEP 3 APPLY (freeze JOIN + 멱등 IS NULL 가드) → STEP 4 post-verify(잔존 0) → 현장 confirm
--   dev-foot 는 본 SQL 을 *준비*만 함. STEP 3 실행 = supervisor DML-diff 승인 후. GO 전 prod UPDATE 금지.
--
-- ── SOP 준거: Cross-CRM Data-Correction 백필 SOP + zip4 착수 GO 조건 8종 ──────────────
--   §0  필드분류 = mutable(auto-derived default + 스태프 수동변경 가능) → §1~§2 발동.
--       단 IS NULL 가드 only-fill → 정당 수동값(non-NULL) 물리적 clobber 불가 = 역오염 구조적 0.
--   §0-2 소스차단 선행: forward-sync EF(RESVROUTE-VISITCHANNEL-ALWAYSYNC 15efde96, field-soak
--       GREEN 07-15 15:17)가 신규분 seed 중 = 소스 닫힘. 본 백필 = 그 이전 적재분 소급.
--       ▶ 착수 GO 조건 8 = 이 forward EF live/soak-GREEN 을 dev-foot 가 apply 직전 재확인.
--   §1  단일 count UPDATE 금지 — count 는 필요조건. WHERE 에 §2 지문 전체 임베드 + freeze-by-id.
--   §2  버그경로 지문: (customers.visit_route IS NULL) ∩ (그 고객 최초예약 route 실값 존재)
--                     ∩ (override 없음: IS NULL 이면 정의상 수동지정 없음).
--   §2-S 컬럼 실존: customers.visit_route / reservations.{customer_id,visit_route,created_at,id,
--       source_system} 모두 prod 실존. CHECK(양테이블 동일 6값): 2026-07-16 실측
--       customers_visit_route_check = (NULL OR 'TM'|'워크인'|'인바운드'|'지인소개'|'네이버'|'인콜').
--       ('공홈' 7값 ADDITIVE 는 prod 미배포 — 본 백필 proposed 값에 없어 충돌 0.)
--   §3  안전 4종: freeze by id(STEP 1) / 판정근거 스냅샷(STEP 1) / 멱등 WHERE(IS NULL, STEP 3) /
--       abort(STEP 2 assert + STEP 2.5 apply-직전 재검증).
--   §4  DDL 0(순수 UPDATE) → schema_migrations 무접점. 스냅샷 = _backup_* 네임스페이스(보존 후 drop).
--   §4  PHI 위생: 본 .sql 리터럴 환자식별자 0건(로직 only). freeze id 집합·근거는 DB _backup(off-git)에만
--       영속. dry-run evidence(_DRYRUN_REPORT.md)도 count·분포만(id/이름 0건, phi_redaction 라우팅).
--
-- ── 불변식 ───────────────────────────────────────────────────────────────────────
--   G0(no-clobber): visit_route IS NULL 인 행만 변경. non-NULL(수동값 포함) 순소실 0.
--                   (2026-07-16 실측: customers.visit_route='' 0건 → IS NULL 가드로 충분.)
--   G1(단일컬럼): visit_route 만 착지. visit_route_detail/lead_source/source_system 등 미접촉.
--   G2(reservations 불변): reservations 는 소스(read-only). 절대 UPDATE 금지.
--   G3(split 불변): reservations.source_system 무접촉 → 매출 오가닉/광고 split 불변, 집계 double-count 0.
--   가역: STEP 1 스냅샷 근거로 RB 섹션이 건드린 행만 NULL 원복.
--
-- ── dry-run 실측 (2026-07-16, scripts/T-…_dryrun.mjs) ─────────────────────────────
--   customers.visit_route NULL 총 269 = 대상후보. 그중:
--     • first-touch 대상(in-scope) = 151  (전량 proposed='TM'; provenance: 150 dopamine + 1 src-NULL)
--     • forward-fill gap(out-of-scope, NULL 유지) = 1  (최초 route NULL·후행 'TM')
--     • no-route 전무(out-of-scope, 파생소스 없음) = 117
--   divergence(first-touch vs most-recent) = 0   → fold-safe (값 동일)
--   dopamine-first ∩ 전예약 route 전무 sliver(Q2 abort trigger) = 0  → 단일 pass 종결, 재-CONSULT 불요
--   non-enum proposed = 0 (CHECK-safe) · old-value non-NULL in target = 0 (no-clobber trivially holds)
-- ══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-A: dry-run count (§1 필요조건 — supervisor 검증 기준값 = expected 151)
--   first_touch = 고객별 '절대 최초'(created_at ASC, id ASC) 예약. in-scope = 그 최초 route 실값.
-- ═══════════════════════════════════════════════════════════════════════════════
WITH abs_first AS (
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id,
         r.visit_route   AS ft_route,
         r.source_system AS ft_src,
         r.created_at    AS ft_at,
         r.id            AS ft_id
  FROM reservations r
  WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC      -- ★ first-touch (절대 최초), 결정적 tiebreak
)
SELECT count(*) AS target_rows                              -- expected 151
FROM customers c
JOIN abs_first af ON af.customer_id = c.id
WHERE c.visit_route IS NULL                                 -- G0 no-clobber / §3 멱등
  AND af.ft_route IS NOT NULL AND btrim(af.ft_route) <> ''; -- forward-fill 금지: 최초 route NULL 이면 제외


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-B: 참고 계량 — out-of-scope 분해 (감사용, 대상 아님)
-- ═══════════════════════════════════════════════════════════════════════════════
-- (a) 최초 route NULL 이나 후행 예약에 route 존재 (forward-fill gap) — expected 1, NULL 유지
WITH abs_first AS (
  SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route AS ft_route
  FROM reservations r WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT count(*) AS forward_fill_gap_out_of_scope
FROM customers c
JOIN abs_first af ON af.customer_id = c.id
WHERE c.visit_route IS NULL
  AND (af.ft_route IS NULL OR btrim(af.ft_route) = '')
  AND EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id
              AND r.visit_route IS NOT NULL AND btrim(r.visit_route) <> '');

-- (b) 예약 route 전무 (파생소스 없음) — expected 117, NULL 유지
SELECT count(*) AS null_cust_no_resvroute_out_of_scope
FROM customers c
WHERE c.visit_route IS NULL
  AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id
                  AND r.visit_route IS NOT NULL AND btrim(r.visit_route) <> '');


-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 0-C: ★ Q2 잔차 sliver (착수 GO 조건 4 = apply-직전 재검증 abort trigger) — MUST BE 0
--   (최초예약 source_system='dopamine') ∩ (customers NULL) ∩ (전 예약 route 전무).
--   1건이라도 나오면 그 행은 예약파생 셋이 못 잡음 → source_system→'TM' 파생 필요 → abort → 재-CONSULT.
-- ═══════════════════════════════════════════════════════════════════════════════
WITH abs_first AS (
  SELECT DISTINCT ON (r.customer_id) r.customer_id, r.source_system AS ft_src
  FROM reservations r WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT count(*) AS dopamine_null_sliver_MUST_BE_0
FROM customers c
JOIN abs_first af ON af.customer_id = c.id
WHERE c.visit_route IS NULL
  AND af.ft_src = 'dopamine'
  AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id
                  AND r.visit_route IS NOT NULL AND btrim(r.visit_route) <> '');


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 1: ★ FREEZE + 판정근거 스냅샷 (§3-1 freeze by id / §3-2 근거 / §4 _backup)
--   UPDATE 가 건드릴 정확한 id 집합 + old 값(정의상 NULL) + 판정신호 전체 영속.
--   STEP 3 UPDATE 는 조건 재-SELECT 아니라 이 집합에만 JOIN(drift 차단). 멱등: DROP 후 재생성.
--   ▶ APPLY 시점에 fresh 재산출(stale freeze 재사용 금지 — RESVDATE-SHIFT 교훈).
-- ══════════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS _backup_t20260716_visitroute_resv;
CREATE TABLE _backup_t20260716_visitroute_resv AS
WITH abs_first AS (
  SELECT DISTINCT ON (r.customer_id)
         r.customer_id,
         r.visit_route   AS ft_route,
         r.source_system AS ft_src,
         r.created_at    AS ft_at,
         r.id            AS ft_id
  FROM reservations r
  WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT
  c.id            AS customer_id,                                      -- freeze PK
  c.visit_route   AS old_visit_route,                                  -- 변경 전 값(정의상 NULL)
  CASE WHEN af.ft_route = '인콜' THEN '인바운드' ELSE af.ft_route END  AS proposed_visit_route,  -- first-touch route (인콜→인바운드 유일 정규화)
  af.ft_route     AS raw_first_route,                                  -- 정규화 전 원값(근거)
  af.ft_src       AS first_rsv_source,                                 -- 판정근거(provenance)
  af.ft_at        AS first_rsv_created_at,
  af.ft_id        AS first_rsv_id,
  c.created_at    AS customer_created_at,
  c.updated_at    AS customer_updated_at
FROM customers c
JOIN abs_first af ON af.customer_id = c.id
WHERE c.visit_route IS NULL
  AND af.ft_route IS NOT NULL AND btrim(af.ft_route) <> '';           -- forward-fill 금지

-- freeze 집합 확인 (STEP 0-A target_rows 와 일치해야 함 = 151)
SELECT count(*) AS frozen_rows FROM _backup_t20260716_visitroute_resv;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2: abort 임계 assert (§3-4) — enum·no-clobber·first-touch 불변식 위반 시 즉시 중단.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_frozen int;
BEGIN
  SELECT count(*) INTO v_frozen FROM _backup_t20260716_visitroute_resv;
  -- assert 1: proposed 는 반드시 customers CHECK enum(6값) 내 — 아니면 UPDATE 시 CHECK 위반
  IF EXISTS (SELECT 1 FROM _backup_t20260716_visitroute_resv
             WHERE proposed_visit_route NOT IN ('TM','워크인','인바운드','지인소개','네이버','인콜')) THEN
    RAISE EXCEPTION 'ABORT: proposed_visit_route 비-enum 값 존재 (customers_visit_route_check 위반 예상)';
  END IF;
  -- assert 2: old 값은 반드시 NULL (no-clobber 대상만)
  IF EXISTS (SELECT 1 FROM _backup_t20260716_visitroute_resv WHERE old_visit_route IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: old_visit_route non-NULL 혼입 (no-clobber 위반)';
  END IF;
  -- assert 3: raw_first_route 는 반드시 non-empty (forward-fill 금지 불변식 — 최초 route 실값만)
  IF EXISTS (SELECT 1 FROM _backup_t20260716_visitroute_resv
             WHERE raw_first_route IS NULL OR btrim(raw_first_route) = '') THEN
    RAISE EXCEPTION 'ABORT: raw_first_route NULL/빈값 혼입 (forward-fill 금지 위반)';
  END IF;
  RAISE NOTICE 'STEP2 PASS: frozen_rows=% (enum·no-clobber·first-touch 불변식 OK). expected=151 대조는 supervisor 수동.', v_frozen;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2.5: ★ APPLY-직전 재검증 abort (착수 GO 조건 4 — tz-aware, drift·sliver 재확인)
--   supervisor 승인과 실제 APPLY 사이 시차 동안 신규 예약/수동값이 drift 했을 수 있음.
--   freeze 시점 지문이 그대로 유지되는지 + Q2 sliver 여전히 0 인지 재확인. 위반 1건도 abort.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_drift int; v_sliver int;
BEGIN
  -- (a) freeze PK 중 이미 non-NULL 로 drift 한 행 (수동 입력 등) → 그 행은 UPDATE 자연 배제되나 감사 필요
  SELECT count(*) INTO v_drift
  FROM _backup_t20260716_visitroute_resv b JOIN customers c ON c.id = b.customer_id
  WHERE c.visit_route IS NOT NULL;
  IF v_drift > 0 THEN
    RAISE WARNING 'STEP2.5 DRIFT: freeze 셋 중 %건이 이미 non-NULL (STEP3 IS NULL 가드로 자연 skip). supervisor 판단 필요.', v_drift;
  END IF;
  -- (b) Q2 sliver 재산출 (tz-aware: created_at 은 timestamptz) — 여전히 0 이어야 함
  SELECT count(*) INTO v_sliver
  FROM customers c
  JOIN (SELECT DISTINCT ON (r.customer_id) r.customer_id, r.source_system ft_src
        FROM reservations r WHERE r.customer_id IS NOT NULL
        ORDER BY r.customer_id, r.created_at ASC, r.id ASC) af ON af.customer_id = c.id
  WHERE c.visit_route IS NULL AND af.ft_src = 'dopamine'
    AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id
                    AND r.visit_route IS NOT NULL AND btrim(r.visit_route) <> '');
  IF v_sliver > 0 THEN
    RAISE EXCEPTION 'ABORT: apply-직전 Q2 sliver=% (>0). 그 행 source_system→TM 파생 필요 → 재-CONSULT.', v_sliver;
  END IF;
  RAISE NOTICE 'STEP2.5 PASS: drift=% (IS NULL 가드로 안전), sliver=0. APPLY 진행 가능.', v_drift;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 3: ★ 백필 UPDATE (freeze by id JOIN + 멱등 IS NULL 가드) — supervisor DML-diff 승인 후 실행
-- ══════════════════════════════════════════════════════════════════════════════
UPDATE customers c
SET visit_route = b.proposed_visit_route
FROM _backup_t20260716_visitroute_resv b
WHERE c.id = b.customer_id
  AND c.visit_route IS NULL;                 -- 멱등·no-clobber (freeze 후 drift 로 값 생겼으면 skip)


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 4: 사후 검증 (rowcount assert + post-verify)
-- ══════════════════════════════════════════════════════════════════════════════
-- 4-a: freeze 집합 중 실제 착지된 행 수 (= frozen_rows - drift, 정상시 151)
SELECT count(*) AS applied_rows
FROM customers c JOIN _backup_t20260716_visitroute_resv b ON b.customer_id = c.id
WHERE c.visit_route = b.proposed_visit_route;

-- 4-b: no-clobber/오염 사후 입증 — freeze 집합 중 proposed 와 다른 값 = 0 이어야 함
SELECT count(*) AS unexpected_value_rows_MUST_BE_0
FROM customers c JOIN _backup_t20260716_visitroute_resv b ON b.customer_id = c.id
WHERE c.visit_route IS NOT NULL AND c.visit_route <> b.proposed_visit_route;

-- 4-c: 잔존건 0 (AC4) — first-touch in-scope 인데 아직 NULL = 0 이어야 함
--   (out-of-scope: forward-fill gap 1 + no-route 117 은 설계상 NULL 유지 = 잔존 아님)
WITH abs_first AS (
  SELECT DISTINCT ON (r.customer_id) r.customer_id, r.visit_route AS ft_route
  FROM reservations r WHERE r.customer_id IS NOT NULL
  ORDER BY r.customer_id, r.created_at ASC, r.id ASC
)
SELECT count(*) AS residual_in_scope_MUST_BE_0
FROM customers c JOIN abs_first af ON af.customer_id = c.id
WHERE c.visit_route IS NULL AND af.ft_route IS NOT NULL AND btrim(af.ft_route) <> '';


-- ══════════════════════════════════════════════════════════════════════════════
-- RB: ★ ROLLBACK (post-COMMIT 복원) — STEP 1 스냅샷 근거, 건드린 행만 NULL 원복.
--   가드: visit_route = proposed 인 행만 되돌림 → 백필 후 스태프가 다시 손댄 값은 미터치.
-- ══════════════════════════════════════════════════════════════════════════════
-- UPDATE customers c
-- SET visit_route = b.old_visit_route          -- 정의상 NULL
-- FROM _backup_t20260716_visitroute_resv b
-- WHERE c.id = b.customer_id
--   AND c.visit_route = b.proposed_visit_route; -- 백필값 그대로인 행만 원복(사후 수동변경 보존)
--
-- 롤백 검증:
-- SELECT count(*) AS reverted_still_backfilled_MUST_BE_0
-- FROM customers c JOIN _backup_t20260716_visitroute_resv b ON b.customer_id = c.id
-- WHERE c.visit_route = b.proposed_visit_route AND b.old_visit_route IS NULL;

-- 스냅샷 보존(retention) 후 정리(§4 원장 무접점): DROP TABLE _backup_t20260716_visitroute_resv;
