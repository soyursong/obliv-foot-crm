-- T-20260605-foot-SALES-STAFF-DEDUCT-BASIS: package_sessions.unit_price 스냅샷 근본 fix + 소급 backfill
--
-- 배경 (현장 결정 = B안, 김주연 총괄 / MSG-20260605-152922-w9ky):
--   담당직원별 차감기준 매출은 package_sessions.unit_price(차감 당시 단가 스냅샷) 합으로 집계한다
--   (SalesStaffTab.tsx, DEDUCT_AMOUNT_BASIS='snapshot'). 그러나 4개 회차차감 insert 경로
--   (Packages.tsx UseSessionDialog, CheckInDetailSheet, CustomerChartPage saveUseSession/saveC22Deduct/handleHealerDeduct)
--   가 insert 시 unit_price 를 기록하지 않아, 기존 used 세션 94건 중 61건이 unit_price NULL/0 →
--   차감기준 매출이 0원으로 표출됨. A안(현재단가 즉시전환) 미채택, 스냅샷 정확성 우선.
--
-- Fix (근본 + 소급 2단):
--   (1) 근본 fix — BEFORE INSERT 트리거 fn_fill_session_unit_price():
--       unit_price 가 NULL 또는 0 으로 들어오면, 해당 package 의 session_type 별 현재 단가를
--       스냅샷으로 자동 채움. 4개 FE 경로 + 향후 신규 경로까지 DB 레벨에서 일관 보장
--       (FE 4곳 분산 수정 대비 누락·divergence 위험 제거). FE 가 명시값을 넣으면 그 값 우선.
--   (2) 소급 backfill — 기존 status='used' & unit_price NULL/0 인 58건을 package 현재 단가로 1회 정정.
--       소스 단가 자체가 0 인 구형 패키지 3건(podologue 1, unheated_laser 2)은 채울 값이 없어 제외.
--
--   session_type → packages 단가 컬럼 매핑:
--     heated_laser→heated_unit_price, unheated_laser→unheated_unit_price, iv→iv_unit_price,
--     podologue/podologe→podologe_unit_price, trial→trial_unit_price.
--     preconditioning 은 packages 에 대응 단가 컬럼 없음 → NULL 유지(무상 사전처치, 차감수가 0).
--
-- Risk: 스키마 변경(트리거 신규, risk#1) + 대량 데이터 UPDATE(58건, risk#4).
--       → rollback SQL + 원본 캡처 CSV(rollback/..._backfill_capture.csv) 동봉,
--         dry-run preview(아래 주석) 사전 검토 완료, supervisor DB 게이트 경유 prod 실행.
-- Rollback: 20260605120000_pkg_session_unit_price_snapshot.rollback.sql
-- Ticket: T-20260605-foot-SALES-STAFF-DEDUCT-BASIS

BEGIN;

-- ── (1) 근본 fix: insert 시 unit_price 스냅샷 자동 기록 트리거 ─────────────────────
CREATE OR REPLACE FUNCTION fn_fill_session_unit_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 명시적 단가가 없을 때(NULL/0)만 패키지 현재 단가를 스냅샷으로 채움.
  -- FE 가 unit_price 를 명시하면 그 값을 그대로 존중(스냅샷 우선).
  IF NEW.unit_price IS NULL OR NEW.unit_price = 0 THEN
    SELECT CASE NEW.session_type
             WHEN 'heated_laser'   THEN p.heated_unit_price
             WHEN 'unheated_laser' THEN p.unheated_unit_price
             WHEN 'iv'             THEN p.iv_unit_price
             WHEN 'podologue'      THEN p.podologe_unit_price
             WHEN 'podologe'       THEN p.podologe_unit_price
             WHEN 'trial'          THEN p.trial_unit_price
             ELSE NULL  -- preconditioning 등 대응 컬럼 없는 타입은 NULL(무상)
           END
      INTO NEW.unit_price
      FROM public.packages p
     WHERE p.id = NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION fn_fill_session_unit_price() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_fill_session_unit_price ON public.package_sessions;
CREATE TRIGGER trg_fill_session_unit_price
  BEFORE INSERT ON public.package_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_fill_session_unit_price();

COMMENT ON FUNCTION fn_fill_session_unit_price() IS
  '회차차감 insert 시 unit_price 미기록(NULL/0)이면 package 현재 단가를 스냅샷으로 자동 기록 (T-20260605-foot-SALES-STAFF-DEDUCT-BASIS)';

-- ── (2) 소급 backfill: 기존 0/NULL used 세션을 package 현재 단가로 정정 ──────────────
-- 대응 단가 컬럼이 0/NULL 인 구형 패키지는 NULLIF 가드로 자연 제외(WHERE 절 새 단가 > 0).
UPDATE public.package_sessions ps
SET unit_price = src.new_price
FROM (
  SELECT s.id,
         CASE s.session_type
           WHEN 'heated_laser'   THEN p.heated_unit_price
           WHEN 'unheated_laser' THEN p.unheated_unit_price
           WHEN 'iv'             THEN p.iv_unit_price
           WHEN 'podologue'      THEN p.podologe_unit_price
           WHEN 'podologe'       THEN p.podologe_unit_price
           WHEN 'trial'          THEN p.trial_unit_price
           ELSE NULL
         END AS new_price
  FROM public.package_sessions s
  JOIN public.packages p ON p.id = s.package_id
  WHERE s.status = 'used'
    AND (s.unit_price IS NULL OR s.unit_price = 0)
) src
WHERE ps.id = src.id
  AND src.new_price IS NOT NULL
  AND src.new_price > 0;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DRY-RUN PREVIEW (prod 실행 전 supervisor 가 단독 SELECT 로 검증 — 실측 2026-06-05):
--
--   SELECT s.session_type,
--          COUNT(*) FILTER (WHERE s.unit_price IS NULL OR s.unit_price = 0) AS zero_before,
--          COUNT(*) FILTER (WHERE (s.unit_price IS NULL OR s.unit_price = 0)
--                             AND CASE s.session_type
--                                   WHEN 'heated_laser' THEN p.heated_unit_price
--                                   WHEN 'unheated_laser' THEN p.unheated_unit_price
--                                   WHEN 'iv' THEN p.iv_unit_price
--                                   WHEN 'podologue' THEN p.podologe_unit_price
--                                   WHEN 'podologe' THEN p.podologe_unit_price
--                                   WHEN 'trial' THEN p.trial_unit_price ELSE NULL END > 0) AS will_fill
--   FROM package_sessions s JOIN packages p ON p.id = s.package_id
--   WHERE s.status='used' GROUP BY s.session_type;
--
--   기대 결과: will_fill 합계 = 58건 (trial 4, unheated_laser 42, heated_laser 7, podologue 4, iv 1)
--   잔존 0/NULL = 3건(구형 패키지 단가 0, 소스 없음) + preconditioning(무상, 해당 없음).
-- ─────────────────────────────────────────────────────────────────────────────
